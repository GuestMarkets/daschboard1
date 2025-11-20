// app/guestmarkets/api/tasks/[taskId]/subtasks/route.ts
import { NextResponse, NextRequest } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";

type SubtaskRow = RowDataPacket & {
  id: number;
  task_id: number;
  title: string;
  description: string | null;
  done: 0 | 1;
  created_at: string | Date;
};

// Requête `SELECT 1 …` : on teste uniquement la présence d’une ligne
type MinimalOneRow = RowDataPacket;

async function canAccess(userId: number, taskId: number): Promise<boolean> {
  // Assigné ?
  const [a] = await pool.query<MinimalOneRow[]>(
    "SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1",
    [taskId, userId]
  );
  if (a.length > 0) return true;

  // Responsable de département d’un des assignés ?
  const [dep] = await pool.query<MinimalOneRow[]>(
    `
    SELECT 1
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id = ?
      AND u.department_id IN (SELECT id FROM departments WHERE manager_id = ?)
    LIMIT 1
    `,
    [taskId, userId]
  );
  if (dep.length > 0) return true;

  // Chef de projet d’un projet auquel l’équipe de l’assigné appartient (via teams.project_id)
  const [proj] = await pool.query<MinimalOneRow[]>(
    `
    SELECT 1
    FROM task_assignees ta
    JOIN team_members tm ON tm.user_id = ta.user_id
    JOIN teams t ON t.id = tm.team_id
    WHERE ta.task_id = ?
      AND t.project_id IN (SELECT id FROM projects WHERE manager_id = ?)
    LIMIT 1
    `,
    [taskId, userId]
  );
  if (proj.length > 0) return true;

  // Chef d’équipe d’un des assignés
  const [team] = await pool.query<MinimalOneRow[]>(
    `
    SELECT 1
    FROM task_assignees ta
    JOIN team_members tm ON tm.user_id = ta.user_id
    JOIN teams t ON t.id = tm.team_id
    WHERE ta.task_id = ?
      AND t.leader_user_id = ?
    LIMIT 1
    `,
    [taskId, userId]
  );
  return team.length > 0;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId: taskIdStr } = await context.params;
    const taskId = Number(taskIdStr);

    if (!Number.isFinite(taskId) || taskId <= 0) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    const { user } = await requireUser();
    const allowed = await canAccess(user.id, taskId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [rows] = await pool.query<SubtaskRow[]>(
      "SELECT * FROM task_subtasks WHERE task_id = ? ORDER BY id DESC",
      [taskId]
    );

    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId: taskIdStr } = await context.params;
    const taskId = Number(taskIdStr);

    if (!Number.isFinite(taskId) || taskId <= 0) {
      return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
    }

    const { user } = await requireUser();
    const allowed = await canAccess(user.id, taskId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    type PostBody = {
      title?: unknown;
      description?: unknown;
    };

    const body = (await req.json()) as PostBody;

    const title =
      typeof body.title === "string" ? body.title.trim() : undefined;
    const description =
      body.description == null
        ? null
        : typeof body.description === "string"
        ? body.description
        : null;

    if (!title) {
      return NextResponse.json({ error: "title requis" }, { status: 400 });
    }

    const [res] = await pool.query<ResultSetHeader>(
      "INSERT INTO task_subtasks (task_id, title, description, done, created_at) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)",
      [taskId, title, description]
    );

    const [row] = await pool.query<SubtaskRow[]>(
      "SELECT * FROM task_subtasks WHERE id = ? LIMIT 1",
      [res.insertId]
    );

    return NextResponse.json({ item: row[0] }, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
