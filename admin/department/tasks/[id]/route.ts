// app/api/admin/department/tasks/[taskId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../lib/db";
import { buildRRule, RecurrenceInput } from "../../../../../../../lib/recurrence";
import { combineDateTime, withinBusinessHours } from "../../../../../../../lib/datetime";
import { autoPriorityWithProgress, Priority } from "../../../../../../../lib/priority";
import type { RowDataPacket } from "mysql2/promise";

type Status = "todo" | "in_progress" | "blocked" | "done";

/** Valeur autorisée dans une requête SQL paramétrée */
type SqlValue = string | number | Date | null;

/** Ligne complète de la table tasks (adapter si besoin) */
interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;       // YYYY-MM-DD
  due_time: string | null;       // HH:mm
  status: Status;
  progress: number | null;
  performance: number | null;
  priority: Priority;
  is_recurrent: 0 | 1;
  recurrence_pattern: string | null;
  updated_at: Date;
  created_at: Date;
  calendar_event_id: string | null;
  department_id: number | null;
}

/** DTO de sortie pour normaliser is_recurrent en booléen */
type TaskApiItem = Omit<TaskRow, "is_recurrent"> & { is_recurrent: boolean };

/** Ligne minimale pour DELETE (SELECT calendar_event_id) */
interface CalendarEventRow extends RowDataPacket {
  calendar_event_id: string | null;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // <- params est un Promise dans ton type checker
) {
  const { id: idStr } = await context.params;
  const id = Number(idStr);

  const body = await req.json().catch(() => ({}));

  try {
    const {
      title, description, due_date, due_time, status, progress, performance,
      priority, is_recurrent, recurrence, assigneeIds, department_id,
    } = body as {
      title?: string;
      description?: string | null;
      due_date?: string;
      due_time?: string | null;
      status?: Status;
      progress?: number;
      performance?: number;
      priority?: Priority;
      is_recurrent?: boolean;
      recurrence?: RecurrenceInput;
      assigneeIds?: number[];
      department_id?: number;
    };

    const [rows] = await pool.query<TaskRow[]>(`SELECT * FROM tasks WHERE id=?`, [id]);
    if (!rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const cur = rows[0];

    const newDate: string = (due_date ?? cur.due_date ?? "") as string;
    const newTime: string | undefined = (due_time ?? cur.due_time ?? undefined) || undefined;

    if (newTime && !withinBusinessHours(newTime)) {
      throw new Error("L'heure doit être comprise entre 07:30 et 19:00.");
    }

    if (newDate) {
      const now = new Date();
      const dueAt = combineDateTime(newDate, newTime);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dueDay = new Date(dueAt); dueDay.setHours(0, 0, 0, 0);
      if (dueDay.getTime() === today.getTime() && dueAt.getTime() < now.getTime()) {
        throw new Error("Impossible de reprogrammer avant l'heure actuelle.");
      }
    }

    // progress 100% => done + performance 100
    let newStatus: Status | undefined = status;
    let newPerformance = performance;
    if (typeof progress === "number" && progress >= 100) {
      newStatus = "done";
      newPerformance = 100;
    }

    // Récurrence
    let recurrence_pattern: string | null | undefined;
    if (typeof is_recurrent === "boolean") {
      recurrence_pattern = is_recurrent
        ? (buildRRule(recurrence || { frequency: "NONE" }) || null)
        : null;
    }

    // Build UPDATE
    const fields: string[] = [];
    const values: SqlValue[] = [];
    const setField = (k: string, v: SqlValue) => {
      fields.push(`${k}=?`);
      values.push(v);
    };

    if (title !== undefined) setField("title", title || "");
    if (description !== undefined) setField("description", description ?? null);
    if (due_date !== undefined) setField("due_date", due_date ?? null);
    if (due_time !== undefined) setField("due_time", due_time === null ? null : due_time);
    if (newStatus !== undefined) setField("status", newStatus);
    if (progress !== undefined) setField("progress", Math.max(0, Math.min(100, progress)));
    if (newPerformance !== undefined) setField("performance", Math.max(0, Math.min(100, newPerformance)));
    if (priority !== undefined) setField("priority", priority);
    if (is_recurrent !== undefined) setField("is_recurrent", is_recurrent ? 1 : 0);
    if (recurrence_pattern !== undefined) setField("recurrence_pattern", recurrence_pattern);
    setField("updated_at", new Date());

    if (fields.length) {
      await pool.query(`UPDATE tasks SET ${fields.join(", ")} WHERE id=?`, [...values, id]);
    }

    // Assignees
    if (Array.isArray(assigneeIds)) {
      await pool.query(`DELETE FROM task_assignees WHERE task_id=?`, [id]);
      if (assigneeIds.length) {
        const vals: [number, number][] = assigneeIds.map((uid) => [id, uid]);
        // L'API mysql2 accepte un tableau de tuples via "VALUES ?"
        await pool.query(`INSERT IGNORE INTO task_assignees (task_id, user_id) VALUES ?`, [vals]);
      }
    }

    // Auto-priorité
    const [rows2] = await pool.query<TaskRow[]>(`SELECT * FROM tasks WHERE id=?`, [id]);
    const t = rows2[0];

    const createdAt = new Date(t.created_at);
    const dueAtForCalc = combineDateTime(
      t.due_date ?? new Date().toISOString().slice(0, 10), // fallback date si jamais null
      (t.due_time ?? undefined) || undefined
    );
    const autoPriority = autoPriorityWithProgress(
      t.priority as Priority,
      createdAt,
      dueAtForCalc,
      Number(t.progress || 0)
    );
    if (autoPriority !== t.priority) {
      await pool.query(`UPDATE tasks SET priority=?, updated_at=NOW() WHERE id=?`, [autoPriority, id]);
      t.priority = autoPriority;
    }

    // Calendrier
    if (t.due_date) {
      const startAt = combineDateTime(t.due_date, (t.due_time ?? undefined) || undefined);
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
      try {
        if (t.calendar_event_id) {
          await fetch(`/api/calendar/events/${t.calendar_event_id}`, {
            method: "PATCH",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
              title: t.title,
              description: t.description ?? undefined,
              start_at: startAt.toISOString(),
              end_at: endAt.toISOString(),
              recurrence_rule: (t.recurrence_pattern ?? undefined) as string | undefined,
              metadata: { task_id: t.id, department_id }, // department_id facultatif ici
            }),
          });
        } else if (department_id) {
          const r = await fetch(`/api/calendar/events`, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
              title: t.title,
              description: t.description ?? undefined,
              start_at: startAt.toISOString(),
              end_at: endAt.toISOString(),
              recurrence_rule: (t.recurrence_pattern ?? undefined) as string | undefined,
              metadata: { task_id: t.id, department_id },
            }),
          });
          if (r.ok) {
            const j: { id: string } = await r.json();
            await pool.query(`UPDATE tasks SET calendar_event_id=? WHERE id=?`, [j.id, id]);
          }
        }
      } catch {
        // silencieux
      }
    }

    const [rows3] = await pool.query<TaskRow[]>(`SELECT * FROM tasks WHERE id=?`, [id]);
    const itemRow = rows3[0];

    // Normaliser is_recurrent en booléen pour la réponse
    const item: TaskApiItem = {
      ...itemRow,
      is_recurrent: !!itemRow.is_recurrent,
    };

    return NextResponse.json({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message || "Erreur MAJ tâche" }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> } // <- idem : Promise
) {
  const { id: idStr } = await context.params;
  const id = Number(idStr);

  try {
    const [rows] = await pool.query<CalendarEventRow[]>(`SELECT calendar_event_id FROM tasks WHERE id=?`, [id]);
    const ceid = rows[0]?.calendar_event_id ?? undefined;
    if (ceid) {
      try {
        await fetch(`/api/calendar/events/${ceid}`, { method: "DELETE" });
      } catch {
        // silencieux
      }
    }
    await pool.query(`DELETE FROM task_assignees WHERE task_id=?`, [id]);
    await pool.query(`DELETE FROM task_subtasks WHERE task_id=?`, [id]); // ← nom correct de la table
    await pool.query(`DELETE FROM tasks WHERE id=?`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message || "Erreur suppression" }, { status: 400 });
  }
}
