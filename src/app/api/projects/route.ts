// /api/projects/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/* ---------------- Utils ---------------- */
function isValidISO(d: string) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }
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
function computeAutoStatus(startDate: string, endDate: string): "planned"|"active"|"done" {
  const now = new Date();
  const sd = new Date(`${startDate}T00:00:00`);
  const ed = new Date(`${endDate}T00:00:00`);
  if (now < sd) return "planned";
  if (now > ed) return "done";
  return "active";
}

/* ---------------- Types ---------------- */
type Priority = "low" | "medium" | "high";
type Status = "planned" | "active" | "done" | "archived";

type ProjectRowBase = RowDataPacket & {
  id: number; name: string; code: string; description: string | null;
  start_date: string; end_date: string; status: Status;
  progress: number; created_at: string; updated_at: string;
};

/** Requête SELECT (GET/POST retour) : on garantit toujours ces 3 colonnes, quitte à renvoyer NULL via SQL */
type ProjectSelectRow = ProjectRowBase & {
  manager_id: number | null;
  priority: Priority | null;
  manager_name: string | null;
};

type AssigneeRow = RowDataPacket & { project_id: number; user_id: number; user_name: string };

type ProjectHydrated = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  startDate: string;
  endDate: string;
  status: Status;
  progress: number;
  createdAt: string;
  updatedAt: string;
  managerId: number | null;
  manager: { id: number; name: string } | null;
  priority: Priority | null;
  assignees: { id: number; name: string }[];
  assigneeIds: number[];
};

type PostBody = {
  name: string;
  code: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  managerId?: number | null;
  assigneeIds?: unknown[];
  priority?: Priority | null;
};

type DBValue = string | number | Date | null;

async function getProjectsSchemaFlags() {
  const [cols] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
  );
  const names = new Set(cols.map(c => c.COLUMN_NAME as string));
  return {
    hasManager: names.has("manager_id"),
    hasPriority: names.has("priority"),
  };
}

/** remonte assignees + manager + assigneeIds, en camelCase */
async function hydrateProjects(rows: ProjectSelectRow[]): Promise<ProjectHydrated[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  let assignees: AssigneeRow[] = [];
  if (ids.length) {
    const [a] = await pool.query<AssigneeRow[]>(
      `SELECT pa.project_id, u.id AS user_id, u.name AS user_name
         FROM project_assignees pa
         JOIN users u ON u.id = pa.user_id
        WHERE pa.project_id IN (${ids.map(()=>"?").join(",")})`,
      ids
    );
    assignees = a;
  }
  const mapAssignees = new Map<number, {id:number; name:string}[]>();
  const mapAssigneeIds = new Map<number, number[]>();
  for (const a of assignees) {
    if (!mapAssignees.has(a.project_id)) mapAssignees.set(a.project_id, []);
    if (!mapAssigneeIds.has(a.project_id)) mapAssigneeIds.set(a.project_id, []);
    mapAssignees.get(a.project_id)!.push({ id: a.user_id, name: a.user_name });
    mapAssigneeIds.get(a.project_id)!.push(a.user_id);
  }
  return rows.map(r => ({
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
    assignees: mapAssignees.get(r.id) ?? [],
    assigneeIds: mapAssigneeIds.get(r.id) ?? [],
  }));
}

/* ---------------- GET ---------------- */
export async function GET() {
  try {
    const { hasManager, hasPriority } = await getProjectsSchemaFlags();

    const select =
      `SELECT p.id, p.name, p.code, p.description, p.start_date, p.end_date, p.status, p.progress,
              p.created_at, p.updated_at,
              ${hasManager ? "p.manager_id" : "NULL AS manager_id"},
              ${hasPriority ? "p.priority" : "NULL AS priority"},
              ${hasManager ? "u.name AS manager_name" : "NULL AS manager_name"}
         FROM projects p
         ${hasManager ? "LEFT JOIN users u ON u.id = p.manager_id" : ""}
        ORDER BY p.created_at DESC`;

    const [rows] = await pool.query<ProjectSelectRow[]>(select);
    const items = await hydrateProjects(rows);
    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ---------------- POST ---------------- */
export async function POST(req: Request) {
  try {
    const ck = await cookies();
    const headerToken = req.headers.get("authorization");
    const token = ck.get(SESSION_COOKIE_NAME)?.value
      || (headerToken?.toLowerCase().startsWith("bearer ") ? headerToken.slice(7).trim() : null);

    const payload = token ? await verifyJwt(token) : null;
    if (!payload) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const raw = (await req.json()) as unknown;
    const body = raw as Partial<PostBody>;
    const {
      name, code, description,
      startDate, endDate,
      managerId, assigneeIds, priority
    } = body || {};

    if (!name || !code || !startDate || !endDate)
      return NextResponse.json({ error:"Champs requis manquants" }, { status:400 });
    if (!isValidISO(startDate) || !isValidISO(endDate))
      return NextResponse.json({ error:"Dates invalides" }, { status:400 });
    if (new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`))
      return NextResponse.json({ error:"La date de fin doit être ≥ à la date de début" }, { status:400 });

    const { hasManager, hasPriority } = await getProjectsSchemaFlags();
    const computedPriority: Priority =
      (priority === "low" || priority === "medium" || priority === "high")
        ? priority
        : computePriority(endDate);
    const computedStatus = computeAutoStatus(startDate, endDate);

    // build INSERT dynamiquement
    const cols: string[] = ["name","code","description","start_date","end_date","status","progress","created_at","updated_at"];
    const vals: DBValue[] = [
      String(name).trim(),
      String(code).trim(),
      description ?? null,
      startDate,
      endDate,
      computedStatus,
      0,
      new Date(),
      new Date()
    ];

    if (hasManager) {
      cols.splice(6, 0, "manager_id");
      vals.splice(6, 0, Number.isInteger(managerId) ? (managerId as number) : null);
    }
    if (hasPriority) {
      const idx = hasManager ? 7 : 6;
      cols.splice(idx, 0, "priority");
      vals.splice(idx, 0, computedPriority);
    }

    const sql = `INSERT INTO projects (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")})`;
    const [res] = await pool.query<ResultSetHeader>(sql, vals);
    const projectId = res.insertId;

    // assignees
    if (Array.isArray(assigneeIds) && assigneeIds.length) {
      const cleanIds: number[] = assigneeIds
        .map((u: unknown) => Number(u))
        .filter((u: number): u is number => Number.isInteger(u));
      if (cleanIds.length) {
        const values: [number, number][] = cleanIds.map((uid: number) => [projectId, uid]);
        await pool.query<ResultSetHeader>(
          `INSERT IGNORE INTO project_assignees (project_id, user_id) VALUES ${values.map(()=>"(?,?)").join(",")}`,
          values.flat()
        );
      }
    }

    // retour hydraté
    const select =
      `SELECT p.id, p.name, p.code, p.description, p.start_date, p.end_date, p.status, p.progress,
              p.created_at, p.updated_at,
              ${hasManager ? "p.manager_id" : "NULL AS manager_id"},
              ${hasPriority ? "p.priority" : "NULL AS priority"},
              ${hasManager ? "u.name AS manager_name" : "NULL AS manager_name"}
         FROM projects p
         ${hasManager ? "LEFT JOIN users u ON u.id = p.manager_id" : ""}
        WHERE p.id = ?`;

    const [rows] = await pool.query<ProjectSelectRow[]>(select, [projectId]);
    const [item] = await hydrateProjects(rows);
    return NextResponse.json({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
