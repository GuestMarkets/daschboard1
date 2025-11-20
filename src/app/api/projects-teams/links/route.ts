// app/api/projects-teams/links/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import type { RowDataPacket } from "mysql2";

// Typage fort d'une ligne retournée par la requête
interface ProjectTeamLink extends RowDataPacket {
  project_id: number;
  project_code: string;
  project_name: string;
  team_id: number;
  team_name: string;
  team_role: string;
  member_count: number;
}

export async function GET() {
  try {
    const sql = `
      SELECT
        p.id AS project_id,
        p.code AS project_code,
        p.name AS project_name,
        t.id AS team_id,
        t.name AS team_name,
        ptr.team_role,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count
      FROM project_team_roles ptr
      JOIN projects p ON p.id = ptr.project_id
      JOIN teams t ON t.id = ptr.team_id
      ORDER BY p.id DESC, t.name ASC
    `;

    // rows sera correctement typé en ProjectTeamLink[]
    const [rows] = await pool.query<ProjectTeamLink[]>(sql);

    return NextResponse.json({ items: rows });
  } catch (err: unknown) {
    // Pas de "any" ici : on gère prudemment l'erreur
    const message =
      err instanceof Error ? err.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
