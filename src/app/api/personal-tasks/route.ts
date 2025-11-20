// app/api/personal-tasks/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

type Status = "todo" | "in_progress" | "blocked" | "done";

type PersonalTask = {
  id: number;
  title: string;
  description: string | null;
  dueDate: string;           // YYYY-MM-DD
  status: Status;
  progress: number;          // 0..100
  performance: number;       // 0..100
  createdAt: string;
  updatedAt: string;
};

/** Représentation d'une ligne SQL telle que renvoyée par mysql2 */
interface TaskRow extends RowDataPacket {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  due_date: Date | string | null;
  status: Status;
  progress: number | null;
  performance: number | null;
  created_at: string;
  updated_at: string;
}

/** Charge utile minimale attendue dans le JWT émis par notre back */
type JwtPayloadMinimal = {
  user_id?: number;
  id?: number;
};

function mapRow(r: TaskRow): PersonalTask {
  return {
    id: Number(r.id),
    title: String(r.title),
    description: r.description ?? null,
    dueDate:
      typeof r.due_date === "string"
        ? r.due_date.slice(0, 10)
        : r.due_date instanceof Date
        ? r.due_date.toISOString().slice(0, 10)
        : "",
    status: r.status,
    progress: Number(r.progress ?? 0),
    performance: Number(r.performance ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function extractUserId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as JwtPayloadMinimal;
  const candidate =
    typeof p.user_id === "number"
      ? p.user_id
      : typeof p.id === "number"
      ? p.id
      : null;
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
    ? candidate
    : null;
}

export async function GET(req: Request) {
  try {
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload: unknown = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    const me = extractUserId(payload);
    if (!me) {
      return NextResponse.json({ error: "Utilisateur invalide" }, { status: 400 });
    }

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const status = (url.searchParams.get("status") || "").trim() as Status | "";
    const sort = (url.searchParams.get("sort") || "due") as
      | "due"
      | "name"
      | "progress";

    const pool = getPool();

    const where: string[] = ["t.user_id = ?"];
    const params: Array<string | number> = [me];

    if (q) {
      where.push("(t.title LIKE ? OR t.description LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status && ["todo", "in_progress", "blocked", "done"].includes(status)) {
      where.push("t.status = ?");
      params.push(status);
    }

    const order =
      sort === "name"
        ? "ORDER BY t.title ASC"
        : sort === "progress"
        ? "ORDER BY t.progress DESC, t.due_date ASC"
        : "ORDER BY t.due_date ASC, t.id DESC";

    const [rows] = await pool.query<TaskRow[]>(
      `SELECT t.*
       FROM tasks t
       WHERE ${where.join(" AND ")}
       ${order}
       LIMIT 500`,
      params
    );

    const items: PersonalTask[] = rows.map(mapRow);
    return NextResponse.json({ items });
  } catch (e: unknown) {
    console.error(e);
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload: unknown = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    const me = extractUserId(payload);
    if (!me) {
      return NextResponse.json({ error: "Utilisateur invalide" }, { status: 400 });
    }

    const bodyRaw: unknown = await req.json().catch(() => null);
    if (!bodyRaw || typeof bodyRaw !== "object") {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }

    const body = bodyRaw as {
      title?: unknown;
      description?: unknown;
      dueDate?: unknown;
    };

    const title = String(body.title ?? "").trim();
    const description =
      body.description === null || body.description === undefined
        ? ""
        : String(body.description);
    const dueDate = String(body.dueDate ?? "").trim(); // YYYY-MM-DD

    if (!title || !dueDate) {
      return NextResponse.json(
        { error: "Titre et échéance requis" },
        { status: 400 }
      );
    }

    // pas de passé
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    if (due.getTime() < today.getTime()) {
      return NextResponse.json({ error: "Échéance dans le passé" }, { status: 400 });
    }

    const pool = getPool();
    const [ins] = await pool.query<ResultSetHeader>(
      "INSERT INTO tasks (user_id, title, description, due_date) VALUES (?,?,?,?)",
      [me, title, description || null, dueDate]
    );
    const taskId = ins.insertId;

    const [row] = await pool.query<TaskRow[]>(
      "SELECT * FROM tasks WHERE id=? LIMIT 1",
      [taskId]
    );

    return NextResponse.json({ item: mapRow(row[0]) }, { status: 201 });
  } catch (e: unknown) {
    console.error(e);
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
