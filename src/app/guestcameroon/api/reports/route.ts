export const runtime = "nodejs";

import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../lib/db"; // ← 5 niveaux
import { ok, err, getMe, sqlDate } from "../_utils";

type Scope = "sent" | "received";

/** ———————— Types DB ———————— */
type DbRow<T> = T & RowDataPacket;

interface ReportRowBase {
  id: number | string;
  title: string | null;
  type: string | null;
  summary: string | null;
  period_start: string | Date | null;
  period_end: string | Date | null;
  status: string | null;
  authorName?: string | null;
  created_at?: string | Date;
}

/** Remplace l’interface vide par un alias de type pour éviter no-empty-object-type */
type ReportRowSent = ReportRowBase;

interface ReportRowReceived extends ReportRowBase {
  inboxStatus: string | null;
  unread: 0 | 1 | boolean | null;
  read_at: string | Date | null;
}

interface RecipientRow {
  report_id: number | string;
  user_id: number | string;
  name: string | null;
}

interface FileRow {
  id: number | string;
  report_id: number | string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | string | null;
  uploaded_at: string | Date | null;
}

/** ———————— Types API ———————— */
interface PostBody {
  title?: string;
  type?: "daily" | "weekly" | "monthly" | "incident" | "meeting" | "other" | string;
  summary?: string | null;
  periodStart?: string;
  periodEnd?: string;
  projectId?: number | null;
  departmentId?: number | null;
  recipientIds?: number[];
  fileName?: string;
  fileContent?: string; // base64
  mimeType?: string;
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "Erreur";
  }
}

export async function GET(req: Request) {
  try {
    const me = await getMe();
    const url = new URL(req.url);
    const scopeParam = url.searchParams.get("scope") as Scope | null;
    const scope: Scope = scopeParam ?? "sent";

    if (scope === "sent") {
      const [rowsRaw] = await pool.execute<DbRow<ReportRowSent>[]>(
        `SELECT r.id, r.title, r.type, r.summary, r.period_start, r.period_end, r.status,
                a.name AS authorName
           FROM reports r
           JOIN users a ON a.id = r.author_id
          WHERE r.author_id = ?
          ORDER BY r.created_at DESC`,
        [me.id]
      );

      const ids = rowsRaw.map((r) => Number(r.id));
      const placeholders = ids.map(() => "?").join(",");

      const rrecsRaw: DbRow<RecipientRow>[] = ids.length
        ? (await pool.execute<DbRow<RecipientRow>[]>(
            `SELECT rr.report_id, u.id AS user_id, u.name
               FROM report_recipients rr
               JOIN users u ON u.id = rr.user_id
              WHERE rr.report_id IN (${placeholders})`,
            ids
          ))[0]
        : [];

      const filesRaw: DbRow<FileRow>[] = ids.length
        ? (await pool.execute<DbRow<FileRow>[]>(
            `SELECT id, report_id, original_name, mime_type, size_bytes, uploaded_at
               FROM report_files
              WHERE report_id IN (${placeholders})
              ORDER BY uploaded_at DESC`,
            ids
          ))[0]
        : [];

      const items = rowsRaw.map((r) => {
        const rid = Number(r.id);

        const rf = filesRaw
          .filter((f) => Number(f.report_id) === rid)
          .map((f) => ({
            id: Number(f.id),
            original_name: String(f.original_name ?? ""),
            mime_type: String(f.mime_type ?? ""),
            size_bytes: Number(f.size_bytes ?? 0),
            uploaded_at: String(f.uploaded_at ?? ""),
          }));

        const recs = rrecsRaw
          .filter((x) => Number(x.report_id) === rid)
          .map((x) => ({ id: Number(x.user_id), name: String(x.name ?? "") }));

        return {
          id: rid,
          title: String(r.title ?? ""),
          type: String(r.type ?? ""),
          summary: r.summary != null ? String(r.summary) : null,
          periodStart: sqlDate(r.period_start),
          periodEnd: sqlDate(r.period_end),
          status: String(r.status ?? ""),
          files: rf,
          comments: [] as unknown[], // structure comment laissée vide et typée innocue
          authorName: r.authorName != null ? String(r.authorName) : null,
          recipients: recs,
        };
      });

      return ok({ items });
    } else {
      // received
      const [rowsRaw] = await pool.execute<DbRow<ReportRowReceived>[]>(
        `SELECT r.id, r.title, r.type, r.summary, r.period_start, r.period_end, r.status,
                a.name AS authorName,
                rr.status AS inboxStatus, rr.unread, rr.read_at
           FROM report_recipients rr
           JOIN reports r ON r.id = rr.report_id
           JOIN users a ON a.id = r.author_id
          WHERE rr.user_id = ?
            AND r.status <> 'draft'
          ORDER BY r.created_at DESC`,
        [me.id]
      );

      const ids = rowsRaw.map((r) => Number(r.id));
      const placeholders = ids.map(() => "?").join(",");

      const filesRaw: DbRow<FileRow>[] = ids.length
        ? (await pool.execute<DbRow<FileRow>[]>(
            `SELECT id, report_id, original_name, mime_type, size_bytes, uploaded_at
               FROM report_files
              WHERE report_id IN (${placeholders})
              ORDER BY uploaded_at DESC`,
            ids
          ))[0]
        : [];

      const items = rowsRaw.map((r) => {
        const rid = Number(r.id);
        const rf = filesRaw
          .filter((f) => Number(f.report_id) === rid)
          .map((f) => ({
            id: Number(f.id),
            original_name: String(f.original_name ?? ""),
            mime_type: String(f.mime_type ?? ""),
            size_bytes: Number(f.size_bytes ?? 0),
            uploaded_at: String(f.uploaded_at ?? ""),
          }));
        return {
          id: rid,
          title: String(r.title ?? ""),
          type: String(r.type ?? ""),
          summary: r.summary != null ? String(r.summary) : null,
          periodStart: sqlDate(r.period_start),
          periodEnd: sqlDate(r.period_end),
          status: String(r.status ?? ""),
          files: rf,
          comments: [] as unknown[],
          authorName: r.authorName != null ? String(r.authorName) : null,
          inboxStatus: String(r.inboxStatus ?? ""),
          unread: Boolean(r.unread),
          readAt: r.read_at ? String(r.read_at) : null,
        };
      });

      return ok({ items });
    }
  } catch (e: unknown) {
    return err(getErrorMessage(e), 500);
  }
}

