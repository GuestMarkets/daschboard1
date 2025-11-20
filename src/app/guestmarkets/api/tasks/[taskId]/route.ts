// app/guestmarkets/api/tasks/[taskId]/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

// ──────────────────────────────────────────────────────────────
// Interfaces manquantes (obligatoires pour ce fichier)
// ──────────────────────────────────────────────────────────────
interface TaskRow extends RowDataPacket {
    id: number;
    title: string;
    description: string | null;
    due_date: string | null;       // ou Date si tu veux, mais DB retourne string
    due_time: string | null;
    status: string;
    progress: number | null;
    performance: number | null;
    priority: string;
    is_recurrent: 0 | 1;
    recurrence_pattern: string | null;
    created_by: number;
    created_at: string;
    updated_at: string;
}

interface AssigneeRow extends RowDataPacket {
    task_id: number;
    user_id: number;
    name?: string;
    email?: string;
}

// … tes interfaces restent 100 % identiques (TaskRow, AssigneeRow, etc.)

async function getTaskForUser(taskId: number, uid: number) {
    const [rows] = await pool.query<TaskRow[]>(
        `
            SELECT t.*
            FROM tasks t
                     LEFT JOIN task_assignees ta ON ta.task_id = t.id
            WHERE t.id = ? AND (t.created_by = ? OR ta.user_id = ?)
                LIMIT 1
        `,
        [taskId, uid, uid]
    );
    return rows[0] || null;
}

async function hydrateTask(t: TaskRow) {
    const [assRows] = await pool.query<AssigneeRow[]>(
        `
            SELECT ta.task_id, u.id AS user_id, u.name, u.email
            FROM task_assignees ta
                     JOIN users u ON u.id = ta.user_id
            WHERE ta.task_id = ?
        `,
        [t.id]
    );
    const assignees = assRows.map((r) => ({
        id: Number(r.user_id),
        name: r.name ?? "",
        email: r.email ?? "",
    }));
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
}

/* ========== PATCH ========== */
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ taskId: string }> }   // ← déjà bon
) {
    try {
        const { user } = await requireUser();
        const uid = Number(user.id);

        const { taskId } = await params;               // ← await obligatoire en Next 15
        const id = Number(taskId);

        if (!id || isNaN(id)) {
            return NextResponse.json({ error: "id invalide" }, { status: 400 });
        }

        const existing = await getTaskForUser(id, uid);
        if (!existing) {
            return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });
        }

        const patch = await req.json().catch(() => ({}));

        const fields: string[] = [];
        const values: any[] = [];

        const assign = (col: string, val: any) => {
            if (val === undefined) return;
            fields.push(`${col} = ?`);
            values.push(val);
        };

        assign("title", patch.title);
        assign("description", patch.description ?? null);
        assign("due_date", patch.due_date);
        assign("due_time", patch.due_time ?? null);
        assign("status", patch.status);
        assign("progress", patch.progress);
        assign("performance", patch.performance);
        assign("priority", patch.priority);
        assign(
            "is_recurrent",
            typeof patch.is_recurrent === "boolean" ? (patch.is_recurrent ? 1 : 0) : undefined
        );
        assign("recurrence_pattern", patch.recurrence_pattern);

        if (!fields.length) {
            const hydrated = await hydrateTask(existing);
            return NextResponse.json({ item: hydrated });
        }

        fields.push("updated_at = CURRENT_TIMESTAMP");
        values.push(id); // ← id et non taskId ici !

        await pool.execute(
            `UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`,
            values
        );

        const [rows] = await pool.query<TaskRow[]>(`SELECT * FROM tasks WHERE id = ? LIMIT 1`, [id]);
        const updated = rows[0];
        const item = await hydrateTask(updated);

        return NextResponse.json({ item });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Server error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/* ========== DELETE ========== */
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ taskId: string }> }   // ← CHANGEMENT PRINCIPAL ICI
) {
    try {
        const { user } = await requireUser();
        const uid = Number(user.id);

        const { taskId } = await params;               // ← await aussi ici
        const id = Number(taskId);

        if (!id || isNaN(id)) {
            return NextResponse.json({ error: "id invalide" }, { status: 400 });
        }

        const existing = await getTaskForUser(id, uid);
        if (!existing) {
            return NextResponse.json({ error: "Tâche introuvable" }, { status: 404 });
        }

        await pool.execute(`DELETE FROM task_subtasks WHERE task_id = ?`, [id]);
        await pool.execute(`DELETE FROM task_assignees WHERE task_id = ?`, [id]);
        await pool.execute(`DELETE FROM tasks WHERE id = ?`, [id]);

        return NextResponse.json({ ok: true });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Server error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

/* Optionnel : si tu as un GET, fais pareil */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ taskId: string }> }
) {
    // même logique avec await params + Number(taskId)
}