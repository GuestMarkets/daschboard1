// /api/projects/[projectId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/* ---------- Utils ---------- */
function isValidISO(d: string) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }
function computeAutoStatus(startDate: string, endDate: string): "planned"|"active"|"done" {
  const now = new Date();
  const sd = new Date(`${startDate}T00:00:00`);
  const ed = new Date(`${endDate}T00:00:00`);
  if (now < sd) return "planned";
  if (now > ed) return "done";
  return "active";
}
function daysUntil(dateISO: string) {
  const now = new Date(); const ed = new Date(`${dateISO}T00:00:00`);
  return Math.ceil((ed.getTime() - now.getTime()) / (1000*60*60*24));
}
function computePriority(endDate: string): "low"|"medium"|"high" {
  const d = daysUntil(endDate);
  if (d <= 0) return "high";
  if (d <= 3) return "high";
  if (d <= 10) return "medium";
  return "low";
}
async function flags() {
  const [cols] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
  );
  const s = new Set(cols.map(c => c.COLUMN_NAME as string));
  return { hasManager: s.has("manager_id"), hasPriority: s.has("priority") };
}

type ProjectRow = RowDataPacket & {
  id: number; name: string; code: string; description: string | null;
  start_date: string; end_date: string; status: "planned"|"active"|"done"|"archived";
  progress: number; created_at: string; updated_at: string;
  manager_id?: number | null; priority?: "low"|"medium"|"high" | null;
  manager_name?: string | null;
};
type AssigneeRow = RowDataPacket & { project_id: number; user_id: number; user_name: string };

async function hydrate(projectId: number) {
  const { hasManager, hasPriority } = await flags();
  const select =
    `SELECT p.id, p.name, p.code, p.description, p.start_date, p.end_date, p.status, p.progress,
            p.created_at, p.updated_at,
            ${hasManager ? "p.manager_id" : "NULL AS manager_id"},
            ${hasPriority ? "p.priority" : "NULL AS priority"}
            ${hasManager ? ", u.name AS manager_name" : ", NULL AS manager_name"}
       FROM projects p
       ${hasManager ? "LEFT JOIN users u ON u.id = p.manager_id" : ""}
      WHERE p.id = ?`;

  const [rows] = await pool.query<ProjectRow[]>(select, [projectId]);
  if (!rows.length) return null;

  const [assignees] = await pool.query<AssigneeRow[]>(
    `SELECT pa.project_id, u.id AS user_id, u.name AS user_name
       FROM project_assignees pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.project_id = ?`,
    [projectId]
  );

  const ass = assignees.map(a => ({ id: a.user_id, name: a.user_name }));
  const assIds = assignees.map(a => a.user_id);

  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    progress: r.progress ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    managerId: r.manager_id ?? null,
    manager: r.manager_id ? { id: r.manager_id, name: r.manager_name ?? "" } : null,
    priority: r.priority ?? null,
    assignees: ass,
    assigneeIds: assIds,
  };
}

/* ---------- GET ---------- */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const id = Number(projectId);
    const item = await hydrate(id);
    if (!item) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ---------- PATCH ---------- */
