// app/guestmarkets/api/tasks/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/auth";

interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  due_date: string;
  due_time: string | null;
  status: "todo" | "in_progress" | "blocked" | "done";
  progress: number;
  performance: number;
  blocked_reason: string | null;
  priority: "low" | "medium" | "high";
  is_recurrent: 0 | 1;
  recurrence_pattern: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

interface AssigneeRow extends RowDataPacket {
  task_id: number;
  user_id: number;
  name: string | null;
  email: string | null;
}

/* ========== GET : liste des tâches de l'utilisateur connecté ========== */
export async function GET() {
  try {
    const { user } = await requireUser();
    const uid = Number(user.id);

    const [rows] = await pool.query<TaskRow[]>(
      `
      SELECT t.*
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      WHERE t.created_by = ? OR ta.user_id = ?
      GROUP BY t.id
      ORDER BY t.due_date ASC, t.due_time ASC
    `,
      [uid, uid]
    );

    const taskIds = rows.map((r) => r.id);
    const assigneesByTask = new Map<
      number,
      { id: number; name: string; email: string }[]
    >();

    if (taskIds.length) {
      const [assRows] = await pool.query<AssigneeRow[]>(
        `
        SELECT ta.task_id, u.id AS user_id, u.name, u.email
        FROM task_assignees ta
        JOIN users u ON u.id = ta.user_id
        WHERE ta.task_id IN (?)
      `,
        [taskIds]
      );

      for (const r of assRows) {
        const arr = assigneesByTask.get(r.task_id) || [];
        arr.push({
          id: Number(r.user_id),
          name: r.name ?? "",
          email: r.email ?? "",
        });
        assigneesByTask.set(r.task_id, arr);
      }
    }

    const items = rows.map((r) => {
      const assignees = assigneesByTask.get(r.id) || [];
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        due_date: r.due_date,
        due_time: r.due_time,
        status: r.status,
        progress: r.progress,
        performance: r.performance,
        priority: r.priority,
        is_recurrent: !!r.is_recurrent,
        recurrence_pattern: r.recurrence_pattern,
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
        assignees,
        assigneeIds: assignees.map((a) => a.id),
      };
    });

    return NextResponse.json({ items });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/* ========== POST : création d'une tâche pour l'utilisateur connecté ========== */
export async function POST(req: Request) {
  try {
    const { user } = await requireUser();
    const uid = Number(user.id);

    const body = await req.json().catch(() => ({}));
    const {
      title,
      description,
      due_date,
      due_time,
      is_recurrent,
      recurrence,
    } = body || {};

    if (!title || !due_date) {
      return NextResponse.json(
        { error: "title et due_date sont requis." },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `
      INSERT INTO tasks
        (title, description, due_date, due_time, status, progress, performance, priority,
         is_recurrent, recurrence_pattern, created_by)
      VALUES
        (?, ?, ?, ?, 'todo', 0, 0, 'low', ?, ?, ?)
    `,
      [
        String(title),
        description ?? null,
        String(due_date),
        due_time || null,
        is_recurrent ? 1 : 0,
        is_recurrent ? JSON.stringify(recurrence || {}) : null,
        uid,
      ]
    );

    const taskId = Number(result.insertId);

    // Assignation forcée à l'utilisateur connecté
    await pool.execute(
      `INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)`,
      [taskId, uid]
    );

    const [rows] = await pool.query<TaskRow[]>(
      `SELECT * FROM tasks WHERE id = ? LIMIT 1`,
      [taskId]
    );
    const t = rows[0];

    const assignees = [
      {
        id: uid,
        name: (user as any).name ?? "",
        email: (user as any).email ?? "",
      },
    ];

    return NextResponse.json({
      item: {
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
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
