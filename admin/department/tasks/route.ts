// app/api/admin/department/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { buildRRule, RecurrenceInput } from "../../../../../../lib/recurrence";
import { combineDateTime, withinBusinessHours } from "../../../../../../lib/datetime";
import { autoPriorityWithProgress, Priority } from "../../../../../../lib/priority";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

/** ---------- Types ---------- */
type Assignee = { id: number; name: string; email: string };

interface TaskRowBase extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  due_date: string;        // stocké en DATE (ou VARCHAR) en base
  due_time: string | null; // stocké en TIME (ou NULL)
  status: "todo" | "doing" | "done" | string;
  progress: number;
  performance: number;
  priority: Priority;
  is_recurrent: 0 | 1;
  recurrence_pattern: string | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  calendar_event_id: string | null;
}

interface TaskRowWithJoin extends TaskRowBase {
  assignees_concat: string | null; // "name::email::id|||..."
}

interface TaskItem extends Omit<TaskRowBase, "is_recurrent"> {
  is_recurrent: boolean;
  assignees: Assignee[];
  assigneeIds: number[];
}

/** ---------- Helpers SQL ---------- */
async function fetchTasksForDepartment(departmentId: number): Promise<TaskItem[]> {
  // Filtre par département via:
  // - le créateur de la tâche (cu.department_id)
  // - OU un des assignés (u.department_id)
  const [rows] = await pool.query<TaskRowWithJoin[] & RowDataPacket[]>(
    `SELECT t.*,
            GROUP_CONCAT(CONCAT(u.name,'::',u.email,'::',u.id) ORDER BY u.name SEPARATOR '|||') AS assignees_concat
       FROM tasks t
  LEFT JOIN task_assignees ta ON ta.task_id = t.id
  LEFT JOIN users u           ON u.id = ta.user_id
  LEFT JOIN users cu          ON cu.id = t.created_by
      WHERE (cu.department_id = ? OR u.department_id = ?)
   GROUP BY t.id
   ORDER BY t.created_at DESC`,
    [departmentId, departmentId]
  );

  return rows.map((r) => {
    const assignees: Assignee[] = [];
    const assigneeIds: number[] = [];

    if (r.assignees_concat) {
      String(r.assignees_concat)
        .split("|||")
        .forEach((chunk) => {
          const [name, email, idStr] = chunk.split("::");
          const id = Number(idStr);
          if (id) {
            assignees.push({ id, name, email });
            assigneeIds.push(id);
          }
        });
    }

    const item: TaskItem = {
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
      calendar_event_id: r.calendar_event_id,
      assignees,
      assigneeIds,
    };

    return item;
  });
}

async function insertAssignees(taskId: number, assigneeIds: number[]): Promise<void> {
  if (!assigneeIds?.length) return;
  const values = assigneeIds.map((uid) => [taskId, uid]);
  await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO task_assignees (task_id, user_id) VALUES ?`,
    [values]
  );
}

/** ---------- GET ---------- */
export async function GET(req: NextRequest) {
  try {
    const departmentId = Number(new URL(req.url).searchParams.get("department_id") || 0);
    if (!departmentId) return NextResponse.json({ items: [] });
    const items = await fetchTasksForDepartment(departmentId);
    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** ---------- POST ---------- */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as unknown));

  try {
    const {
      title,
      description,
      due_date,
      due_time,
      assigneeIds = [],
      is_recurrent = false,
      recurrence = { frequency: "NONE" } as RecurrenceInput,
      created_by,
      department_id, // pas stocké dans tasks, mais utile pour le filtre et le calendrier (metadata)
    } = body as {
      title: string;
      description?: string | null;
      due_date: string;
      due_time?: string | null;
      assigneeIds?: number[];
      is_recurrent?: boolean;
      recurrence?: RecurrenceInput;
      created_by: number;
      department_id: number;
    };

    if (!title?.trim()) throw new Error("Le titre est requis.");
    if (!due_date) throw new Error("La date d'échéance est requise.");
    if (due_time && !withinBusinessHours(due_time)) {
      throw new Error("L'heure doit être comprise entre 07:30 et 19:00.");
    }

    // Interdit avant l’heure système si c’est aujourd’hui
    const now = new Date();
    const dueAt = combineDateTime(due_date, (due_time ?? undefined) || undefined);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dueDay = new Date(dueAt); dueDay.setHours(0, 0, 0, 0);
    if (dueDay.getTime() === today.getTime() && dueAt.getTime() < now.getTime()) {
      throw new Error("Impossible de programmer avant l'heure actuelle du système.");
    }

    const createdAt = new Date();
    const defaultPriority: Priority = "low";
    const recurrence_pattern = is_recurrent ? buildRRule(recurrence) : null;

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO tasks
        (title, description, due_date, due_time, status, progress, performance, priority,
         is_recurrent, recurrence_pattern, created_by, created_at, updated_at)
       VALUES (?,?,?,?, 'todo', 0, 0, ?, ?, ?, ?, NOW(), NOW())`,
      [
        title.trim(),
        description ?? null,
        due_date,
        due_time ?? null, // en base, NULL si pas d’heure
        defaultPriority,
        is_recurrent ? 1 : 0,
        recurrence_pattern,
        created_by,
      ]
    );

    const taskId = Number(res.insertId);

    await insertAssignees(taskId, assigneeIds);

    // Montée auto initiale (progress=0)
    const newPriority = autoPriorityWithProgress(defaultPriority, createdAt, dueAt, 0);
    if (newPriority !== defaultPriority) {
      await pool.query<ResultSetHeader>(
        `UPDATE tasks SET priority=?, updated_at=NOW() WHERE id=?`,
        [newPriority, taskId]
      );
    }

    // Calendrier : créer l’event (60min) + RRULE si présent
    const endAt = new Date(dueAt.getTime() + 60 * 60 * 1000);
    try {
      const r = await fetch(`/api/calendar/events`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description ?? undefined,
          start_at: dueAt.toISOString(),
          end_at: endAt.toISOString(),
          recurrence_rule: (recurrence_pattern ?? undefined) as string | undefined,
          metadata: { task_id: taskId, department_id },
        }),
      });
      if (r.ok) {
        const j: { id: string } = await r.json();
        await pool.query<ResultSetHeader>(
          `UPDATE tasks SET calendar_event_id=? WHERE id=?`,
          [j.id, taskId]
        );
      }
    } catch {
      // silencieux
    }

    const [rowset] = await pool.query<TaskRowBase[] & RowDataPacket[]>(
      `SELECT * FROM tasks WHERE id=?`,
      [taskId]
    );
    const raw = rowset[0];

    const item: TaskItem = {
      ...raw,
      is_recurrent: !!raw.is_recurrent,
      assignees: [],
      assigneeIds: [],
    };

    return NextResponse.json({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur création tâche";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
