export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../../lib/db";
import { getMe } from "../../_utils";

/* =================== Types =================== */

type ReportStatus = string; // ajustez si vous avez un enum côté DB

interface CurrentUser {
  id: number;
}

interface ReportRow extends RowDataPacket {
  id: number;
  title: string;
  type: string | null;
  summary: string | null;
  period_start: string | null;
  period_end: string | null;
  status: ReportStatus;
  author_id: number;
  author_name?: string | null;
  created_at: string;
}

interface ReceivedReportRow extends ReportRow {
  inbox_status: string | null;
  unread: number | null; // 0/1 en DB
  read_at: string | null;
}

interface ReportFileRow extends RowDataPacket {
  id: number;
  report_id: number;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_at: string;
}

interface ReportCommentRow extends RowDataPacket {
  id: number;
  report_id: number;
  user_id: number;
  user_name: string | null;
  text: string;
  created_at: string;
}

interface RecipientJoinRow extends RowDataPacket {
  report_id: number;
  uid: number;
  name: string;
}

interface SlimFile {
  id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}

interface SlimComment {
  id: number;
  user_id: number;
  user_name: string | null;
  text: string;
  created_at: string;
}

interface Recipient {
  id: number;
  name: string;
}

interface SerializedReport {
  id: number;
  title: string;
  type: string | null;
  summary: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: ReportStatus;
  authorName: string | null;
  files: SlimFile[];
  comments: SlimComment[];
  inboxStatus: string | null;
  unread: boolean;
  readAt: string | null;
  recipients: Recipient[];
}

/* =================== Route =================== */

/**
 * GET /api/admin/reports?scope=all|received
 * - scope=received : seulement ceux dont je suis destinataire
 * - scope=all      : tous les rapports
 * 🔒 Exclut les brouillons (r.status <> 'draft')
 */
export async function GET(req: Request) {
  try {
    const me = (await getMe()) as CurrentUser;
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") ?? "all";

    if (scope === "received") {
      const [rows] = await pool.query<ReceivedReportRow[]>(
        `SELECT r.*, rr.status AS inbox_status, rr.unread, rr.read_at, u.name AS author_name
           FROM report_recipients rr
           JOIN reports r ON r.id = rr.report_id
           JOIN users u ON u.id = r.author_id
          WHERE rr.user_id = ? AND r.status <> 'draft'
          ORDER BY r.created_at DESC`,
        [me.id]
      );

      const ids = rows.map((r) => r.id);
      const files = ids.length
        ? await pool
            .query<ReportFileRow[]>(
              `SELECT rf.* 
                 FROM report_files rf 
                WHERE rf.report_id IN (?) 
                ORDER BY uploaded_at DESC`,
              [ids]
            )
            .then(([r]) => r)
        : [];

      const comments = ids.length
        ? await pool
            .query<ReportCommentRow[]>(
              `SELECT rc.*, u.name AS user_name 
                 FROM report_comments rc 
                 LEFT JOIN users u ON u.id = rc.user_id 
                WHERE rc.report_id IN (?) 
                ORDER BY rc.created_at ASC`,
              [ids]
            )
            .then(([r]) => r)
        : [];

      const groupedFiles = groupByNumber(files, "report_id", slimFile);
      const groupedComments = groupByNumber(comments, "report_id", slimComment);

      return NextResponse.json({
        items: rows.map((r) =>
          serializeReport(r, {
            files: groupedFiles.get(r.id) ?? [],
            comments: groupedComments.get(r.id) ?? [],
            inboxStatus: r.inbox_status,
            unread: Boolean(r.unread),
            readAt: r.read_at,
          })
        ),
      });
    }

    // scope=all
    const [rows] = await pool.query<ReportRow[]>(
      `SELECT r.*, u.name AS author_name
         FROM reports r
         JOIN users u ON u.id = r.author_id
        WHERE r.status <> 'draft'
        ORDER BY r.created_at DESC`
    );

    const ids = rows.map((r) => r.id);

    const files = ids.length
      ? await pool
          .query<ReportFileRow[]>(
            `SELECT rf.* 
               FROM report_files rf 
              WHERE rf.report_id IN (?) 
              ORDER BY uploaded_at DESC`,
            [ids]
          )
          .then(([r]) => r)
      : [];

    const comments = ids.length
      ? await pool
          .query<ReportCommentRow[]>(
            `SELECT rc.*, u.name AS user_name 
               FROM report_comments rc 
               LEFT JOIN users u ON u.id = rc.user_id 
              WHERE rc.report_id IN (?) 
              ORDER BY rc.created_at ASC`,
            [ids]
          )
          .then(([r]) => r)
      : [];

    const recipients = ids.length
      ? await pool
          .query<RecipientJoinRow[]>(
            `SELECT rr.report_id, u.id AS uid, u.name
               FROM report_recipients rr
               JOIN users u ON u.id = rr.user_id
              WHERE rr.report_id IN (?)
              ORDER BY u.name ASC`,
            [ids]
          )
          .then(([r]) => r)
      : [];

    const groupedFiles = groupByNumber(files, "report_id", slimFile);
    const groupedComments = groupByNumber(comments, "report_id", slimComment);

    const groupedRecipients = new Map<number, Recipient[]>();
    for (const row of recipients) {
      const rid = row.report_id;
      if (!groupedRecipients.has(rid)) groupedRecipients.set(rid, []);
      groupedRecipients.get(rid)!.push({ id: row.uid, name: row.name });
    }

    return NextResponse.json({
      items: rows.map((r) =>
        serializeReport(r, {
          files: groupedFiles.get(r.id) ?? [],
          comments: groupedComments.get(r.id) ?? [],
          recipients: groupedRecipients.get(r.id) ?? [],
        })
      ),
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* =================== Helpers =================== */

function slimFile(f: ReportFileRow): SlimFile {
  return {
    id: f.id,
    original_name: f.original_name,
    mime_type: f.mime_type ?? "application/pdf",
    size_bytes: f.size_bytes,
    uploaded_at: f.uploaded_at,
  };
}

function slimComment(c: ReportCommentRow): SlimComment {
  return {
    id: c.id,
    user_id: c.user_id,
    user_name: c.user_name ?? null,
    text: c.text,
    created_at: c.created_at,
  };
}

function serializeReport(
  r: ReportRow & Partial<{ inbox_status: string | null; unread: number | boolean | null; read_at: string | null }>,
  extra: {
    files?: SlimFile[];
    comments?: SlimComment[];
    inboxStatus?: string | null;
    unread?: boolean;
    readAt?: string | null;
    recipients?: Recipient[];
  }
): SerializedReport {
  return {
    id: r.id,
    title: r.title,
    type: r.type ?? null,
    summary: r.summary ?? null,
    periodStart: r.period_start ?? null,
    periodEnd: r.period_end ?? null,
    status: r.status,
    authorName: r.author_name ?? null,
    files: extra.files ?? [],
    comments: extra.comments ?? [],
    inboxStatus: extra.inboxStatus ?? null,
    unread: Boolean(extra.unread),
    readAt: extra.readAt ?? null,
    recipients: extra.recipients ?? [],
  };
}

/**
 * groupByNumber : regroupe des lignes par une clé numérique (ex: report_id) sans utiliser `any`.
 */
function groupByNumber<T extends Record<K, number>, K extends keyof T, U>(
  rows: T[],
  key: K,
  map: (x: T) => U
): Map<number, U[]> {
  const m = new Map<number, U[]>();
  for (const r of rows) {
    const rid = r[key];
    const list = m.get(rid) ?? [];
    list.push(map(r));
    m.set(rid, list);
  }
  return m;
}
