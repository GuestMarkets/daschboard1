// app/api/tasks/route.ts

import "server-only";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise"; // ⬅️ important
import { getPool } from "../../../../../lib/db";
import { requireManager } from "../../../../../lib/manager";

export const runtime = "nodejs";
export const revalidate = 0;

/* =========================
 * Types
 * ========================= */

type DbStatus = "todo" | "in_progress" | "blocked" | "done";
type DbPriority = "low" | "medium" | "high";
type UiPriority = "Basse" | "Moyenne" | "Haute";
type UiStatus = DbStatus | "overdue";

/** Ligne SQL renvoyée (hérite de RowDataPacket pour satisfaire mysql2) */
interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  status: DbStatus;         // 'todo','in_progress','blocked','done'
  progress: number;         // 0..100
  priority: DbPriority;     // 'low','medium','high'
  due_date: string;         // 'YYYY-MM-DD'
  due_time: string | null;  // 'HH:MM:SS' | null
  updated_at: string | Date; // selon config du driver
}

/** Objet retourné par l’API */
interface TaskOut {
  id: number;
  title: string;
  description: string;
  priority: UiPriority;
  status: UiStatus;
  progress: number;
  deadline: string; // 'YYYY-MM-DD HH:MM:SS' ou 'YYYY-MM-DD'
  updatedAt: string;
}

/* =========================
 * Helpers
 * ========================= */

function toFrPriority(p: DbPriority): UiPriority {
  if (p === "high") return "Haute";
  if (p === "medium") return "Moyenne";
  return "Basse";
}

function toIsoDateTimeString(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  // si c'est déjà une string datetime SQL, on renvoie tel quel
  return v;
}

/* =========================
 * Handler
 * ========================= */

export async function GET() {
  try {
    const { userId } = await requireManager();
    const pool = getPool();

    // ✅ TaskRow hérite de RowDataPacket ⇒ le générique satisfait la contrainte QueryResult
    const [rows] = await pool.query<TaskRow[]>(
      `
      SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.progress,
        t.priority,
        t.due_date,
        t.due_time,
        t.updated_at
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id = :uid
      ORDER BY t.updated_at DESC, t.id DESC
      `,
      { uid: userId }
    );

    // Début de journée (00:00) pour le calcul "overdue"
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const out: TaskOut[] = rows.map((r) => {
      const deadline = r.due_time ? `${r.due_date} ${r.due_time}` : r.due_date;
      // 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DDTHH:MM:SS' pour Date
      const due = new Date(deadline.replace(" ", "T"));
      const isOverdue = r.status !== "done" && due.getTime() < todayStart.getTime();

      return {
        id: Number(r.id),
        title: r.title,
        description: r.description ?? "",
        priority: toFrPriority(r.priority),
        status: (isOverdue ? "overdue" : r.status) as UiStatus,
        progress: Number(r.progress),
        deadline,
        updatedAt: toIsoDateTimeString(r.updated_at),
      };
    });

    return NextResponse.json(out, { status: 200 });
  } catch (err: unknown) {
    // pas de `any` ici
    let msg: "Forbidden" | "Unauthorized" | "Server error" = "Server error";
    if (err instanceof Error) {
      if (err.message === "Forbidden" || err.message === "Unauthorized") {
        msg = err.message;
      }
    }

    const status =
      msg === "Server error" ? 500 : msg === "Unauthorized" ? 401 : 403;

    return NextResponse.json({ error: msg }, { status });
  }
}
