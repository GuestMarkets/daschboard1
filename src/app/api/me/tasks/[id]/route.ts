export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import type {
  Pool,
  PoolConnection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";
import { getPool } from "../../../../../../lib/db";
import { getAuthUserId } from "../../../../../../lib/auth_user";

/* ---------- Types ---------- */

type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

interface Subtask {
  id: number;
  title: string;
  description: string | null;
  done: boolean | 0 | 1;
}

interface TaskRowRaw extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  due_date: Date | string | null;
  status: TaskStatus;
  progress: number | null;
  performance: number | null;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string | null;
  // MySQL JSON aggregation can come back as a JSON string or as an array depending on configuration
  subtasks: string | Subtask[] | null;
}

interface TaskItem {
  id: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: TaskStatus;
  progress: number;
  performance: number;
  createdBy: number;
  createdAt: Date | string;
  updatedAt: Date | string | null;
  subtasks: Subtask[];
}

/* ---------- Utils ---------- */

function mapRow(r: TaskRowRaw): TaskItem {
  // normalize due date to YYYY-MM-DD or null
  let dueDate: string | null = null;
  if (r.due_date) {
    if (r.due_date instanceof Date) {
      dueDate = r.due_date.toISOString().slice(0, 10);
    } else if (typeof r.due_date === "string") {
      dueDate = r.due_date;
    }
  }

  // normalize subtasks (can be JSON string or array)
  let subtasks: Subtask[] = [];
  if (Array.isArray(r.subtasks)) {
    subtasks = r.subtasks.filter(Boolean) as Subtask[];
  } else if (typeof r.subtasks === "string" && r.subtasks) {
    try {
      const parsed = JSON.parse(r.subtasks);
      if (Array.isArray(parsed)) {
        subtasks = (parsed as unknown[]).filter(Boolean) as Subtask[];
      }
    } catch {
      // ignore JSON parse errors, keep empty subtasks
    }
  }

  return {
    id: Number(r.id),
    title: r.title,
    description: r.description,
    dueDate,
    status: r.status,
    progress: Number(r.progress ?? 0),
    performance: Number(r.performance ?? 0),
    createdBy: Number(r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
    subtasks,
  };
}

async function fetchOneOwned(
  conn: Pool | PoolConnection,
  id: number,
  userId: number
): Promise<TaskRowRaw | null> {
  const [rows] = await conn.query<(TaskRowRaw & RowDataPacket)[]>(
    `SELECT t.*,
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
     WHERE t.id=? AND t.created_by=?
     GROUP BY t.id`,
    [id, userId]
  );
  return rows[0] ?? null;
}

/* ---------- GET / PATCH / DELETE ---------- */

/**
 * Note de typage :
 * Le validateur interne attend (context: { params: Promise<{ id: string }> }).
 * On s'aligne et on `await` context.params.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthUserId();
    const { id: idParam } = await context.params;
    const id = Number(idParam);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const pool = getPool() as unknown as Pool;
    const row = await fetchOneOwned(pool, id, userId);
    if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

    return NextResponse.json({ item: mapRow(row) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthUserId();
    const { id: idParam } = await context.params;
    const id = Number(idParam);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const body = await req.json().catch(() => null as unknown);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }

    const up: Partial<{
      title: string;
      description: string;
      due_date: string;
      status: TaskStatus;
      progress: number;
      performance: number;
    }> = {};

    if ("title" in (body as Record<string, unknown>)) {
      up.title = String((body as Record<string, unknown>).title ?? "").trim();
    }
    if ("description" in (body as Record<string, unknown>)) {
      const d = (body as Record<string, unknown>).description;
      up.description = (d ?? "").toString();
    }

    if ("dueDate" in (body as Record<string, unknown>)) {
      const d = String((body as Record<string, unknown>).dueDate ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        return NextResponse.json({ error: "dueDate invalide" }, { status: 400 });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dv = new Date(d);
      dv.setHours(0, 0, 0, 0);
      if (dv.getTime() < today.getTime())
        return NextResponse.json({ error: "Échéance dans le passé" }, { status: 400 });
      up.due_date = d;
    }

    if ("status" in (body as Record<string, unknown>)) {
      const s = String((body as Record<string, unknown>).status ?? "");
      if (!["todo", "in_progress", "blocked", "done"].includes(s))
        return NextResponse.json({ error: "status invalide" }, { status: 400 });
      up.status = s as TaskStatus;
    }

    if ("progress" in (body as Record<string, unknown>)) {
      const p = Number((body as Record<string, unknown>).progress ?? 0);
      if (!(p >= 0 && p <= 100))
        return NextResponse.json({ error: "progress (0..100)" }, { status: 400 });
      up.progress = p;
    }

    if ("performance" in (body as Record<string, unknown>)) {
      const p2 = Number((body as Record<string, unknown>).performance ?? 0);
      if (!(p2 >= 0 && p2 <= 100))
        return NextResponse.json({ error: "performance (0..100)" }, { status: 400 });
      up.performance = p2;
    }

    if (!Object.keys(up).length) {
      return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 });
    }

    const pool = getPool() as unknown as Pool;
    const conn = (await pool.getConnection()) as PoolConnection;

    try {
      await conn.beginTransaction();

      const row0 = await fetchOneOwned(conn, id, userId);
      if (!row0) {
        await conn.rollback();
        return NextResponse.json({ error: "Introuvable" }, { status: 404 });
      }

      const keys = Object.keys(up) as (keyof typeof up)[];
      const fields = keys.map((k) => `${k}=?`).join(", ");
      const values = keys.map((k) => up[k]!);

      await conn.query<ResultSetHeader>(
        `UPDATE tasks SET ${fields} WHERE id=?`,
        [...values, id]
      );

      const row = await fetchOneOwned(conn, id, userId);
      await conn.commit();
      return NextResponse.json({ item: mapRow(row as TaskRowRaw) });
    } catch (err) {
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

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthUserId();
    const { id: idParam } = await context.params;
    const id = Number(idParam);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const pool = getPool() as unknown as Pool;
    const conn = (await pool.getConnection()) as PoolConnection;

    try {
      await conn.beginTransaction();

      const [rows] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM tasks WHERE id=? AND created_by=?",
        [id, userId]
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        await conn.rollback();
        return NextResponse.json({ error: "Introuvable" }, { status: 404 });
      }

      await conn.query("DELETE FROM task_subtasks WHERE task_id=?", [id]);
      await conn.query("DELETE FROM tasks WHERE id=?", [id]);

      await conn.commit();
      return NextResponse.json({ ok: true });
    } catch (err) {
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
