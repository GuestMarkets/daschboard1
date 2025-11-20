// app/api/admin/department/tasks/[taskId]/subtasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../../lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

/** Permet de gérer à la fois { params: {…} } et { params: Promise<{…}> } */
type MaybePromise<T> = T | Promise<T>;
interface RouteContext {
  params: MaybePromise<{ id: string }>;
}

/** Modèle TS correspondant à la table `task_subtasks` */
interface TaskSubtask extends RowDataPacket {
  id: number;
  task_id: number;
  title: string;
  description: string | null;
  done: 0 | 1; // stocké en TINYINT(1)
  created_at: Date; // ou string selon votre config de driver
  updated_at?: Date | null;
}

/** Corps attendu pour la création */
interface CreateSubtaskBody {
  title: string;
  description?: string | null;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params; // marche si params est un objet ou une Promise
    const taskId = Number(id);
    if (!Number.isFinite(taskId)) {
      return NextResponse.json({ error: "Paramètre id invalide" }, { status: 400 });
    }

    const [rows] = await pool.query<TaskSubtask[]>(
      `SELECT * FROM task_subtasks WHERE task_id = ? ORDER BY created_at DESC`,
      [taskId]
    );

    return NextResponse.json({ items: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params; // marche si params est un objet ou une Promise
    const taskId = Number(id);
    if (!Number.isFinite(taskId)) {
      return NextResponse.json({ error: "Paramètre id invalide" }, { status: 400 });
    }

    // On parse prudemment le JSON
    const raw = (await req.json().catch(() => ({}))) as unknown;

    // Validation simple et affinage de type
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
    }

    const body = raw as Partial<CreateSubtaskBody>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description =
      typeof body.description === "string" ? body.description : null;

    if (!title) {
      return NextResponse.json({ error: "Titre requis" }, { status: 400 });
    }

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO task_subtasks (task_id, title, description, done, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [taskId, title, description, 0]
    );

    const insertedId = res.insertId;

    const [rows] = await pool.query<TaskSubtask[]>(
      `SELECT * FROM task_subtasks WHERE id = ? LIMIT 1`,
      [insertedId]
    );

    const item = rows[0] ?? null;
    return NextResponse.json({ item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
