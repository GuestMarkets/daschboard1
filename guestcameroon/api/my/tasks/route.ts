// app/guestmarkets/api/my/tasks/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

/* ================== Types ================== */
type Priority = "low" | "medium" | "high";
type TaskStatus = "todo" | "doing" | "done" | "archived";

interface Assignee {
  id: number;
  name: string;
  email: string;
}

interface RecurrenceInput {
  frequency: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  count?: number;
}

interface PostBody {
  title: string;
  description?: string | null;
  due_date: string; // YYYY-MM-DD
  due_time?: string | null; // HH:mm:ss (ou null)
  assigneeIds?: number[];
  is_recurrent?: boolean;
  recurrence?: RecurrenceInput;
  priority?: Priority;
}

// Représente une ligne renvoyée par MySQL pour "t.* + assignees agrégés"
interface DBTaskRow extends RowDataPacket {
  // Colonnes fréquentes (adaptez si votre table a d'autres colonnes)
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  status: TaskStatus;
  progress: number;
  performance: number;
  priority: Priority;
  is_recurrent: 0 | 1;
  recurrence_pattern: string | null;
  created_by: number;

  // L’agrégat JSON renvoyé par JSON_ARRAYAGG(JSON_OBJECT(...))
  assignees: string | null; // MySQL renvoie généralement une string JSON
}

// Objet renvoyé à l’API (assignees en tableau typé + assigneeIds)
interface TaskItem {
  // On laisse le reste libre car "t.*" peut évoluer : on expose toutes les colonnes de la tâche
  [key: string]: unknown;

  assignees: Assignee[];
  assigneeIds: number[];
}

/* ================== Utils ================== */
function parseAssignees(input: string | Assignee[] | null): Assignee[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (Array.isArray(parsed)) {
      // Filtrage minimal pour s’assurer du shape
      return parsed
        .map((x) => {
          const obj = x as Partial<Assignee>;
          if (
            typeof obj?.id === "number" &&
            typeof obj?.name === "string" &&
            typeof obj?.email === "string"
          ) {
            return { id: obj.id, name: obj.name, email: obj.email };
          }
          return null;
        })
        .filter((x): x is Assignee => x !== null);
    }
    return [];
  } catch {
    return [];
  }
}

/* ================== GET ================== */
export async function GET() {
  try {
    const { user } = await requireUser();

    const [rows] = await pool.query<DBTaskRow[]>(
      `
      SELECT
        t.*,
        JSON_ARRAYAGG(JSON_OBJECT('id', a.id, 'name', a.name, 'email', a.email)) AS assignees
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      JOIN users a           ON a.id = ta.user_id
      WHERE ta.user_id = ?
      GROUP BY t.id
      ORDER BY COALESCE(t.due_date, '9999-12-31') ASC, t.id DESC
      `,
      [user.id]
    );

    const items: TaskItem[] = rows.map((r) => {
      const assignees = parseAssignees(r.assignees);
      const assigneeIds = assignees.map((x) => x.id);

      // On expose toutes les colonnes de la tâche + les champs calculés
      const { assignees: _drop, ...rest } = r;
      return {
        ...rest,
        assignees,
        assigneeIds,
      };
    });

    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ================== POST ================== */
export async function POST(req: Request) {
  try {
    const { user } = await requireUser();

    // Typage de body via cast contrôlé (évite "any")
    const body = (await req.json()) as Partial<PostBody>;

    const {
      title,
      description = null,
      due_date,
      due_time = null,
      assigneeIds = [user.id],
      is_recurrent = false,
      recurrence = { frequency: "NONE" as const },
      priority = "low" as Priority,
    } = body;

    if (!title || !due_date) {
      return NextResponse.json(
        { error: "title et due_date requis" },
        { status: 400 }
      );
    }

    const recurrencePattern =
      is_recurrent && recurrence?.frequency && recurrence.frequency !== "NONE"
        ? `FREQ=${recurrence.frequency};INTERVAL=${recurrence.interval ?? 1};COUNT=${recurrence.count ?? 1}`
        : null;

    // Création
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO tasks (title, description, due_date, due_time, status, progress, performance, priority, is_recurrent, recurrence_pattern, created_by)
       VALUES (?, ?, ?, ?, 'todo', 0, 0, ?, ?, ?, ?)`,
      [
        String(title),
        description,
        String(due_date),
        due_time,
        String(priority),
        is_recurrent ? 1 : 0,
        recurrencePattern,
        user.id,
      ]
    );

    const taskId = res.insertId;

    // Affectations (uniquement l’auteur + soi-même dans /my/)
    const uniqueAssignees = Array.from(
      new Set<number>([...assigneeIds.map(Number), user.id])
    );
    if (uniqueAssignees.length > 0) {
      const values = uniqueAssignees.map((uid) => `(${taskId}, ${uid})`).join(",");
      await pool.query(`INSERT INTO task_assignees (task_id, user_id) VALUES ${values}`);
    }

    // Retour de l’item créé
    const [rows] = await pool.query<DBTaskRow[]>(
      `
      SELECT
        t.*,
        JSON_ARRAYAGG(JSON_OBJECT('id', a.id, 'name', a.name, 'email', a.email)) AS assignees
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      JOIN users a           ON a.id = ta.user_id
      WHERE t.id = ?
      GROUP BY t.id
      `,
      [taskId]
    );

    const r = rows[0];
    const assignees = parseAssignees(r.assignees);
    const assigneeIdsOut = assignees.map((x) => x.id);

    const { assignees: _drop, ...rest } = r;
    const item: TaskItem = {
      ...rest,
      assignees,
      assigneeIds: assigneeIdsOut,
    };

    return NextResponse.json({ item }, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
