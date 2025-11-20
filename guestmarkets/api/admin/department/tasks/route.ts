// app/guestmarkets/api/admin/department/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";

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

// Helper pour construire l'objet tâche avec assignés
async function hydrateTasks(tasks: TaskRow[]) {
  if (!tasks.length) return [];

  const ids = tasks.map((t) => t.id);
  const [assRows] = await pool.query<AssigneeRow[]>(
    `
    SELECT ta.task_id, u.id AS user_id, u.name, u.email
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id IN ( ${ids.map(() => "?").join(",")} )
  `,
    ids
  );

  const mapAssignees = new Map<
    number,
    { id: number; name: string; email: string }[]
  >();
  for (const a of assRows) {
    if (!mapAssignees.has(a.task_id)) mapAssignees.set(a.task_id, []);
    mapAssignees
      .get(a.task_id)!
      .push({ id: a.user_id, name: a.name, email: a.email });
  }

  return tasks.map((t) => {
    const assignees = mapAssignees.get(t.id) || [];
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
  });
}

export async function GET(req: NextRequest) {
  try {
    const u = await getCurrentUser();
    const { searchParams } = new URL(req.url);
    const depParam = searchParams.get("department_id");
    const departmentId = depParam ? Number(depParam) : u.department_id;

    if (!departmentId) {
      return NextResponse.json(
        { error: "Aucun département associé." },
        { status: 400 }
      );
    }

    // Sécurité : un user ne peut voir QUE son département (sauf admin)
    if (!u.is_admin && u.department_id !== departmentId) {
      return NextResponse.json(
        { error: "Accès refusé à ce département." },
        { status: 403 }
      );
    }

    // Tâches liées au département :
    // - soit créées par un user de ce département
    // - soit assignées à au moins un user de ce département
    const [rows] = await pool.query<TaskRow[]>(
      `
      SELECT DISTINCT t.*
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      LEFT JOIN users ua ON ua.id = ta.user_id
      LEFT JOIN users uc ON uc.id = t.created_by
      WHERE (ua.department_id = ? OR uc.department_id = ?)
      ORDER BY t.due_date IS NULL, t.due_date ASC, t.due_time IS NULL, t.due_time ASC, t.id DESC
    `,
      [departmentId, departmentId]
    );

    const items = await hydrateTasks(rows);
    return NextResponse.json({ items });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e.message ?? "Erreur serveur." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const u = await getCurrentUser();
    const body = await req.json();

    const title = String(body.title || "").trim();
    if (!title)
      return NextResponse.json(
        { error: "Titre obligatoire." },
        { status: 400 }
      );

    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    const due_date = body.due_date || null;
    const due_time = body.due_time || null;
    const assigneeIds: number[] = Array.isArray(body.assigneeIds)
      ? body.assigneeIds.map(Number)
      : [];
    const is_recurrent = !!body.is_recurrent;
    const recurrence = body.recurrence || { frequency: "NONE" };

    // La vraie source de vérité du département c'est l'utilisateur
    const departmentId = u.department_id;
    if (!departmentId) {
      return NextResponse.json(
        {
          error:
            "Impossible de créer une tâche : vous n’êtes rattaché à aucun département.",
        },
        { status: 400 }
      );
    }

    // Construction du pattern de récurrence simple
    let recurrence_pattern: string | null = null;
    if (is_recurrent && recurrence && recurrence.frequency !== "NONE") {
      const freq = recurrence.frequency;
      const interval = Number(recurrence.interval || 1);
      const count = Number(recurrence.count || 1);
      recurrence_pattern = `${freq}:${interval}x${count}`;
    }

    // Création de la tâche
    const [res] = await pool.query<ResultSetHeader>(
      `
      INSERT INTO tasks
        (title, description, due_date, due_time, status, progress, performance, priority, is_recurrent, recurrence_pattern, created_by)
      VALUES (?, ?, ?, ?, 'todo', 0, 0, 'low', ?, ?, ?)
    `,
      [
        title,
        description,
        due_date,
        due_time,
        is_recurrent ? 1 : 0,
        recurrence_pattern,
        u.id,
      ]
    );
    const taskId = res.insertId;

    // Assignation : si aucun assigné, on met au moins le créateur
    const finalAssigneeIds =
      assigneeIds.length > 0 ? assigneeIds : [u.id];

    if (finalAssigneeIds.length) {
      const values = finalAssigneeIds.map((id) => [taskId, id]);
      await pool.query<ResultSetHeader>(
        "INSERT INTO task_assignees (task_id, user_id) VALUES ?",
        [values]
      );
    }

    // On renvoie la tâche hydratée
    const [rowsTask] = await pool.query<TaskRow[]>(
      "SELECT * FROM tasks WHERE id = ?",
      [taskId]
    );
    const items = await hydrateTasks(rowsTask);
    const item = items[0];

    return NextResponse.json({ item });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e.message ?? "Erreur serveur." },
      { status: 500 }
    );
  }
}