export async function POST(req: Request) {
  try {
    const me = await getMe();

    // Le body est "unknown" à l’entrée → on tente de le conformer à PostBody
    const raw = (await req.json().catch(() => ({}))) as unknown;
    const body: PostBody = (typeof raw === "object" && raw !== null ? raw : {}) as PostBody;

    const {
      title,
      type,
      summary,
      periodStart,
      periodEnd,
      projectId,
      departmentId,
      recipientIds,
      fileName,
      fileContent,
      mimeType,
    } = body;

    if (!title || !type || !periodStart || !periodEnd) {
      return err("Champs requis manquants", 400);
    }

    const allowedTypes = new Set(["daily", "weekly", "monthly", "incident", "meeting", "other"]);
    if (!allowedTypes.has(String(type))) {
      return err("Type invalide", 400);
    }

    // Crée en "draft"
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO reports (author_id, title, type, summary, period_start, period_end, project_id, department_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW(), NOW())`,
      [me.id, title, type, summary ?? null, periodStart, periodEnd, projectId ?? null, departmentId ?? null]
    );
    const reportId = Number(res.insertId);

    // Destinataires
    if (Array.isArray(recipientIds) && recipientIds.length) {
      const values = recipientIds.map((uid) => [reportId, uid, "submitted", 1] as const);
      await pool.execute(
        `INSERT INTO report_recipients (report_id, user_id, status, unread)
         VALUES ${values.map(() => "(?, ?, ?, ?)").join(",")}`,
        // on a un tableau de tuples [number, number, string, number] → on l’aplatit proprement
        values.flat() as unknown[]
      );
    }

    // Fichier (base64)
    if (fileName && fileContent) {
      const buf = Buffer.from(String(fileContent), "base64");
      const [r1] = await pool.execute<ResultSetHeader>(
        `INSERT INTO report_files (report_id, user_id, original_name, mime_type, size_bytes, uploaded_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [reportId, me.id, String(fileName), mimeType || "application/pdf", buf.length]
      );

      await pool.execute(
        `INSERT INTO report_file_blobs (report_file_id, content) VALUES (?, ?)`,
        [Number(r1.insertId), buf]
      );
    }

    return ok({ ok: true, id: reportId });
  } catch (e: unknown) {
    return err(getErrorMessage(e), 500);
  }
}
