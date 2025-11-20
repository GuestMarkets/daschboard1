// app/guestmarkets/api/planning/teams/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

interface TeamRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  department_id: number | null;
  leader_user_id: number | null;
  is_deleted: number | null;
}

interface ProjectRow extends RowDataPacket {
  id: number;
  department_id: number | null;
  manager_id: number | null;
  is_deleted: number | null;
}

type AuthUser = {
  id: number;
  is_admin?: boolean;
};

export async function GET(req: Request) {
  try {
    const { user } = (await requireUser()) as { user: AuthUser };
    const url = new URL(req.url);
    const projectIdParam = url.searchParams.get("projectId");
    const projectId = projectIdParam ? Number(projectIdParam) : null;

    let extraDeptId: number | null = null;

    // Si projectId est fourni, on récupère son département (et on vérifie un minimum les droits)
    if (projectId && Number.isFinite(projectId)) {
      const [pRows] = await pool.query<ProjectRow[]>(
        `SELECT id, department_id, manager_id, is_deleted
           FROM projects
          WHERE id = ?
            AND (is_deleted IS NULL OR is_deleted = 0)
          LIMIT 1`,
        [projectId]
      );
      if (pRows.length) {
        const proj = pRows[0];
        // On autorise si admin ou manager du projet
        if (user.is_admin || proj.manager_id === user.id) {
          extraDeptId = proj.department_id != null ? Number(proj.department_id) : null;
        }
      }
    }

    let rows: TeamRow[];

    // Super admin : peut voir toutes les équipes (optionnellement filtrées par département du projet)
    if (user.is_admin) {
      const params: unknown[] = [];
      let where = `WHERE (t.is_deleted IS NULL OR t.is_deleted = 0)`;

      if (extraDeptId != null) {
        where += ` AND t.department_id = ?`;
        params.push(extraDeptId);
      }

      const [r] = await pool.query<TeamRow[]>(
        `SELECT t.id, t.name, t.description, t.department_id, t.leader_user_id, t.is_deleted
           FROM teams t
          ${where}
          ORDER BY t.name ASC`,
        params
      );
      rows = r;
    } else {
      // Utilisateur normal : uniquement les équipes dont il est leader
      const params: unknown[] = [user.id];
      let where = `WHERE (t.is_deleted IS NULL OR t.is_deleted = 0)
                     AND t.leader_user_id = ?`;

      if (extraDeptId != null) {
        where += ` AND t.department_id = ?`;
        params.push(extraDeptId);
      }

      const [r] = await pool.query<TeamRow[]>(
        `SELECT t.id, t.name, t.description, t.department_id, t.leader_user_id, t.is_deleted
           FROM teams t
          ${where}
          ORDER BY t.name ASC`,
        params
      );
      rows = r;
    }

    return NextResponse.json({
      items: rows.map((t) => ({
        id: Number(t.id),
        name: String(t.name),
        description: t.description ? String(t.description) : null,
        department_id: t.department_id != null ? Number(t.department_id) : null,
        leader_user_id: t.leader_user_id != null ? Number(t.leader_user_id) : null,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
