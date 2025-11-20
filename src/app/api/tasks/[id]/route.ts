// app/api/tasks/[taskId]/route.ts
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getPool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/* ================== Types ================== */

type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

interface DBAssignee {
  id: number | string;
  name: string | null;
  email: string | null;
}

interface DBTaskRow extends RowDataPacket {
  id: number | string;
  title: string;
  description: string | null;
  due_date: Date | string | null;
  status: TaskStatus;
  progress?: number | string | null;
  performance?: number | string | null;
  created_by: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  assignees?: string | DBAssignee[] | null;
}

interface ApiAssignee {
  id: number;
  name: string | null;
  email: string | null;
}

interface ApiTask {
  id: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: TaskStatus;
  progress: number;
  performance: number;
  createdBy: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  assignees: ApiAssignee[];
  assigneeIds: number[];
}

/* ================== Utils ================== */

function normalizeAssignees(raw: DBTaskRow["assignees"]): ApiAssignee[] {
  let parsed: unknown;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = [];
    }
  } else {
    parsed = raw ?? [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((a) => {
      const obj = a as DBAssignee;
      const idNum = Number(obj?.id);
      return {
        id: Number.isFinite(idNum) ? idNum : 0,
        name: typeof obj?.name === "string" ? obj.name : null,
        email: typeof obj?.email === "string" ? obj.email : null,
      };
    })
    .filter((a) => a.id > 0);
}

function toISODateOnly(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function mapTask(row: DBTaskRow): ApiTask {
  const assignees = normalizeAssignees(row.assignees);
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description ?? null,
    dueDate: toISODateOnly(row.due_date),
    status: row.status,
    progress: Number(row.progress ?? 0),
    performance: Number(row.performance ?? 0),
    createdBy: Number(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignees,
    assigneeIds: assignees.map((a) => a.id),
  };
}

/* ================== Handlers ================== */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;

    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const payload = await verifyJwt(token);
    if (!payload) return NextResponse.json({ error: "Token invalide" }, { status: 401 });

    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const pool = getPool();
    const [rows] = await pool.query<DBTaskRow[]>(
      `SELECT t.*,
              COALESCE(
                JSON_ARRAYAGG(
                  CASE WHEN u.id IS NULL THEN NULL
                       ELSE JSON_OBJECT('id', u.id, 'name', u.name, 'email', u.email)
                  END
                ),
                JSON_ARRAY()
              ) AS assignees
       FROM tasks t
       LEFT JOIN task_assignees ta ON ta.task_id = t.id
       LEFT JOIN users u ON u.id = ta.user_id
       WHERE t.id = ?
       GROUP BY t.id`,
      [id]
    );

    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item: mapTask(rows[0]) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params;

    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const payload = await verifyJwt(token);
    if (!payload) return NextResponse.json({ error: "Token invalide" }, { status: 401 });

    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    const up: Record<string, unknown> = {};

    if ("title" in b) up.title = String(b.title ?? "").trim();
    if ("description" in b) up.description = (b.description ?? "").toString();

    if ("dueDate" in b) {
      const d = String(b.dueDate ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return NextResponse.json({ error: "dueDate invalide" }, { status: 400 });
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dv = new Date(d);   dv.setHours(0, 0, 0, 0);
      if (dv.getTime() < today.getTime()) {
        return NextResponse.json({ error: "Échéance dans le passé" }, { status: 400 });
      }
      up.due_date = d;
    }

    if ("status" in b) {
      const s = String(b.status ?? "");
      if (!["todo", "in_progress", "blocked", "done"].includes(s)) {
        return NextResponse.json({ error: "status invalide" }, { status: 400 });
      }
      up.status = s as TaskStatus;
    }

    if ("progress" in b) {
      const p = Number(b.progress ?? 0);
      if (!(p >= 0 && p <= 100)) {
        return NextResponse.json({ error: "progress (0..100)" }, { status: 400 });
      }
      up.progress = p;
    }

    if ("performance" in b) {
      const p2 = Number(b.performance ?? 0);
      if (!(p2 >= 0 && p2 <= 100)) {
        return NextResponse.json({ error: "performance (0..100)" }, { status: 400 });
      }
      up.performance = p2;
    }

    const assigneeIds: number[] | null = Array.isArray(b.assigneeIds)
      ? ((b.assigneeIds as unknown[]) ?? [])
          .map((n: unknown): number => Number(n))
          .filter((n: number): n is number => Number.isFinite(n) && n > 0)
      : null;

    if (!Object.keys(up).length && !assigneeIds) {
      return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 });
    }

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      if (Object.keys(up).length) {
        const fields = Object.keys(up).map((k) => `${k}=?`).join(", ");
        await conn.query<ResultSetHeader>(`UPDATE tasks SET ${fields} WHERE id=?`, [
          ...Object.values(up),
          id,
        ]);
      }

      if (assigneeIds) {
        await conn.query("DELETE FROM task_assignees WHERE task_id=?", [id]);

        if (assigneeIds.length) {
          const values: Array<[number, number]> = assigneeIds.map((uid) => [id, uid]);
          // mysql2 supporte l'insert bulk avec VALUES ?
          await conn.query("INSERT INTO task_assignees (task_id, user_id) VALUES ?", [values]);
        }
      }

      const [rows] = await conn.query<DBTaskRow[]>(
        `SELECT t.*,
                COALESCE(
                  JSON_ARRAYAGG(
                    CASE WHEN u.id IS NULL THEN NULL
                         ELSE JSON_OBJECT('id', u.id, 'name', u.name, 'email', u.email)
                    END
                  ),
                  JSON_ARRAY()
                ) AS assignees
         FROM tasks t
         LEFT JOIN task_assignees ta ON ta.task_id = t.id
         LEFT JOIN users u ON u.id = ta.user_id
         WHERE t.id = ?
         GROUP BY t.id`,
        [id]
      );

      await conn.commit();

      if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ item: mapTask(rows[0]) });
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
