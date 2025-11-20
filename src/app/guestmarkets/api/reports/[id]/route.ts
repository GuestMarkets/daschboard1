export const runtime = "nodejs";

import type { RowDataPacket } from "mysql2/promise";
import { NextRequest } from "next/server";
import { pool } from "../../../../../../lib/db"; // ← 6 niveaux
import { ok, err, getMe, sqlDate } from "../../_utils";

type ReportRow = RowDataPacket & {
  id: number | string;
  title: string | null;
  type: string | null;
  summary: string | null;
  period_start: string | Date | null;
  period_end: string | Date | null;
  status: string;
  author_id: number | string;
  authorName?: string | null;
};

type RecipientRow = RowDataPacket & {
  status: string | null;
  unread: number | boolean | null;
  read_at: string | Date | null;
};

type FileRow = RowDataPacket & {
  id: number | string;
  original_name: string;
  mime_type: string;
  size_bytes: number | string;
  uploaded_at: string | Date;
};

type CommentRow = RowDataPacket & {
  id: number | string;
  user_id: number | string;
  user_name: string;
  text: string;
  created_at: string | Date;
};

type PatchBody = {
  title?: string | null;
  summary?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};

// GET /api/reports/[taskId]
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const me = await getMe();
    const { id: idParam } = await ctx.params; // <-- Next 15: params is a Promise
    const id = Number(idParam);

    const [rrows] = await pool.execute<RowDataPacket[]>(
      `SELECT r.*, a.name AS authorName
         FROM reports r
         JOIN users a ON a.id = r.author_id
        WHERE r.id = ? LIMIT 1`,
      [id]
    );

    const r = rrows[0] as ReportRow | undefined;
    if (!r) return err("Rapport introuvable", 404);

    const isAuthor = Number(r.author_id) === me.id;

    const [accRows] = await pool.execute<RowDataPacket[]>(
      `SELECT status, unread, read_at
         FROM report_recipients
        WHERE report_id = ? AND user_id = ? LIMIT 1`,
      [id, me.id]
    );

    const acc = (accRows[0] as RecipientRow | undefined) ?? undefined;
    const isRecipient = !!acc;

    if (!isAuthor && !isRecipient) return err("Accès interdit", 403);

    // MAJ lecture / statut boîte de réception
    let inboxStatus: string | undefined = acc?.status ?? undefined;
    let unread = Boolean(acc?.unread);
    let readAt: string | null = acc?.read_at != null ? String(acc.read_at) : null;

    if (isRecipient && r.status !== "draft" && acc) {
      if (acc.status === "submitted") {
        await pool.execute(
          `UPDATE report_recipients
              SET status='under_review', unread=0, read_at=NOW()
            WHERE report_id=? AND user_id=? AND status='submitted'`,
          [id, me.id]
        );
        inboxStatus = "under_review";
        unread = false;
        readAt = new Date().toISOString();
      } else if (unread) {
        await pool.execute(
          `UPDATE report_recipients
              SET unread=0, read_at=NOW()
            WHERE report_id=? AND user_id=? AND unread=1`,
          [id, me.id]
        );
        unread = false;
        readAt = new Date().toISOString();
      }
    }

    const [filesRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, original_name, mime_type, size_bytes, uploaded_at
         FROM report_files
        WHERE report_id = ?
        ORDER BY uploaded_at DESC`,
      [id]
    );

    const files = (filesRows as FileRow[]).map((f) => ({
      id: Number(f.id),
      original_name: String(f.original_name),
      mime_type: String(f.mime_type),
      size_bytes: Number(f.size_bytes),
      uploaded_at: String(f.uploaded_at),
    }));

    const [commentsRows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id, c.user_id, u.name AS user_name, c.text, c.created_at
         FROM report_comments c
         JOIN users u ON u.id = c.user_id
        WHERE c.report_id = ?
        ORDER BY c.created_at DESC`,
      [id]
    );

    const comments = (commentsRows as CommentRow[]).map((c) => ({
      id: Number(c.id),
      user_id: Number(c.user_id),
      user_name: String(c.user_name),
      text: String(c.text),
      created_at: String(c.created_at),
    }));

    const item = {
      id: Number(r.id),
      title: r.title ? String(r.title) : null,
      type: r.type ? String(r.type) : null,
      summary: r.summary ? String(r.summary) : null,
      periodStart: r.period_start ? sqlDate(r.period_start) : null,
      periodEnd: r.period_end ? sqlDate(r.period_end) : null,
      status: String(r.status),
      files,
      comments,
      authorName: r.authorName ? String(r.authorName) : null,
      ...(isRecipient ? { inboxStatus, unread, readAt } : {}),
    };

    return ok({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}

// PATCH /api/reports/[taskId]
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const me = await getMe();
    const { id: idParam } = await ctx.params; // <-- Next 15: params is a Promise
    const id = Number(idParam);

    const body: PatchBody =
      (await req
        .json()
        .catch(() => ({} as PatchBody))) ?? ({} as PatchBody);

    const { title, summary, periodStart, periodEnd } = body;

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM reports WHERE id=? AND author_id=? LIMIT 1`,
      [id, me.id]
    );

    const r = rows[0] as (RowDataPacket & { status: string }) | undefined;
    if (!r) return err("Accès interdit", 403);

    if (!["draft", "changes_requested"].includes(String(r.status))) {
      return err("Statut non modifiable", 400);
    }

    await pool.execute(
      `UPDATE reports
          SET title=?, summary=?, period_start=?, period_end=?, updated_at=NOW()
        WHERE id=?`,
      [title ?? null, summary ?? null, periodStart ?? null, periodEnd ?? null, id]
    );

    return ok({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}
