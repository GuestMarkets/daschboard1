// app/guestmarkets/api/admin/department/tasks/[taskId]/subtasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../../../lib/db";
import { requireUser } from "../../../../../../../../../lib/auth";

type SubtaskRow = RowDataPacket & {
  id: number;
  task_id: number;
  title: string;
  description: string | null;
  done: number;
  created_at: string;
};

async function getCurrentUser() {
  const { user } = await requireUser();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, department_id, is_admin FROM users WHERE id = ?",
    [user.id]
  );
  if (!rows.length) throw new Error("Utilisateur introuvable.");
  const u = rows[0] as RowDataPacket & {
    id: number;
    department_id: number | null;
    is_admin: number;
  };
  return u;
}

async function assertTaskInDepartment(taskId: number, departmentId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT t.id
    FROM tasks t
    LEFT JOIN task_assignees ta ON ta.task_id = t.id
    LEFT JOIN users ua ON ua.id = ta.user_id
    LEFT JOIN users uc ON uc.id = t.created_by
    WHERE t.id = ?
      AND (ua.department_id = ? OR uc.department_id = ?)
    LIMIT 1
  `,
    [taskId, departmentId, departmentId]
  );
  if (!rows.length)
    throw new Error("Cette tâche n’appartient pas à votre département.");
}

// ✅ GET corrigé pour Next.js 15
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  try {
    const u = await getCurrentUser();
    const taskIdNum = Number(taskId);
    if (!taskIdNum)
      return NextResponse.json({ error: "ID tâche invalide." }, { status: 400 });

    if (!u.department_id && !u.is_admin)
      return NextResponse.json(
        { error: "Pas de département associé." },
        { status: 403 }
      );

    const departmentId = u.department_id!;
    if (!u.is_admin) await assertTaskInDepartment(taskIdNum, departmentId);

    const [rows] = await pool.query<SubtaskRow[]>(
      `
      SELECT id, task_id, title, description, done, created_at
      FROM task_subtasks
      WHERE task_id = ?
      ORDER BY id DESC
    `,
      [taskIdNum]
    );

    const items = rows.map((s) => ({
      id: s.id,
      task_id: s.task_id,
      title: s.title,
      description: s.description,
      done: s.done as 0 | 1,
      created_at: s.created_at,
    }));

    return NextResponse.json({ items });
  } catch (e: any) {
    const msg = e.message ?? "Erreur serveur.";
    const status =
      msg.includes("n’appartient pas à votre département") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// ✅ POST corrigé pour Next.js 15
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  try {
    const u = await getCurrentUser();
    const taskIdNum = Number(taskId);
    if (!taskIdNum)
      return NextResponse.json({ error: "ID tâche invalide." }, { status: 400 });

    if (!u.department_id && !u.is_admin)
      return NextResponse.json(
        { error: "Pas de département associé." },
        { status: 403 }
      );

    const departmentId = u.department_id!;
    if (!u.is_admin) await assertTaskInDepartment(taskIdNum, departmentId);

    const body = await req.json();
    const title = String(body.title || "").trim();
    if (!title)
      return NextResponse.json({ error: "Titre obligatoire." }, { status: 400 });

    const description =
      typeof body.description === "string" && body.description.trim().length
        ? body.description.trim()
        : null;

    const [res] = await pool.query<ResultSetHeader>(
      `
      INSERT INTO task_subtasks (task_id, title, description, done)
      VALUES (?, ?, ?, 0)
    `,
      [taskIdNum, title, description]
    );
    const subId = res.insertId;

    const [rows] = await pool.query<SubtaskRow[]>(
      `
      SELECT id, task_id, title, description, done, created_at
      FROM task_subtasks
      WHERE id = ?
    `,
      [subId]
    );
    const s = rows[0];

    const item = {
      id: s.id,
      task_id: s.task_id,
      title: s.title,
      description: s.description,
      done: s.done as 0 | 1,
      created_at: s.created_at,
    };

    return NextResponse.json({ item });
  } catch (e: any) {
    const msg = e.message ?? "Erreur serveur.";
    const status =
      msg.includes("n’appartient pas à votre département") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
