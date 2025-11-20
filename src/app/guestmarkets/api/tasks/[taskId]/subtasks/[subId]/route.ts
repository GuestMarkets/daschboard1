// app/guestmarkets/api/tasks/[taskId]/subtasks/[subId]/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../../../lib/db";
import { requireUser } from "../../../../../../../../lib/auth";

interface TaskRow extends RowDataPacket {
    id: number;
    created_by: number;
}

interface SubtaskRow extends RowDataPacket {
    id: number;
    task_id: number;
    title: string;
    description: string | null;
    done: 0 | 1;
    created_at: string;
}

async function userCanAccessTask(taskId: number, uid: number) {
    const [rows] = await pool.query<TaskRow[]>(
        `
            SELECT t.id, t.created_by
            FROM tasks t
                     LEFT JOIN task_assignees ta ON ta.task_id = t.id
            WHERE t.id = ? AND (t.created_by = ? OR ta.user_id = ?
                LIMIT 1
        `,
        [taskId, uid, uid]
    );
    return !!rows[0];
}

/* PATCH : toggle done ou mise à jour simple */
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ taskId: string; subId: string }> }
) {
    try {
        const { user } = await requireUser();
        const uid = Number(user.id);

        // Next.js 15 → params est une Promise
        const { taskId: taskIdStr, subId: subtaskIdStr } = await params;
        const taskId = Number(taskIdStr);
        const subId = Number(subtaskIdStr);

        if (!taskId || !subId || isNaN(taskId) || isNaN(subId)) {
            return NextResponse.json({ error: "id invalide" }, { status: 400 });
        }

        const ok = await userCanAccessTask(taskId, uid);
        if (!ok) {
            return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });
        }

        const body = await req.json().catch(() => ({}));
        const { done } = body;

        if (done === undefined) {
            return NextResponse.json({ error: "Champ done requis" }, { status: 400 });
        }

        await pool.execute(
            `UPDATE task_subtasks SET done = ? WHERE id = ? AND task_id = ?`,
            [done ? 1 : 0, subId, taskId]
        );

        const [rows] = await pool.query<SubtaskRow[]>(
            `SELECT * FROM task_subtasks WHERE id = ? AND task_id = ? LIMIT 1`,
            [subId, taskId]
        );

        if (!rows[0]) {
            return NextResponse.json({ error: "Sous-tâche introuvable" }, { status: 404 });
        }

        return NextResponse.json({ item: rows[0] });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Server error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/* DELETE : suppression d'une sous-tâche */
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ taskId: string; subId: string }> }
) {
    try {
        const { user } = await requireUser();
        const uid = Number(user.id);

        const { taskId: taskIdStr, subId: subtaskIdStr } = await params;
        const taskId = Number(taskIdStr);
        const subId = Number(subtaskIdStr);

        if (!taskId || !subId || isNaN(taskId) || isNaN(subId)) {
            return NextResponse.json({ error: "id invalide" }, { status: 400 });
        }

        const ok = await userCanAccessTask(taskId, uid);
        if (!ok) {
            return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });
        }

        await pool.execute(
            `DELETE FROM task_subtasks WHERE id = ? AND task_id = ?`,
            [subId, taskId]
        );

        return NextResponse.json({ ok: true });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Server error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}