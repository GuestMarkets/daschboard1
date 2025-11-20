// app/api/objectives/[taskId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

/* ===================== Types ===================== */

interface PatchSubtask {
  id?: number;
  title?: string;
  weight?: number;
  dueDate?: string | null;
  done?: boolean;
  _action?: "delete" | "upsert";
}

interface PatchBody {
  title?: string;
  description?: string | null;
  unit?: string | null;
  target?: number | null;
  current?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  priority?: string | null;
  complete?: boolean;
  subtasks?: PatchSubtask[];
}

type NullableDateTime = string | null;

interface ObjectiveRow extends RowDataPacket {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  unit: string | null;
  target: number | null;
  current: number | null;
  start_date: NullableDateTime;
  end_date: NullableDateTime;
  status: string | null;
  priority: string | null;
  created_at: string;
  updated_at: string;
}

interface CalendarEventIdRow extends RowDataPacket {
  id: number;
}

interface ObjectiveJoinedRow extends ObjectiveRow {
  owner_name: string;
  calendar_event_id: number | null;
  calendar_start_at: NullableDateTime;
  calendar_end_at: NullableDateTime;
}

/* ================ Helper: push builder ================ */

type SQLValue = string | number | null;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = (await requireUser()) as { user: { id: number } };

    // ⚠️ Avec Next.js (validation route handlers), params est une Promise
    const { id: idParam } = await context.params;
    const id = Number(idParam);

    const body = (await request.json().catch(() => null)) as PatchBody | null;

    const {
      title,
      description,
      unit,
      target,
      current,
      startDate,
      endDate,
      status,
      priority,
      complete,
      subtasks,
    } = body || {};

    // État courant de l'objectif
    const [curRows] = await pool.query<ObjectiveRow[]>(
      `SELECT * FROM objectives WHERE id=? LIMIT 1`,
      [id]
    );
    if (!curRows.length) throw new Error("Objectif introuvable.");
    const cur = curRows[0];

    // Build UPDATE
    const set: string[] = [];
    const vals: SQLValue[] = [];
    const push = (k: string, v: SQLValue) => {
      set.push(`${k}=?`);
      vals.push(v);
    };

    if (title !== undefined) push("title", (title || "").trim());
    if (description !== undefined)
      push("description", description?.trim() || null);
    if (unit !== undefined) push("unit", (unit || "%").trim());
    if (target !== undefined) push("target", Number(target || 0));
    if (current !== undefined) push("current", Number(current || 0));
    if (startDate !== undefined) push("start_date", startDate ?? null);
    if (endDate !== undefined) push("end_date", endDate ?? null);
    if (status !== undefined) push("status", status ?? null);
    if (priority !== undefined) push("priority", priority ?? null);

    if (complete === true) {
      // statut done + progression 100%
      push("status", "done");
      push("current", cur.target ?? 0);
    }

    if (set.length) {
      set.push("updated_at=NOW()");
      await pool.query<ResultSetHeader>(
        `UPDATE objectives SET ${set.join(", ")} WHERE id=?`,
        [...vals, id]
      );
    }

    // MAJ/CRUD des sous-objectifs
    if (Array.isArray(subtasks)) {
      for (const s of subtasks as PatchSubtask[]) {
        if (s._action === "delete" && s.id) {
          await pool.query<ResultSetHeader>(
            `DELETE FROM objective_subtasks WHERE id=? AND objective_id=?`,
            [s.id, id]
          );
        } else if (s._action === "upsert") {
          const safeTitle = s.title?.trim() || "";
          const safeWeight = Number(s.weight || 0);
          const safeDue = s.dueDate ?? null;
          const safeDone = s.done ? 1 : 0;

          if (s.id) {
            await pool.query<ResultSetHeader>(
              `UPDATE objective_subtasks
               SET title=?, weight=?, due_date=?, done=?, created_at=created_at
               WHERE id=? AND objective_id=?`,
              [safeTitle, safeWeight, safeDue, safeDone, s.id, id]
            );
          } else {
            await pool.query<ResultSetHeader>(
              `INSERT INTO objective_subtasks
                 (objective_id, title, weight, due_date, done, created_at)
               VALUES (?,?,?,?,?,NOW())`,
              [id, safeTitle, safeWeight, safeDue, safeDone]
            );
          }
        }
      }
    }

    // Synchroniser l’événement calendrier lié (si existe)
    const [evRows] = await pool.query<CalendarEventIdRow[]>(
      `SELECT id FROM calendar_events WHERE objective_id=? ORDER BY id DESC LIMIT 1`,
      [id]
    );
    const ev = evRows[0];

    const newTitle = title ?? cur.title;
    const newDesc = description ?? cur.description;
    const sd = startDate ?? cur.start_date;
    const ed = endDate ?? cur.end_date;

    // Concaténer proprement les dates (accepte null)
    const sdStr = sd ? `${sd} 00:00:00` : null;
    const edStr = ed ? `${ed} 23:59:59` : null;

    if (ev) {
      await pool.query<ResultSetHeader>(
        `UPDATE calendar_events
         SET title=?, description=?, start_at=?, end_at=?, updated_at=NOW()
         WHERE id=?`,
        [(newTitle || "").trim(), newDesc?.trim() || null, sdStr, edStr, ev.id]
      );
    } else {
      // s’il n’existe pas encore, on le crée
      await pool.query<ResultSetHeader>(
        `INSERT INTO calendar_events
           (title, description, type, all_day, timezone, start_at, end_at, created_by, objective_id, visibility, created_at, updated_at)
         VALUES
           (?,?,?,?,?,?,?, ?, ?, 'attendees', NOW(), NOW())`,
        [
          (newTitle || "").trim(),
          newDesc?.trim() || null,
          "other",
          1,
          "UTC",
          sdStr,
          edStr,
          user.id,
          id,
        ]
      );
    }

    const [rows] = await pool.query<ObjectiveJoinedRow[]>(
      `
      SELECT
        o.*,
        u.name AS owner_name,
        ce.id AS calendar_event_id,
        ce.start_at AS calendar_start_at,
        ce.end_at   AS calendar_end_at
      FROM objectives o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN calendar_events ce ON ce.objective_id = o.id
      WHERE o.id = ?
      `,
      [id]
    );

    return NextResponse.json({ item: rows[0] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur MAJ objectif";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
