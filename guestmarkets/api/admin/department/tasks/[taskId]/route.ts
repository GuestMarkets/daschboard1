// app/guestmarkets/api/admin/department/tasks/[taskId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../../lib/db";
import { requireUser } from "../../../../../../../../lib/auth";

type TaskRow = RowDataPacket & {
  id: number;
  title: string;
  description: string | null;
  due_date: string;
  due_time: string | null;
  status: string;
  progress: number;
  performance: number;
  priority: string;
  is_recurrent: number;
  recurrence_pattern: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
};

type AssigneeRow = RowDataPacket & {
  task_id: number;
  user_id: number;
  name: string;
  email: string;
};

async function getCurrentUser() {
  const { user } = await requireUser();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, department_id, is_admin, is_manager FROM users WHERE id = ?",
    [user.id]
  );
  if (!rows.length) throw new Error("Utilisateur introuvable.");
  const u = rows[0] as RowDataPacket & {
    id: number;
    department_id: number | null;
    is_admin: number;
    is_manager: number;
  };
  return u;
}

async function hydrateTask(taskId: number) {
  const [rowsTask] = await pool.query<TaskRow[]>(
    "SELECT * FROM tasks WHERE id = ?",
    [taskId]
  );
  if (!rowsTask.length) return null;
  const t = rowsTask[0];

  const [rowsA] = await pool.query<AssigneeRow[]>(
    `
    SELECT ta.task_id, u.id AS user_id, u.name, u.email
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id = ?
  `,
    [taskId]
  );

  const assignees = rowsA.map((a) => ({
    id: a.user_id,
    name: a.name,
    email: a.email,
  }));

  return {
    id: t.id,
    title: t.title,
    description: t.description,
    due_date: t.due_date,
    due_time: t.due_time,
    status: t.status,
    progress: t.progress,
    performance: t.performance,
    priority: t.priority,
    is_recurrent: !!t.is_recurrent,
    recurrence_pattern: t.recurrence_pattern,
    created_by: t.created_by,
    created_at: t.created_at,
    updated_at: t.updated_at,
    assignees,
    assigneeIds: assignees.map((a) => a.id),
  };
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

// --- CORRECTION SIGNATURE PARAMS POUR NEXT.JS 15 ---
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId: taskIdStr } = await context.params;
    const taskId = Number(taskIdStr);

    const u = await getCurrentUser();
    if (!taskId) return NextResponse.json({ error: "ID tâche invalide." }, { status: 400 });
    if (!u.department_id && !u.is_admin)
      return NextResponse.json({ error: "Pas de département associé." }, { status: 403 });

    const departmentId = u.department_id!;
    if (!u.is_admin) await assertTaskInDepartment(taskId, departmentId);

    const item = await hydrateTask(taskId);
    if (!item) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });

    return NextResponse.json({ item });
  } catch (e: any) {
    const msg = e.message ?? "Erreur serveur.";
    const status = msg.includes("n’appartient pas") ? 403 : 500;
    console.error("GET /tasks/[taskId] error:", e);
    return NextResponse.json({ error: msg }, { status });
  }
}

// Même correction pour PATCH
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId: taskIdStr } = await context.params;
    const taskId = Number(taskIdStr);

    const u = await getCurrentUser();
    if (!taskId) return NextResponse.json({ error: "ID tâche invalide." }, { status: 400 });
    if (!u.department_id && !u.is_admin)
      return NextResponse.json({ error: "Pas de département associé." }, { status: 403 });

    const body = await req.json();
    const departmentId = u.department_id!;
    if (!u.is_admin) await assertTaskInDepartment(taskId, departmentId);

    const fields: string[] = [];
    const values: any[] = [];

    if (typeof body.title === "string") {
      fields.push("title = ?");
      values.push(body.title.trim());
    }
    if (body.description !== undefined) {
      fields.push("description = ?");
      values.push(body.description?.trim() || null);
    }
    if (body.due_date !== undefined) {
      fields.push("due_date = ?");
      values.push(body.due_date || null);
    }
    if (body.due_time !== undefined) {
      fields.push("due_time = ?");
      values.push(body.due_time || null);
    }
    if (body.status !== undefined) {
      fields.push("status = ?");
      values.push(body.status);
    }
    if (body.progress !== undefined) {
      fields.push("progress = ?");
      values.push(Number(body.progress) || 0);
    }
    if (body.performance !== undefined) {
      fields.push("performance = ?");
      values.push(Number(body.performance) || 0);
    }
    if (body.priority !== undefined) {
      fields.push("priority = ?");
      values.push(body.priority);
    }
    if (body.is_recurrent !== undefined) {
      fields.push("is_recurrent = ?");
      values.push(body.is_recurrent ? 1 : 0);
    }
    if (body.recurrence) {
      const rec = body.recurrence;
      let pattern: string | null = null;
      if (rec.frequency && rec.frequency !== "NONE") {
        const interval = Number(rec.interval || 1);
        const count = Number(rec.count || 1);
        pattern = `${rec.frequency}:${interval}x${count}`;
      }
      fields.push("recurrence_pattern = ?");
      values.push(pattern);
    }

    if (fields.length) {
      const sql = `UPDATE tasks SET ${fields.join(", ")} WHERE id = ? LIMIT 1`;
      values.push(taskId);
      await pool.query<ResultSetHeader>(sql, values);
    }

    if (Array.isArray(body.assigneeIds)) {
      const assigneeIds = body.assigneeIds.map(Number);
      await pool.query<ResultSetHeader>("DELETE FROM task_assignees WHERE task_id = ?", [taskId]);
      if (assigneeIds.length) {
        const values = assigneeIds.map((id: number) => [taskId, id]);
        await pool.query<ResultSetHeader>("INSERT INTO task_assignees (task_id, user_id) VALUES ?", [values]);
      }
    }

    const item = await hydrateTask(taskId);
    if (!item) return NextResponse.json({ error: "Tâche introuvable après mise à jour." }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e: any) {
    const msg = e.message ?? "Erreur serveur.";
    const status = msg.includes("n’appartient pas") ? 403 : 500;
    console.error("PATCH /tasks/[taskId] error:", e);
    return NextResponse.json({ error: msg }, { status });
  }
}

// Même correction pour DELETE
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId: taskIdStr } = await context.params;
    const taskId = Number(taskIdStr);

    const u = await getCurrentUser();
    if (!taskId) return NextResponse.json({ error: "ID tâche invalide." }, { status: 400 });
    if (!u.department_id && !u.is_admin)
      return NextResponse.json({ error: "Pas de département associé." }, { status: 403 });

    const departmentId = u.department_id!;
    if (!u.is_admin) await assertTaskInDepartment(taskId, departmentId);

    await pool.query<ResultSetHeader>("DELETE FROM task_subtasks WHERE task_id = ?", [taskId]);
    await pool.query<ResultSetHeader>("DELETE FROM task_assignees WHERE task_id = ?", [taskId]);
    await pool.query<ResultSetHeader>("DELETE FROM tasks WHERE id = ?", [taskId]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e.message ?? "Erreur serveur.";
    const status = msg.includes("n’appartient pas") ? 403 : 500;
    console.error("DELETE /tasks/[taskId] error:", e);
    return NextResponse.json({ error: msg }, { status });
  }
}
