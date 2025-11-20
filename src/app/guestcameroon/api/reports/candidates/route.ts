export const runtime = "nodejs";

import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { ok, err, toId, getMe } from "../../_utils";

// Typage minimal des lignes retournées par les SELECT ciblés
type CandidateRow = RowDataPacket & {
  id: number;
  name: string;
  tag: string;
};

// GET /reports/candidates?projectId=&departmentId=
export async function GET(req: Request) {
  try {
    const me = await getMe();

    const url = new URL(req.url);
    const projectId = toId(url.searchParams.get("projectId"));
    const departmentId = toId(url.searchParams.get("departmentId"));

    // 1) SuperAdmins / Admins
    const [superRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, 'Super Admin' AS tag
         FROM users
        WHERE is_admin = 1 OR LOWER(role) = 'superadmin'`
    );
    const superAdmins = superRows as CandidateRow[];

    // 2) Manager du projet (si fourni)
    let projectManager: CandidateRow[] = [];
    if (projectId) {
      const [r] = await pool.execute<RowDataPacket[]>(
        `SELECT u.id, u.name, 'Manager Projet' AS tag
           FROM projects p
      LEFT JOIN users u ON u.id = p.manager_id
          WHERE p.id = ? AND p.manager_id IS NOT NULL
          LIMIT 1`,
        [projectId]
      );
      projectManager = r as CandidateRow[];
    }

    // 3) Manager du département (si fourni)
    let departmentManager: CandidateRow[] = [];
    if (departmentId) {
      const [r] = await pool.execute<RowDataPacket[]>(
        `SELECT u.id, u.name, 'Manager Département' AS tag
           FROM departments d
      LEFT JOIN users u ON u.id = d.manager_id
          WHERE d.id = ? AND d.manager_id IS NOT NULL
          LIMIT 1`,
        [departmentId]
      );
      departmentManager = r as CandidateRow[];
    }

    // Unicité + exclusion de soi-même
    const map = new Map<number, { id: number; name: string; tag: string }>();
    [...superAdmins, ...projectManager, ...departmentManager].forEach((x: CandidateRow) => {
      const id = Number(x.id);
      if (id && id !== me.id) {
        map.set(id, { id, name: String(x.name), tag: String(x.tag) });
      }
    });

    return ok({ candidates: Array.from(map.values()) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}
