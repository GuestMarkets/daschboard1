export const runtime = "nodejs";

import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../lib/db"; // ← 5 niveaux
import { ok, err, getMe } from "../_utils";

/* Types utilitaires */
type Priority = "low" | "medium" | "high";
type AutoStatus = "planned" | "active" | "done";

interface PostBody {
  name: string;
  code: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  managerId?: number | null;
  assigneeIds?: Array<number | string>;
  priority?: Priority;
}

/* Utils */
function isValidISO(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}
function daysUntil(dateISO: string) {
  const now = new Date();
  const ed = new Date(`${dateISO}T00:00:00`);
  return Math.ceil((ed.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
function computePriority(endDate: string): Priority {
  const d = daysUntil(endDate);
  if (d <= 0) return "high";
  if (d <= 3) return "high";
  if (d <= 10) return "medium";
  return "low";
}
function computeAutoStatus(startDate: string, endDate: string): AutoStatus {
  const now = new Date();
  const sd = new Date(`${startDate}T00:00:00`);
  const ed = new Date(`${endDate}T00:00:00`);
  if (now < sd) return "planned";
  if (now > ed) return "done";
  return "active";
}

/** Parse robuste d’un identifiant numérique (depuis number|string|unknown) */
function toIntOrNaN(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : NaN;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
  }
  return NaN;
}

export async function POST(req: Request) {
  try {
    const me = await getMe();
    const raw = await req.json().catch(() => ({}));
    const body = (raw ?? {}) as Partial<PostBody>;

    const {
      name,
      code,
      description,
      startDate,
      endDate,
      managerId,
      assigneeIds,
      priority,
    } = body;

    if (!name || !code || !startDate || !endDate)
      return err("Champs requis manquants", 400);
    if (!isValidISO(startDate) || !isValidISO(endDate))
      return err("Dates invalides (YYYY-MM-DD attendu)", 400);
    if (
      new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`)
    )
      return err("La date de fin doit être ≥ à la date de début", 400);

    // Limite aux utilisateurs du même département + ajouter le créateur
    let allowedIds: number[] = [];
    if (me.department_id != null) {
      const [deptUsers] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM users WHERE department_id = ?`,
        [me.department_id]
      );
      const deptSet = new Set<number>(
        (deptUsers as Array<RowDataPacket>).map((r) => Number(r.id))
      );

      const inputIds: number[] = Array.isArray(assigneeIds)
        ? assigneeIds
            .map((n): number => toIntOrNaN(n)) // ← plus de any ici
            .filter((n) => Number.isInteger(n))
        : [];

      allowedIds = inputIds.filter((id) => deptSet.has(id));
    }
    if (!allowedIds.includes(me.id)) allowedIds.unshift(me.id);

    const computedPriority: Priority =
      priority === "low" || priority === "medium" || priority === "high"
        ? priority
        : computePriority(endDate);

    const computedStatus = computeAutoStatus(startDate, endDate);

    const [ins] = await pool.execute<ResultSetHeader>(
      `INSERT INTO projects (name, code, description, start_date, end_date, status, progress, created_at, updated_at, manager_id, priority)
       VALUES (?, ?, ?, ?, ?, ?, 0, NOW(), NOW(), ?, ?)`,
      [
        String(name).trim(),
        String(code).trim(),
        description ?? null,
        startDate,
        endDate,
        computedStatus,
        Number.isInteger(managerId as number) ? Number(managerId) : null,
        computedPriority,
      ]
    );
    const projectId = ins.insertId;

    if (allowedIds.length) {
      const values = allowedIds.map(
        (uid) => [projectId, uid] as [number, number]
      );
      await pool.execute<ResultSetHeader>(
        `INSERT IGNORE INTO project_assignees (project_id, user_id) VALUES ${values
          .map(() => "(?,?)")
          .join(",")}`,
        values.flat()
      );
    }

    // hydratation
    const [projRows] = await pool.execute<RowDataPacket[]>(
      `SELECT p.id, p.name, p.code, p.description, p.start_date, p.end_date, p.status, p.progress,
              p.created_at, p.updated_at, p.manager_id, u.name AS manager_name, p.priority
         FROM projects p
    LEFT JOIN users u ON u.id = p.manager_id
        WHERE p.id = ?`,
      [projectId]
    );
    const proj = (projRows as Array<RowDataPacket>)[0];

    const [a] = await pool.execute<RowDataPacket[]>(
      `SELECT pa.project_id, u.id AS user_id, u.name AS user_name
         FROM project_assignees pa JOIN users u ON u.id = pa.user_id
        WHERE pa.project_id = ?`,
      [projectId]
    );
    const assignees = (a as Array<RowDataPacket>).map((r) => ({
      id: Number(r.user_id),
      name: String(r.user_name),
    }));
    const assigneeIdsOut = (a as Array<RowDataPacket>).map((r) =>
      Number(r.user_id)
    );

    const item = {
      id: Number(proj.id),
      name: String(proj.name),
      code: String(proj.code),
      description: (proj.description as string | null) ?? null,
      startDate: String(proj.start_date),
      endDate: String(proj.end_date),
      status: String(proj.status),
      progress: Number(proj.progress ?? 0),
      createdAt: String(proj.created_at),
      updatedAt: String(proj.updated_at),
      managerId: proj.manager_id != null ? Number(proj.manager_id) : null,
      manager: proj.manager_id
        ? { id: Number(proj.manager_id), name: String(proj.manager_name ?? "") }
        : null,
      priority: (proj.priority ?? null) as Priority | null,
      assignees,
      assigneeIds: assigneeIdsOut,
    };

    return ok({ item });
  } catch (e) {
    // ← plus de any ici
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}
