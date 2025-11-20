// app/guestmarkets/api/tasks/[taskId]/subtasks/[subId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../../../lib/db";
import { requireUser } from "../../../../../../../../lib/auth";

type OkRow = RowDataPacket;

interface SubtaskRow extends RowDataPacket {
  id: number;
  task_id: number;
  title: string | null;
  description: string | null;
  done: 0 | 1; // stocké en base sous forme tinyint(1)
}

type SubtaskUpdate = {
  title?: string;
  description?: string;
  done?: boolean;
};

// --- Helpers ---
async function canAccess(userId: number, taskId: number): Promise<boolean> {
  const [a] = await pool.query<OkRow[]>(
    "SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1",
    [taskId, userId]
  );
  if (a.length > 0) return true;

  const [dep] = await pool.query<OkRow[]>(
    `
    SELECT 1
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id = ?
      AND u.department_id IN (SELECT id FROM departments WHERE manager_id = ?)
    LIMIT 1
    `,
    [taskId, userId]
  );
  if (dep.length > 0) return true;

  const [proj] = await pool.query<OkRow[]>(
    `
    SELECT 1
    FROM task_assignees ta
    JOIN team_members tm ON tm.user_id = ta.user_id
    JOIN teams t ON t.id = tm.team_id
    WHERE ta.task_id = ?
      AND t.project_id IN (SELECT id FROM projects WHERE manager_id = ?)
    LIMIT 1
    `,
    [taskId, userId]
  );
  if (proj.length > 0) return true;

  const [team] = await pool.query<OkRow[]>(
    `
    SELECT 1
    FROM task_assignees ta
    JOIN team_members tm ON tm.user_id = ta.user_id
    JOIN teams t ON t.id = tm.team_id
    WHERE ta.task_id = ?
      AND t.leader_user_id = ?
    LIMIT 1
    `,
    [taskId, userId]
  );
  return team.length > 0;
}

function isSubtaskUpdate(x: unknown): x is SubtaskUpdate {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if ("title" in o && o.title !== undefined && typeof o.title !== "string") return false;
  if ("description" in o && o.description !== undefined && typeof o.description !== "string") return false;
  if ("done" in o && o.done !== undefined && typeof o.done !== "boolean") return false;
  return true;
}

function parseIds(taskIdStr: string, subIdStr: string) {
  const taskId = Number(taskIdStr);
  const subId = Number(subIdStr);
  if (!Number.isFinite(taskId) || !Number.isFinite(subId)) {
    return null;
  }
  return { taskId, subId };
}

function toTinyInt(b: boolean): 0 | 1 {
  return b ? 1 : 0;
}

type RouteContext = { params: Promise<{ taskId: string; subId: string }> };

// --- PATCH / Update subtask ---
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireUser();

    const { taskId: taskIdStr, subId: subIdStr } = await context.params;
    const ids = parseIds(taskIdStr, subIdStr);
    if (!ids) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const { taskId, subId } = ids;

    if (!(await canAccess(user.id, taskId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bodyUnknown = await req.json();
    if (!isSubtaskUpdate(bodyUnknown)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const body = bodyUnknown;

    const fields: string[] = [];
    const values: Array<string | number> = [];

    if (body.title !== undefined) {
      fields.push("title = ?");
      values.push(body.title);
    }
    if (body.description !== undefined) {
      fields.push("description = ?");
      values.push(body.description);
    }
    if (body.done !== undefined) {
      fields.push("done = ?");
      values.push(toTinyInt(body.done));
    }

    if (fields.length > 0) {
      await pool.query(
        `UPDATE task_subtasks SET ${fields.join(", ")} WHERE id = ? AND task_id = ?`,
        [...values, subId, taskId]
      );
    }

    // On relit en s’assurant du task_id (sécurité)
    const [rows] = await pool.query<SubtaskRow[]>(
      "SELECT * FROM task_subtasks WHERE id = ? AND task_id = ? LIMIT 1",
      [subId, taskId]
    );

    const item = rows[0] ?? null;

    // Normalisation du champ done → boolean côté API
    const normalized =
      item === null
        ? null
        : {
            ...item,
            done: item.done === 1,
          };

    return NextResponse.json({ item: normalized });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- DELETE / Remove subtask ---
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireUser();

    const { taskId: taskIdStr, subId: subIdStr } = await context.params;
    const ids = parseIds(taskIdStr, subIdStr);
    if (!ids) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const { taskId, subId } = ids;

    if (!(await canAccess(user.id, taskId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await pool.query("DELETE FROM task_subtasks WHERE id = ? AND task_id = ?", [subId, taskId]);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
