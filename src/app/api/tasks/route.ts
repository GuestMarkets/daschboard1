// app/api/tasks/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/** ----- Types ----- */
type SqlDate = string | Date;

type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | (string & {});

interface AssigneeRow {
  id: number;
  name: string | null;
  email: string | null;
}

interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  due_date: SqlDate;
  status: TaskStatus;
  progress: number | null;
  performance: number | null;
  created_by: number;
  created_at: SqlDate;
  updated_at: SqlDate;
  /** Peut être un tableau (si mysql2 renvoie JSON déjà parsé) ou une string JSON */
  assignees?: AssigneeRow[] | string | null;
}

interface TaskDTO {
  id: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: TaskStatus;
  progress: number;
  performance: number;
  createdBy: number;
  createdAt: SqlDate;
  updatedAt: SqlDate;
  assignees: AssigneeRow[];
  assigneeIds: number[];
}

interface JwtPayloadMinimal {
  id?: number;
  user_id?: number;
  is_admin?: boolean;
}

/** ----- Utils ----- */
function toISODateOnly(d: SqlDate | undefined | null): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  // si déjà "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isAssigneeRow(v: unknown): v is AssigneeRow {
  if (!isRecord(v)) return false;
  return typeof v.id === "number" && ("name" in v) && ("email" in v);
}

function normalizeAssignees(raw: AssigneeRow[] | string | null | undefined): AssigneeRow[] {
  if (!raw) return [];
  let arr: unknown;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    arr = raw;
  }
  return Array.isArray(arr) ? arr.filter(isAssigneeRow) : [];
}

/** Mappe un enregistrement SQL -> JSON front */
function mapTaskRow(row: TaskRow): TaskDTO {
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
    assigneeIds: assignees.map((a) => Number(a.id)),
  };
}

export async function GET(req: Request) {
  try {
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const payloadUnknown = await verifyJwt(token);
    if (!payloadUnknown) return NextResponse.json({ error: "Token invalide" }, { status: 401 });

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const status = (url.searchParams.get("status") || "").trim(); // todo|in_progress|blocked|done
    const assigneeId = Number(url.searchParams.get("assigneeId") || 0);

    const pool = getPool();

    const where: string[] = [];
    const params: Array<string | number> = [];

    if (q) {
      where.push("(t.title LIKE ? OR t.description LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status) {
      where.push("t.status = ?");
      params.push(status);
    }
    if (assigneeId > 0) {
      where.push(
        "EXISTS (SELECT 1 FROM task_assignees ta2 WHERE ta2.task_id = t.id AND ta2.user_id = ?)"
      );
      params.push(assigneeId);
    }

    const sql = `
      SELECT
        t.*,
        COALESCE(
          JSON_ARRAYAGG(
            IF(u.id IS NULL, NULL, JSON_OBJECT('id', u.id, 'name', u.name, 'email', u.email))
          ),
          JSON_ARRAY()
        ) AS assignees
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      LEFT JOIN users u ON u.id = ta.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY t.id
      ORDER BY t.due_date ASC, t.id DESC
      LIMIT 500
    `;

    const [rows] = await pool.query<TaskRow[]>(sql, params);

    const items: TaskDTO[] = rows.map((r) => {
      // Nettoyage des NULL et normalisation du JSON_ARRAYAGG
      const normalized = { ...r, assignees: normalizeAssignees(r.assignees) };
      return mapTaskRow(normalized);
    });

    return NextResponse.json({ items });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error("Erreur serveur");
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const payload = (await verifyJwt(token)) as JwtPayloadMinimal | null;
    if (!payload) return NextResponse.json({ error: "Token invalide" }, { status: 401 });

    const bodyUnknown: unknown = await req.json().catch(() => null);
    if (!isRecord(bodyUnknown)) {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }

    const b = bodyUnknown as {
      title?: unknown;
      description?: unknown;
      dueDate?: unknown; // "YYYY-MM-DD"
      assigneeIds?: unknown;
    };

    const title = String(b.title ?? "").trim();
    const description = (b.description ?? "").toString();
    const dueDate = String(b.dueDate ?? "").trim();

    // Typage strict pour assigneeIds
    const assigneeIds: number[] = Array.isArray(b.assigneeIds)
      ? (b.assigneeIds as unknown[])
          .map((n) => Number(n))
          .filter((n): n is number => Number.isFinite(n) && n > 0)
      : [];

    if (!title || !dueDate) {
      return NextResponse.json({ error: "Titre et échéance requis" }, { status: 400 });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    if (due.getTime() < today.getTime()) {
      return NextResponse.json({ error: "Échéance dans le passé" }, { status: 400 });
    }

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const userId = (payload.user_id ?? payload.id) ?? 0;

      const [ins] = await conn.query<ResultSetHeader>(
        "INSERT INTO tasks (title, description, due_date, created_by) VALUES (?,?,?,?)",
        [title, description || null, dueDate, Number(userId)]
      );
      const taskId = ins.insertId;

      if (assigneeIds.length) {
        const values: Array<[number, number]> = assigneeIds.map((uid) => [taskId, uid]);
        // ts-expect-error mysql2 typings accept tuple array via Values?
        await conn.query("INSERT INTO task_assignees (task_id, user_id) VALUES ?", [values]);
      }

      const [rowTask] = await conn.query<TaskRow[]>(
        `SELECT t.*, JSON_ARRAYAGG(JSON_OBJECT('id', u.id, 'name', u.name, 'email', u.email)) AS assignees
         FROM tasks t
         LEFT JOIN task_assignees ta ON ta.task_id = t.id
         LEFT JOIN users u ON u.id = ta.user_id
         WHERE t.id=?
         GROUP BY t.id`,
        [taskId]
      );

      await conn.commit();

      const selected = rowTask[0];
      const item = mapTaskRow({
        ...selected,
        assignees: normalizeAssignees(selected?.assignees),
      } as TaskRow);

      return NextResponse.json({ item }, { status: 201 });
    } catch (inner: unknown) {
      await conn.rollback();
      throw inner;
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error("Erreur serveur");
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
