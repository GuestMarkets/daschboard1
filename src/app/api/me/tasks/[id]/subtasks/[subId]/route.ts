// app/api/me/tasks/[taskId]/subtasks/[subId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPool } from "../../../../../../../../lib/db";
import { getAuthUserId } from "../../../../../../../../lib/auth_user";

/* =========================
   Types utilitaires
========================= */
type PatchBody = {
  title?: string | null;
  description?: string | null;
  done?: boolean | 0 | 1 | null;
};

type SubtaskRow = RowDataPacket & {
  id: number;
  title: string | null;
  description: string | null;
  done: 0 | 1 | number;
  created_at: string | Date;
};

/* =========================
   Helpers
========================= */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    return typeof msg === "string" ? msg : "Erreur inconnue";
  }
  return "Erreur inconnue";
}

async function assertOwned(pool: Pool, subId: number, userId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT st.id
       FROM task_subtasks st
       JOIN tasks t ON t.id = st.task_id
      WHERE st.id = ? AND t.created_by = ?`,
    [subId, userId]
  );
  return rows.length > 0;
}

/* =========================
   PATCH
========================= */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; subId: string }> }
) {
  try {
    const userId = await getAuthUserId();

    // ⚠️ Next 15: params est un Promise
    const { subId: subIdStr } = await context.params;
    const subId = Number(subIdStr);
    if (!Number.isFinite(subId) || subId <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as PatchBody | null;
    if (!body) {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }

    const pool = getPool() as unknown as Pool;

    const owned = await assertOwned(pool, subId, userId);
    if (!owned) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }

    const updateFields: string[] = [];
    const updateValues: Array<string | number> = [];

    if ("title" in body) {
      updateFields.push("title = ?");
      updateValues.push(String((body.title ?? "").toString().trim()));
    }
    if ("description" in body) {
      updateFields.push("description = ?");
      updateValues.push(
        body.description === null || body.description === undefined
          ? ""
          : String(body.description)
      );
    }
    if ("done" in body) {
      updateFields.push("done = ?");
      const doneVal: 0 | 1 = body.done === true || body.done === 1 ? 1 : 0;
      updateValues.push(doneVal);
    }

    if (updateFields.length === 0) {
      return NextResponse.json(
        { error: "Rien à mettre à jour" },
        { status: 400 }
      );
    }

    await pool.query<ResultSetHeader>(
      `UPDATE task_subtasks SET ${updateFields.join(", ")} WHERE id = ?`,
      [...updateValues, subId]
    );

    const [rows] = await pool.query<SubtaskRow[]>(
      `SELECT id, title, description, done, created_at
         FROM task_subtasks
        WHERE id = ?`,
      [subId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }

    const r = rows[0];
    const normalizedDone: 0 | 1 = Number(r.done) === 1 ? 1 : 0;

    const item = {
      id: Number(r.id),
      title: String(r.title ?? ""),
      description: String(r.description ?? ""),
      done: normalizedDone,
      createdAt:
        typeof r.created_at === "string"
          ? r.created_at
          : (r.created_at as Date).toISOString(),
    };

    return NextResponse.json({ item });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

/* =========================
   DELETE
========================= */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; subId: string }> }
) {
  try {
    const userId = await getAuthUserId();

    const { subId: subIdStr } = await context.params;
    const subId = Number(subIdStr);
    if (!Number.isFinite(subId) || subId <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const pool = getPool() as unknown as Pool;

    const owned = await assertOwned(pool, subId, userId);
    if (!owned) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }

    await pool.query<ResultSetHeader>(
      "DELETE FROM task_subtasks WHERE id = ?",
      [subId]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
