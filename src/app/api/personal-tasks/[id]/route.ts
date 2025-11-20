// app/api/personal-tasks/[taskId]/route.ts
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

type Status = "todo" | "in_progress" | "blocked" | "done";

/** Schéma minimal d’une ligne renvoyée par la table `tasks` */
type TaskRow = {
  id: number | string;
  user_id: number | string;
  title: string | null;
  description: string | null;
  due_date: Date | string | null;
  status: Status;
  progress: number | null;
  performance: number | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TaskDto = {
  id: number;
  title: string;
  description: string | null;
  dueDate: string | null; // ISO YYYY-MM-DD
  status: Status;
  progress: number;
  performance: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

/** Narrowing utile pour extraire l'id utilisateur d'un payload inconnu */
function getUserIdFromJwtPayload(payload: unknown): number | null {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const raw = obj["user_id"] ?? obj["id"];
    if (typeof raw === "number" || typeof raw === "string") {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function isStatus(value: unknown): value is Status {
  return value === "todo" || value === "in_progress" || value === "blocked" || value === "done";
}

function toYYYYMMDD(date: Date | string | null): string | null {
  if (!date) return null;
  if (typeof date === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = new Date(date);
    if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function mapRow(r: TaskRow): TaskDto {
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    description: r.description ?? null,
    dueDate: toYYYYMMDD(r.due_date),
    status: r.status,
    progress: Number(r.progress ?? 0),
    performance: Number(r.performance ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** GET /api/personal-tasks/[taskId] */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await context.params;

    // Dans Next 15, cookies() est sync, mais si ta config renvoie une promesse, `await` reste safe.
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload: unknown = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    const me = getUserIdFromJwtPayload(payload);
    if (!me) {
      return NextResponse.json({ error: "Token invalide (user_id manquant)" }, { status: 401 });
    }

    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & TaskRow)[]>(
      "SELECT * FROM tasks WHERE id=? AND user_id=? LIMIT 1",
      [id, me]
    );

    if (!rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ item: mapRow(rows[0]) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/personal-tasks/[taskId] */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await context.params;

    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload: unknown = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    const me = getUserIdFromJwtPayload(payload);
    if (!me) {
      return NextResponse.json({ error: "Token invalide (user_id manquant)" }, { status: 401 });
    }

    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const bodyRaw: unknown = await req.json().catch(() => null);
    if (!bodyRaw || typeof bodyRaw !== "object") {
      return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
    }

    const body = bodyRaw as {
      title?: unknown;
      description?: unknown;
      dueDate?: unknown;
      status?: unknown;
      progress?: unknown;
      performance?: unknown;
    };

    const up: Record<string, string | number | null> = {};

    if ("title" in body) {
      up.title = String((body.title ?? "").toString().trim());
    }

    if ("description" in body) {
      const d = body.description;
      up.description = d == null ? null : d.toString();
    }

    if ("dueDate" in body) {
      const d = String((body.dueDate ?? "").toString().trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return NextResponse.json({ error: "dueDate invalide" }, { status: 400 });
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dv = new Date(d);
      dv.setHours(0, 0, 0, 0);
      if (dv.getTime() < today.getTime()) {
        return NextResponse.json({ error: "Échéance dans le passé" }, { status: 400 });
      }
      up.due_date = d;
    }

    if ("status" in body) {
      const s = (body.status ?? "").toString();
      if (!isStatus(s)) {
        return NextResponse.json({ error: "status invalide" }, { status: 400 });
      }
      up.status = s;
    }

    if ("progress" in body) {
      const p = Number(body.progress ?? 0);
      if (!(p >= 0 && p <= 100)) {
        return NextResponse.json({ error: "progress (0..100)" }, { status: 400 });
      }
      up.progress = p;
    }

    if ("performance" in body) {
      const p2 = Number(body.performance ?? 0);
      if (!(p2 >= 0 && p2 <= 100)) {
        return NextResponse.json({ error: "performance (0..100)" }, { status: 400 });
      }
      up.performance = p2;
    }

    if (!Object.keys(up).length) {
      return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 });
    }

    const pool = getPool();

    // Sécurité: vérifier la propriété de la tâche
    const [own] = await pool.query<(RowDataPacket & Pick<TaskRow, "id">)[]>(
      "SELECT id FROM tasks WHERE id=? AND user_id=? LIMIT 1",
      [id, me]
    );
    if (!own.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const fields = Object.keys(up)
      .map((k) => `${k}=?`)
      .join(", ");

    await pool.query<ResultSetHeader>(`UPDATE tasks SET ${fields} WHERE id=?`, [
      ...Object.values(up),
      id,
    ]);

    const [rows] = await pool.query<(RowDataPacket & TaskRow)[]>(
      "SELECT * FROM tasks WHERE id=? LIMIT 1",
      [id]
    );

    return NextResponse.json({ item: mapRow(rows[0]) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
