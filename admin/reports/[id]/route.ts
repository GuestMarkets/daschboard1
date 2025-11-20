export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../../../lib/db";
import { getMe } from "../../../_utils";

/* === Typages des lignes SQL === */
interface ReportRow extends RowDataPacket {
  id: number;
  title: string;
  type: string;
  summary: string | null;
  period_start: string | Date | null;
  period_end: string | Date | null;
  status: string;
  author_id: number;
  author_name: string | null;
}

interface ReportRecipientRow extends RowDataPacket {
  status: string; // "submitted" | "under_review" | ...
  unread: number | boolean; // TINYINT(1) ou BOOL
  read_at: string | Date | null;
}

interface FileRow extends RowDataPacket {
  id: number;
  report_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string | Date;
}

interface CommentRow extends RowDataPacket {
  id: number;
  report_id: number;
  user_id: number;
  text: string;
  created_at: string | Date;
  user_name: string | null;
}

/* === Utilitaire === */
function toStrOrNull(v: string | Date | null): string | null {
  return v == null ? null : String(v);
}

/**
 * GET /api/admin/reports/:id
 * - Marque "lu" + passe à "under_review" si le viewer est destinataire
 * - Renvoie le détail + pièces + commentaires
 *
 * NB: La signature ci-dessous respecte la contrainte de Next.js:
 * (request: NextRequest, context: { params: Promise<{ id: string }>})
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const me = await getMe();

    // params est un Promise dans le type attendu => on l'attend
    const { id: idParam } = await context.params;
    const id = Number(idParam);

    const [rows] = await pool.query<ReportRow[]>(
      `SELECT r.*, u.name AS author_name
         FROM reports r
         JOIN users u ON u.id = r.author_id
        WHERE r.id = ? AND r.status <> 'draft'
        LIMIT 1`,
      [id]
    );

    const r = rows[0];
    if (!r) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Si je suis destinataire : maj read + statut inbox
    const [rcpRows] = await pool.query<ReportRecipientRow[]>(
      `SELECT status, unread, read_at
         FROM report_recipients
        WHERE report_id = ? AND user_id = ?
        LIMIT 1`,
      [id, me.id]
    );

    const recipient = rcpRows[0];
    if (recipient) {
      if (recipient.status === "submitted") {
        await pool.query(
          `UPDATE report_recipients
              SET status='under_review', unread=0, read_at=NOW()
            WHERE report_id=? AND user_id=?`,
          [id, me.id]
        );
      } else if (recipient.unread) {
        // unread peut être number (0/1) ou boolean
        await pool.query(
          `UPDATE report_recipients
              SET unread=0, read_at=COALESCE(read_at, NOW())
            WHERE report_id=? AND user_id=?`,
          [id, me.id]
        );
      }
    }

    const [files] = await pool.query<FileRow[]>(
      `SELECT * FROM report_files WHERE report_id=? ORDER BY uploaded_at DESC`,
      [id]
    );

    const [comments] = await pool.query<CommentRow[]>(
      `SELECT c.*, u.name AS user_name
         FROM report_comments c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.report_id=?
        ORDER BY created_at ASC`,
      [id]
    );

    return NextResponse.json({
      item: {
        id: Number(r.id),
        title: String(r.title),
        type: r.type,
        summary: r.summary,
        periodStart: toStrOrNull(r.period_start),
        periodEnd: toStrOrNull(r.period_end),
        status: r.status,
        authorName: r.author_name ?? null,
        files: files.map((f) => ({
          id: Number(f.id),
          original_name: String(f.original_name),
          mime_type: String(f.mime_type),
          size_bytes: Number(f.size_bytes),
          uploaded_at: String(f.uploaded_at),
        })),
        comments: comments.map((c) => ({
          id: Number(c.id),
          user_id: Number(c.user_id),
          user_name: c.user_name ?? null,
          text: String(c.text),
          created_at: String(c.created_at),
        })),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
