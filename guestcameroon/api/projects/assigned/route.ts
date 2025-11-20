export const runtime = "nodejs";

import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db"; // ← 5 niveaux vers la racine
import { ok, err, getMe } from "../../_utils";

type ProjectRow = RowDataPacket & {
  id: number;
  name: string;
  code: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: "planned" | "active" | "done" | "archived";
  progress: number | null;
  updated_at: string;
  created_at: string;
  manager_id?: number | null;
  manager_name?: string | null;
  priority?: "low" | "medium" | "high" | null;
};

type AssigneeRow = RowDataPacket & {
  project_id: number;
  user_id: number;
  user_name: string;
};

type LightweightUser = { id: number; name: string };

export async function GET() {
  try {
    const me = await getMe();
    const userId = me.id;

    // Projets où je suis manager OU assigné
    const [rows] = await pool.execute<ProjectRow[]>(
      `SELECT p.id, p.name, p.code, p.description, p.start_date, p.end_date, p.status, p.progress,
              p.created_at, p.updated_at, p.manager_id, u.name AS manager_name, p.priority
         FROM projects p
    LEFT JOIN users u ON u.id = p.manager_id
        WHERE p.manager_id = ?
           OR EXISTS (SELECT 1 FROM project_assignees pa WHERE pa.project_id = p.id AND pa.user_id = ?)
        ORDER BY p.created_at DESC`,
      [userId, userId]
    );

    if (rows.length === 0) {
      return ok({ projects: [] });
    }

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");

    const [ass] = await pool.execute<AssigneeRow[]>(
      `SELECT pa.project_id, u.id AS user_id, u.name AS user_name
         FROM project_assignees pa
         JOIN users u ON u.id = pa.user_id
        WHERE pa.project_id IN (${placeholders})`,
      ids
    );

    const mapAssignees = new Map<number, LightweightUser[]>();
    const mapAssIds = new Map<number, number[]>();

    for (const a of ass) {
      if (!mapAssignees.has(a.project_id)) mapAssignees.set(a.project_id, []);
      if (!mapAssIds.has(a.project_id)) mapAssIds.set(a.project_id, []);
      mapAssignees.get(a.project_id)!.push({ id: a.user_id, name: a.user_name });
      mapAssIds.get(a.project_id)!.push(a.user_id);
    }

    const projects = rows.map((r) => ({
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
      assigneeIds: mapAssIds.get(r.id) ?? [],
    }));

    return ok({ projects });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    return err(message, 500);
  }
}
