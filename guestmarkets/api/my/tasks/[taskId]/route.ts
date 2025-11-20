// app/guestmarkets/api/my/tasks/[taskId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";

/** Types utilitaires */
type SqlValue = string | number | boolean | Date | null;

type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

interface TaskRow extends RowDataPacket {
  id: number;
  title?: string | null;
  description?: string | null;
  due_date?: string | Date | null;
  due_time?: string | null;
  priority?: string | number | null;
  status: TaskStatus | string;
  progress: number;
  performance?: number | null;
  is_recurrent?: 0 | 1 | boolean | null;
  recurrence_pattern?: string | null;
  blocked_reason?: string | null;
  updated_at?: string | Date | null;
  // Le SELECT final ajoute une colonne "assignees" (JSON agrégé)
  assignees?: unknown;
}

interface Assignee {
  id: number;
  name: string;
  email: string;
}

type PatchSimpleKeys =
  | "title"
  | "description"
  | "due_date"
  | "due_time"
  | "priority"
  | "status"
  | "progress"
  | "performance"
  | "is_recurrent"
  | "recurrence_pattern";

type PatchSimple = Partial<
  Pick<
    TaskRow,
    | "title"
    | "description"
    | "due_date"
    | "due_time"
    | "priority"
    | "status"
    | "progress"
    | "performance"
    | "is_recurrent"
    | "recurrence_pattern"
  >
>;

interface TaskPatch extends PatchSimple {
  assigneeIds?: number[];
}

/** Helpers sûrs */

function isAssigneeArray(val: unknown): val is Assignee[] {
  return (
    Array.isArray(val) &&
    val.every(
      (x) =>
        x &&
        typeof x === "object" &&
        "id" in x &&
        "name" in x &&
        "email" in x &&
        typeof (x as { id: unknown }).id === "number"
    )
  );
}

function parseAssignees(maybeJson: unknown): Assignee[] {
  if (isAssigneeArray(maybeJson)) return maybeJson;
  if (typeof maybeJson === "string") {
    try {
      const parsed = JSON.parse(maybeJson);
      return isAssigneeArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toSqlValue(v: unknown): v is SqlValue {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    v instanceof Date
  );
}

/** PATCH */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { user } = await requireUser();

    // Dans Next 15, params peut être une Promise
    const { taskId: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Vérifier que l’utilisateur est assigné à la tâche
    const [chk] = await pool.query<RowDataPacket[]>(
      "SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1",
      [id, user.id]
    );
    if (!chk.length) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const raw = (await req.json()) as unknown;
    const patch: TaskPatch =
      typeof raw === "object" && raw ? (raw as TaskPatch) : {};

    // Patch champs simples typés
    const updatableKeys: PatchSimpleKeys[] = [
      "title",
      "description",
      "due_date",
      "due_time",
      "priority",
      "status",
      "progress",
      "performance",
      "is_recurrent",
      "recurrence_pattern",
    ];

    const fields: string[] = [];
    const values: SqlValue[] = [];

    for (const k of updatableKeys) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        const val = (patch as PatchSimple)[k];
        if (toSqlValue(val)) {
          fields.push(`${k} = ?`);
          values.push(val);
        } else if (val === undefined) {
          // ignore
        } else {
          // valeur non mappable SQL — on la convertit en string pour rester safe
          fields.push(`${k} = ?`);
          values.push(String(val));
        }
      }
    }

    if (fields.length) {
      await pool.query<ResultSetHeader>(
        `UPDATE tasks SET ${fields.join(
          ", "
        )}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, id]
      );
    }

    // Auto-ajustement status
    const [one] = await pool.query<TaskRow[]>(
      "SELECT * FROM tasks WHERE id = ? LIMIT 1",
      [id]
    );
    const t = one[0];
    let nextStatus: TaskStatus | string = t.status;

    if (typeof t.progress === "number" && t.progress >= 100) {
      nextStatus = "done";
    } else if (
      t.status === "todo" &&
      typeof t.progress === "number" &&
      t.progress > 0
    ) {
      nextStatus = "in_progress";
    }
    if (t.blocked_reason && String(t.blocked_reason).trim().length > 0) {
      nextStatus = "blocked";
    }

    if (nextStatus !== t.status) {
      await pool.query<ResultSetHeader>(
        "UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [nextStatus, id]
      );
    }

    // Réaffectations (optionnel) — on limite à soi
    if (Array.isArray(patch.assigneeIds) && patch.assigneeIds.length > 0) {
      const keep = Array.from(
        new Set<number>(
          patch.assigneeIds.map((n) => Number(n)).concat([user.id])
        )
      );

      await pool.query<ResultSetHeader>(
        "DELETE FROM task_assignees WHERE task_id = ?",
        [id]
      );

      // Insertion bulk (les IDs sont numériques, générés côté serveur)
      const placeholders = keep.map(() => "(?, ?)").join(", ");
      const bulkValues: Array<number> = [];
      for (const uid of keep) {
        bulkValues.push(id, uid);
      }
      await pool.query<ResultSetHeader>(
        `INSERT INTO task_assignees (task_id, user_id) VALUES ${placeholders}`,
        bulkValues
      );
    }

    // Retour (avec assignees)
    const [rows] = await pool.query<TaskRow[]>(
      `
      SELECT 
        t.*, 
        JSON_ARRAYAGG(
          JSON_OBJECT('id', a.id, 'name', a.name, 'email', a.email)
        ) AS assignees
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      JOIN users a           ON a.id = ta.user_id
      WHERE t.id = ?
      GROUP BY t.id
      `,
      [id]
    );

    const r = rows[0];
    const assignees = parseAssignees(r.assignees);
    const item = {
      ...r,
      assignees,
      assigneeIds: assignees.map((x) => x.id),
    };

    return NextResponse.json({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { user } = await requireUser();

    const { taskId: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Sécurité : seul un assignee peut supprimer (ou admin, omis ici)
    const [chk] = await pool.query<RowDataPacket[]>(
      "SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1",
      [id, user.id]
    );
    if (!chk.length) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await pool.query<ResultSetHeader>(
      "DELETE FROM task_subtasks WHERE task_id = ?",
      [id]
    );
    await pool.query<ResultSetHeader>(
      "DELETE FROM task_assignees WHERE task_id = ?",
      [id]
    );
    await pool.query<ResultSetHeader>("DELETE FROM tasks WHERE id = ?", [id]);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
