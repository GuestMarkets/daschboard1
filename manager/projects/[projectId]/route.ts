// app/api/manager/projects/[projectId]/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../../../lib/db";
import { requireManager } from "../../../../../../lib/manager";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";

/** --- SQL row types --- */
interface CheckRow extends RowDataPacket {
  "1": 1; // SELECT 1
}

interface ProjectRow extends RowDataPacket {
  id: number;
  name: string;
  code: string;
  status: string;
  start_date: string | null; // ou Date si dateStrings:false
  end_date: string | null;
  progress: number | null;
  updated_at: string; // ou Date selon la config mysql2
}

interface DepartmentMemberRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  is_manager: 0 | 1;
  role: string | null;
}

interface TeamRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
}

interface TeamMemberRow extends RowDataPacket {
  team_id: number;
  user_id: number;
  name: string;
  email: string;
  role_in_team: string | null;
}

/** --- API response helper types --- */
type TeamMember = {
  user_id: number;
  name: string;
  email: string;
  role_in_team: string | null;
};

type TeamWithMembers = TeamRow & { members: TeamMember[] };

/**
 * NOTE IMPORTANT (fix de typing Next):
 * Le second argument doit être { params: Promise<{ projectId: string }> }.
 * On récupère donc les params avec: const { projectId } = await context.params
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const pool = getPool();

  try {
    const { userId, departmentId } = await requireManager();

    const { projectId: projectIdParam } = await context.params;
    const projectId = Number(projectIdParam ?? 0);
    if (!projectId) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    // 1) Vérifier l’affectation du manager à ce projet
    const [chk] = await pool.query<CheckRow[]>(
      `SELECT 1 FROM project_assignments WHERE project_id = :pid AND user_id = :uid LIMIT 1`,
      { pid: projectId, uid: userId }
    );
    if (chk.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 2) Charger les infos projet
    const [pRows] = await pool.query<ProjectRow[]>(
      `
      SELECT
        p.id,
        p.name,
        p.code,
        p.status,
        p.start_date,
        p.end_date,
        p.progress,
        p.updated_at
      FROM projects p
      WHERE p.id = :pid
      LIMIT 1
      `,
      { pid: projectId }
    );
    const project = pRows[0];
    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // 3) Membres du même département AFFECTÉS à ce projet
    const [members] = await pool.query<DepartmentMemberRow[]>(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.is_manager,
        u.role
      FROM project_assignments pa
      INNER JOIN users u ON u.id = pa.user_id
      WHERE pa.project_id = :pid
        AND u.department_id = :dep
        AND u.status = 'active'
      ORDER BY u.name ASC
      `,
      { pid: projectId, dep: departmentId }
    );

    // 4) Équipes de ce projet CRÉÉES par CE manager (et leurs membres)
    const [teams] = await pool.query<TeamRow[]>(
      `
      SELECT
        t.id,
        t.name,
        t.description,
        t.created_at,
        t.updated_at,
        COUNT(tm.user_id) AS member_count
      FROM teams t
      INNER JOIN project_team_roles ptr
        ON ptr.team_id = t.id AND ptr.project_id = :pid
      LEFT JOIN team_members tm
        ON tm.team_id = t.id
      WHERE t.is_deleted = 0 AND t.created_by = :uid
      GROUP BY t.id
      ORDER BY t.updated_at DESC, t.id DESC
      `,
      { pid: projectId, uid: userId }
    );

    const teamIds = teams.map((t) => Number(t.id));
    let teamMembers: TeamMemberRow[] = [];

    if (teamIds.length > 0) {
      const placeholders = teamIds.map(() => "?").join(",");
      const [rows] = await pool.query<TeamMemberRow[]>(
        `
        SELECT
          tm.team_id,
          u.id as user_id,
          u.name,
          u.email,
          tm.role_in_team
        FROM team_members tm
        INNER JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id IN (${placeholders})
        ORDER BY u.name ASC
        `,
        teamIds
      );
      teamMembers = rows;
    }

    const membersByTeam = new Map<number, TeamMember[]>();
    for (const m of teamMembers) {
      const tid = Number(m.team_id);
      if (!membersByTeam.has(tid)) membersByTeam.set(tid, []);
      membersByTeam.get(tid)!.push({
        user_id: m.user_id,
        name: m.name,
        email: m.email,
        role_in_team: m.role_in_team,
      });
    }

    const teamsWithMembers: TeamWithMembers[] = teams.map((t) => ({
      ...t,
      members: membersByTeam.get(Number(t.id)) ?? [],
    }));

    return NextResponse.json(
      { project, department_members: members, teams: teamsWithMembers },
      { status: 200 }
    );
  } catch (e: unknown) {
    const message =
      typeof e === "object" && e !== null && "message" in e
        ? String((e as { message?: unknown }).message)
        : null;

    const msg =
      message === "Forbidden"
        ? "Forbidden"
        : message === "Unauthorized"
        ? "Unauthorized"
        : "Server error";

    const status =
      msg === "Server error" ? 500 : msg === "Unauthorized" ? 401 : 403;

    return NextResponse.json({ error: msg }, { status });
  }
}
