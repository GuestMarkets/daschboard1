// app/guestmarkets/api/tasks/[taskId]/subtasks/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";

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
            WHERE t.id = ? AND (t.created_by = ? OR ta.user_id = ?)
                LIMIT 1
        `,
        [taskId, uid, uid]
    );
    return !!rows[0];
}

/* GET : liste des sous-tâches */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const { user } = await requireUser();
        const uid = Number(user.id);

        const { taskId: taskIdStr } = await params;
        const taskId = Number(taskIdStr);

        if (!taskId || isNaN(taskId)) {
            return NextResponse.json({ error: "id invalide" }, { status: 400 });
        }

        const ok = await userCanAccessTask(taskId, uid);
        if (!ok) {
            return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });
        }

        const [rows] = await pool.query<SubtaskRow[]>(
            `SELECT * FROM task_subtasks WHERE task_id = ? ORDER BY created_at DESC`,
            [taskId]
        );

        return NextResponse.json({ items: rows });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Server error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/* POST : création d'une sous-tâche */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ taskId: string }> }
) {
    try {
        const { user } = await requireUser();
        const uid = Number(user.id);

        const { taskId: taskIdStr } = await params;
        const taskId = Number(taskIdStr);

        if (!taskId || isNaN(taskId)) {
            return NextResponse.json({ error: "id invalide" }, { status: 400 });
        }

        const ok = await userCanAccessTask(taskId, uid);
        if (!ok) {
            return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });
        }

        const body = await req.json().catch(() => ({}));
        const { title, description } = body;

        if (!title || typeof title !== "string") {
            return NextResponse.json({ error: "title requis et doit être une chaîne" }, { status: 400 });
        }

        const [result] = await pool.execute<ResultSetHeader>(
            `INSERT INTO task_subtasks (task_id, title, description, done) VALUES (?, ?, ?, 0)`,
            [taskId, title.trim(), description ?? null]
        );

        const subId = Number(result.insertId);

        const [rows] = await pool.query<SubtaskRow[]>(
            `SELECT * FROM task_subtasks WHERE id = ? LIMIT 1`,
            [subId]
        );

        return NextResponse.json({ item: rows[0] });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Server error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}