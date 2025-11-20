// app/api/tasks/[taskId]/subtasks/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return "Erreur serveur";
  }
}

// — Helpers
function toNonEmptyString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

// ======================= GET =======================
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Next 15 typed routes: params est un Promise
    const { id } = await context.params;

    // cookies() peut être sync ou async selon la version.
    // Cette écriture fonctionne dans les deux cas:
    const ck = await (async () => cookies())();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;

    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    const taskId = Number(id);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, task_id, title, description, done, created_at
       FROM task_subtasks
       WHERE task_id = ?
       ORDER BY id DESC`,
      [taskId]
    );

    return NextResponse.json({ items: rows });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

// ======================= POST =======================
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const ck = await (async () => cookies())();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    const taskId = Number(id);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const bodyRaw = await req.json().catch(() => null);
    if (!bodyRaw || typeof bodyRaw !== "object") {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }

    const { title: tRaw, description: dRaw } = bodyRaw as {
      title?: unknown;
      description?: unknown;
    };

    const title = toNonEmptyString(tRaw);
    const description = toNonEmptyString(dRaw);

    if (!title) {
      return NextResponse.json({ error: "Titre requis" }, { status: 400 });
    }

    const pool = getPool();
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO task_subtasks (task_id, title, description)
       VALUES (?,?,?)`,
      [taskId, title, description || null]
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, task_id, title, description, done, created_at
       FROM task_subtasks
       WHERE id = ?`,
      [ins.insertId]
    );

    // Par sécurité si aucun retour (rare, mais propre)
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: "Création effectuée mais récupération impossible" },
        { status: 201 }
      );
    }

    return NextResponse.json({ item: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
