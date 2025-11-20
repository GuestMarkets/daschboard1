export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "../../../../../lib/db";
import { getAuthUserId } from "../../../../../lib/auth_user";

type SubTaskRow = {
  id: number;
  title: string;
  description: string | null;
  done: 0 | 1;
};

type TaskItem = {
  id: number;
  title: string;
  description: string | null;
  dueDate: string; // YYYY-MM-DD
  status: "todo" | "in_progress" | "blocked" | "done";
  progress: number;
  performance: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string | null;
  subtasks: SubTaskRow[];
};

/** Représente une ligne renvoyée par MySQL pour la jointure + JSON_ARRAYAGG */
type TaskDbRow = RowDataPacket & {
  id: number | string;
  title: string;
  description: string | null;
  due_date: Date | string | null;
  status: "todo" | "in_progress" | "blocked" | "done";
  progress: number | string | null;
  performance: number | string | null;
  created_by: number | string;
  created_at: string;
  updated_at: string | null;
  // MySQL peut renvoyer du JSON comme string ou objet déjà parsé selon la config.
  subtasks: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(n: number | string | null | undefined): number {
  if (typeof n === "number") return n;
  if (typeof n === "string") {
    const parsed = Number(n);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateYYYYMMDD(value: Date | string | null): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // suppose une string "YYYY-MM-DD..." : on tronque
  return value.slice(0, 10);
}

function isSubTaskLike(u: unknown): u is SubTaskRow {
  if (!isRecord(u)) return false;
  const id = "id" in u ? u.id : undefined;
  const title = "title" in u ? u.title : undefined;
  const done = "done" in u ? u.done : undefined;
  const description = "description" in u ? u.description : null;
  return (
    (typeof id === "number" || typeof id === "string") &&
    typeof title === "string" &&
    (done === 0 || done === 1) &&
    (typeof description === "string" || description === null)
  );
}

function parseSubtasks(input: unknown): SubTaskRow[] {
  let raw: unknown = input;

  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) return [];
  const cleaned: SubTaskRow[] = [];
  for (const item of raw) {
    if (item == null) continue;
    if (isSubTaskLike(item)) {
      cleaned.push({
        id: typeof item.id === "number" ? item.id : Number(item.id),
        title: item.title,
        description: item.description ?? null,
        done: item.done,
      });
    } else if (isRecord(item)) {
      // tentative de normalisation souple
      const idVal = "id" in item ? item.id : null;
      const titleVal = "title" in item ? item.title : null;
      const doneVal = "done" in item ? item.done : 0;
      const descVal = "description" in item ? item.description : null;
      if (
        (typeof idVal === "number" || typeof idVal === "string") &&
        typeof titleVal === "string" &&
        (doneVal === 0 || doneVal === 1)
      ) {
        cleaned.push({
          id: typeof idVal === "number" ? idVal : Number(idVal),
          title: titleVal,
          description:
            typeof descVal === "string" ? descVal : descVal === null ? null : null,
          done: doneVal,
        });
      }
    }
  }
  return cleaned;
}

function mapRow(r: TaskDbRow): TaskItem {
  return {
    id: Number(r.id),
    title: r.title,
    description: r.description,
    dueDate: toDateYYYYMMDD(r.due_date),
    status: r.status,
    progress: toNumber(r.progress),
    performance: toNumber(r.performance),
    createdBy: Number(r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
    subtasks: parseSubtasks(r.subtasks).filter(Boolean),
  };
}

export async function GET(req: Request) {
  try {
    const userId = await getAuthUserId();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const status = (url.searchParams.get("status") || "").trim();

    const where: string[] = ["t.created_by = ?"];
    const params: Array<string | number> = [userId];

    if (q) {
      where.push("(t.title LIKE ? OR t.description LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status) {
      where.push("t.status = ?");
      params.push(status);
    }

    const pool = getPool();
    const sql = `
      SELECT
        t.*,
        COALESCE(
          JSON_ARRAYAGG(
            IF(st.id IS NULL, NULL,
              JSON_OBJECT('id', st.id, 'title', st.title, 'description', st.description, 'done', st.done)
            )
          ),
          JSON_ARRAY()
        ) AS subtasks
      FROM tasks t
      LEFT JOIN task_subtasks st ON st.task_id = t.id
      WHERE ${where.join(" AND ")}
      GROUP BY t.id
      ORDER BY t.due_date ASC, t.id DESC
      LIMIT 500
    `;

    const [rows] = await pool.query<TaskDbRow[]>(sql, params);
    const items = rows.map(mapRow);
    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type CreateBody = {
  title?: string;
  description?: string | null;
  dueDate?: string; // YYYY-MM-DD
};

export async function POST(req: Request) {
  try {
    const userId = await getAuthUserId();

    const rawBody: unknown = await req.json().catch(() => null);
    if (!isRecord(rawBody)) {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }

    const body = rawBody as CreateBody;

    const title = String(body.title ?? "").trim();
    const description = body.description ?? "";
    const dueDate = String(body.dueDate ?? "").trim(); // YYYY-MM-DD

    if (!title || !dueDate) {
      return NextResponse.json(
        { error: "Titre et échéance requis" },
        { status: 400 }
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    if (due.getTime() < today.getTime()) {
      return NextResponse.json(
        { error: "Échéance dans le passé" },
        { status: 400 }
      );
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [ins] = await conn.query<ResultSetHeader>(
        "INSERT INTO tasks (title, description, due_date, created_by) VALUES (?,?,?,?)",
        [title, description || null, dueDate, userId]
      );
      const taskId = ins.insertId;

      const [rows] = await conn.query<TaskDbRow[]>(
        `SELECT t.*,
                COALESCE(JSON_ARRAYAGG(NULL), JSON_ARRAY()) AS subtasks
         FROM tasks t
         WHERE t.id=? GROUP BY t.id`,
        [taskId]
      );

      await conn.commit();
      return NextResponse.json({ item: mapRow(rows[0]) }, { status: 201 });
    } catch (err: unknown) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
