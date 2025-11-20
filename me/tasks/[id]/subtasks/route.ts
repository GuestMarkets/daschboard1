export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "../../../../../../../lib/db";
import { getAuthUserId } from "../../../../../../../lib/auth_user";

/* ---------- Types SQL & API ---------- */
type OwnRow = RowDataPacket & {
  id: number;
};

type SubtaskRow = RowDataPacket & {
  id: number;
  title: string;
  description: string | null;
  done: 0 | 1 | number; // MySQL renvoie souvent 0/1 sous forme number
  created_at: string | Date;
};

type SubtaskItem = {
  id: number;
  title: string;
  description: string | null;
  done: 0 | 1;
  createdAt: string | Date;
};

/* ---------- Utils ---------- */
function isValidId(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function errorMessage(e: unknown, fallback = "Erreur serveur"): string {
  return e instanceof Error ? e.message : fallback;
}

/* ============================================================
   GET /api/me/tasks/[taskId]/subtasks
   ============================================================ */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthUserId();

    // ⚠️ Depuis les dernières versions de Next, params est un Promise
    const { id } = await context.params;
    const taskId = Number(id);
    if (!isValidId(taskId)) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const pool = getPool();

    // Vérifier que la tâche appartient à l'utilisateur
    const [own] = await pool.query<OwnRow[]>(
      "SELECT id FROM tasks WHERE id=? AND created_by=?",
      [taskId, userId]
    );
    if (own.length === 0) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }

    // Récupérer les sous-tâches
    const [rows] = await pool.query<SubtaskRow[]>(
      "SELECT id, title, description, done, created_at FROM task_subtasks WHERE task_id=? ORDER BY id DESC",
      [taskId]
    );

    const items: SubtaskItem[] = rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      description: r.description,
      done: (Number(r.done) === 1 ? 1 : 0) as 0 | 1,
      createdAt: r.created_at,
    }));

    return NextResponse.json({ items });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

/* ============================================================
   POST /api/me/tasks/[taskId]/subtasks
   body: { title: string; description?: string }
   ============================================================ */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthUserId();

    // ⚠️ params = Promise
    const { id } = await context.params;
    const taskId = Number(id);
    if (!isValidId(taskId)) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const rawBody = (await req
      .json()
      .catch(() => null)) as unknown;
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }

    // Extraction typée sans any
    const body = rawBody as { title?: unknown; description?: unknown };

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Titre requis" }, { status: 400 });
    }

    let description: string | null = null;
    if (typeof body.description === "string") {
      description = body.description;
    } else if (body.description != null) {
      // Si fourni mais pas string, on force en string
      description = String(body.description);
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Vérifier appartenance
      const [own] = await conn.query<OwnRow[]>(
        "SELECT id FROM tasks WHERE id=? AND created_by=?",
        [taskId, userId]
      );
      if (own.length === 0) {
        await conn.rollback();
        return NextResponse.json({ error: "Introuvable" }, { status: 404 });
      }

      // Insert
      const [ins] = await conn.query<ResultSetHeader>(
        "INSERT INTO task_subtasks (task_id, title, description, done) VALUES (?,?,?,0)",
        [taskId, title, description]
      );
      const subId = ins.insertId;

      // Select nouvel enregistrement
      const [row] = await conn.query<SubtaskRow[]>(
        "SELECT id, title, description, done, created_at FROM task_subtasks WHERE id=?",
        [subId]
      );

      await conn.commit();

      const r = row[0];
      const item: SubtaskItem = {
        id: Number(r.id),
        title: r.title,
        description: r.description,
        done: (Number(r.done) === 1 ? 1 : 0) as 0 | 1,
        createdAt: r.created_at,
      };

      return NextResponse.json({ item }, { status: 201 });
    } catch (err: unknown) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