type PatchPayload = {
  archive?: boolean;
  activate?: boolean;
  complete?: boolean;

  name?: string;
  code?: string;
  description?: string | null;

  startDate?: string;
  endDate?: string;

  progress?: number;

  managerId?: number | null;

  priority?: "low" | "medium" | "high" | null;

  status?: "planned" | "active" | "done" | "archived";

  assigneeIds?: (number | string)[];
};

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const id = Number(projectId);

    // ⬇️ cookies() est async dans ton environnement
    const ck = await cookies();
    const headerToken = req.headers.get("authorization");
    const token =
      ck.get(SESSION_COOKIE_NAME)?.value ||
      (headerToken?.toLowerCase().startsWith("bearer ") ? headerToken.slice(7).trim() : null);

    const payload = token ? await verifyJwt(token) : null;
    if (!payload) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const patch: PatchPayload = await req.json();
    const { hasManager, hasPriority } = await flags();

    // actions rapides
    if (patch.archive === true) {
      await pool.query<ResultSetHeader>(`UPDATE projects SET status='archived', updated_at=NOW() WHERE id=?`, [id]);
      const item = await hydrate(id);
      return NextResponse.json({ item });
    }
    if (patch.activate === true) {
      const [r] = await pool.query<RowDataPacket[]>(`SELECT start_date, end_date FROM projects WHERE id=?`, [id]);
      if (!r || !r[0]) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
      const newStatus = computeAutoStatus(r[0].start_date, r[0].end_date);
      await pool.query<ResultSetHeader>(`UPDATE projects SET status=?, updated_at=NOW() WHERE id=?`, [newStatus, id]);
      const item = await hydrate(id);
      return NextResponse.json({ item });
    }
    if (patch.complete === true) {
      await pool.query<ResultSetHeader>(`UPDATE projects SET status='done', progress=100, updated_at=NOW() WHERE id=?`, [id]);
      const item = await hydrate(id);
      return NextResponse.json({ item });
    }

    // champs éditables
    const fields: string[] = [];
    const paramsSQL: (string | number | null)[] = [];

    if (patch.name !== undefined) { fields.push("name=?"); paramsSQL.push(String(patch.name).trim()); }
    if (patch.code !== undefined) { fields.push("code=?"); paramsSQL.push(String(patch.code).trim()); }
    if (patch.description !== undefined) { fields.push("description=?"); paramsSQL.push(patch.description ?? null); }

    let startDate: string | undefined;
    let endDate: string | undefined;

    if (patch.startDate !== undefined) {
      if (!isValidISO(patch.startDate)) return NextResponse.json({ error: "startDate invalide" }, { status: 400 });
      startDate = patch.startDate;
      fields.push("start_date=?"); paramsSQL.push(startDate);
    }
    if (patch.endDate !== undefined) {
      if (!isValidISO(patch.endDate)) return NextResponse.json({ error: "endDate invalide" }, { status: 400 });
      endDate = patch.endDate;
      fields.push("end_date=?"); paramsSQL.push(endDate);
    }

    if (patch.progress !== undefined) {
      const v = Math.max(0, Math.min(100, Number(patch.progress)));
      fields.push("progress=?"); paramsSQL.push(v);
    }

    if (hasManager && patch.managerId !== undefined) {
      fields.push("manager_id=?");
      paramsSQL.push(Number.isInteger(patch.managerId as number) ? (patch.managerId as number) : null);
    }

    if (hasPriority && patch.priority !== undefined) {
      const p = patch.priority;
      const ok = p === "low" || p === "medium" || p === "high" || p === null;
      if (!ok) return NextResponse.json({ error: "priority invalide" }, { status: 400 });
      fields.push("priority=?"); paramsSQL.push(p);
    }

    // récupérer dates si non fournies
    if (startDate === undefined || endDate === undefined) {
      const [r] = await pool.query<RowDataPacket[]>(`SELECT start_date, end_date FROM projects WHERE id=?`, [id]);
      if (!r || !r[0]) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
      startDate = startDate ?? r[0].start_date;
      endDate   = endDate   ?? r[0].end_date;
    }
    if (new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`)) {
      return NextResponse.json({ error: "La date de fin doit être ≥ à la date de début" }, { status: 400 });
    }

    // auto status si non fourni (hors archivé qui est géré via action)
    if (patch.status !== undefined) {
      const s = patch.status;
      const ok = ["planned","active","done","archived"].includes(s);
      if (!ok) return NextResponse.json({ error: "status invalide" }, { status: 400 });
      fields.push("status=?"); paramsSQL.push(s);
    } else {
      const autoStatus = computeAutoStatus(startDate!, endDate!);
      fields.push("status=?"); paramsSQL.push(autoStatus);
    }

    // auto priorité si colonne existe et non fournie
    if (hasPriority && patch.priority === undefined) {
      const autoPrio = computePriority(endDate!);
      fields.push("priority=?"); paramsSQL.push(autoPrio);
    }

    if (fields.length) {
      fields.push("updated_at=NOW()");
      const sql = `UPDATE projects SET ${fields.join(", ")} WHERE id=?`;
      await pool.query<ResultSetHeader>(sql, [...paramsSQL, id]);
    }

    // assigneeIds : remplace l’ensemble si fourni
    if (Array.isArray(patch.assigneeIds)) {
      await pool.query<ResultSetHeader>(`DELETE FROM project_assignees WHERE project_id=?`, [id]);
      const cleanIds: number[] = patch.assigneeIds
        .map((u: number | string) => Number(u))
        .filter((u: number): u is number => Number.isInteger(u));
      if (cleanIds.length) {
        const values: [number, number][] = cleanIds.map((uid: number) => [id, uid]);
        await pool.query<ResultSetHeader>(
          `INSERT IGNORE INTO project_assignees (project_id, user_id) VALUES ${values.map(()=>"(?,?)").join(",")}`,
          values.flat()
        );
      }
    }

    const item = await hydrate(id);
    return NextResponse.json({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ---------- DELETE (optionnel) ---------- */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const id = Number(projectId);
    await pool.query<ResultSetHeader>(`DELETE FROM project_assignees WHERE project_id=?`, [id]);
    await pool.query<ResultSetHeader>(`DELETE FROM project_notes WHERE project_id=?`, [id]);
    await pool.query<ResultSetHeader>(`DELETE FROM project_team_roles WHERE project_id=?`, [id]);
    await pool.query<ResultSetHeader>(`DELETE FROM projects WHERE id=?`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
