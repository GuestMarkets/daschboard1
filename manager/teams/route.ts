// app/api/manager/teams/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { requireManager } from "../../../../../lib/manager";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

export const runtime = "nodejs";

/* ---------- Types SQL ---------- */
interface CheckRow extends RowDataPacket {
  ok: 1;
}

interface TeamRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  member_count: number;
}

type RoleInTeam = "lead" | "member";

interface MemberRow extends RowDataPacket {
  team_id: number;
  user_id: number;
  name: string;
  email: string;
  role_in_team: RoleInTeam;
}

interface TeamMemberOut {
  user_id: number;
  name: string;
  email: string;
  role_in_team: RoleInTeam;
}

interface TeamOut extends Omit<TeamRow, "member_count"> {
  member_count: number;
  members: TeamMemberOut[];
}

/** GET /api/manager/teams?project_id=123 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireManager();
    const pool = getPool();

    const { searchParams } = new URL(req.url);
    const projectId = Number(searchParams.get("project_id") || 0);
    if (!projectId) {
      return NextResponse.json({ error: "project_id requis" }, { status: 400 });
    }

    // Vérifier que le manager est affecté au projet
    const [check] = await pool.query<CheckRow[]>(
      `SELECT 1 as ok FROM project_assignments WHERE project_id = :pid AND user_id = :uid LIMIT 1`,
      { pid: projectId, uid: userId }
    );
    if (check.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Liste des équipes (créées par ce manager) liées à ce projet
    const [teamsRows] = await pool.query<TeamRow[]>(
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

    const teamIds = teamsRows.map((t) => Number(t.id));
    let membersRows: MemberRow[] = [];

    if (teamIds.length > 0) {
      const placeholders = teamIds.map(() => "?").join(",");
      const [rows] = await pool.query<MemberRow[]>(
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
      membersRows = rows;
    }

    const membersByTeam = new Map<number, TeamMemberOut[]>();
    for (const m of membersRows) {
      const tid = Number(m.team_id);
      const arr = membersByTeam.get(tid) ?? [];
      arr.push({
        user_id: Number(m.user_id),
        name: m.name,
        email: m.email,
        role_in_team: m.role_in_team,
      });
      membersByTeam.set(tid, arr);
    }

    const out: TeamOut[] = teamsRows.map((t) => ({
      id: Number(t.id),
      name: t.name,
      description: t.description,
      created_at: t.created_at,
      updated_at: t.updated_at,
      member_count: Number(t.member_count),
      members: membersByTeam.get(Number(t.id)) ?? [],
    }));

    return NextResponse.json({ teams: out }, { status: 200 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "";
    const msg =
      message === "Forbidden"
        ? "Forbidden"
        : message === "Unauthorized"
        ? "Unauthorized"
        : "Server error";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Server error" ? 500 : msg === "Unauthorized" ? 401 : 403 }
    );
  }
}

/** POST /api/manager/teams
 * Body:
 * {
 *   project_id: number,
 *   name: string,
 *   description?: string,
 *   members: Array<{ user_id: number, role_in_team?: 'lead'|'member' }>
 * }
 */
export async function POST(req: NextRequest) {
  const conn = await getPool().getConnection();
  try {
    const { userId, departmentId } = await requireManager();
    const body = (await req.json()) as {
      project_id?: number;
      name?: string;
      description?: string;
      members?: Array<{ user_id: number; role_in_team?: RoleInTeam }>;
    };

    const projectId = Number(body.project_id || 0);
    const name = String(body.name || "").trim();
    const description = (body.description ?? "").toString();
    const members = Array.isArray(body.members) ? body.members : [];

    if (!projectId)
      return NextResponse.json({ error: "project_id requis" }, { status: 400 });
    if (!name)
      return NextResponse.json({ error: "Nom d'équipe requis" }, { status: 400 });

    // 1) vérifier affectation du manager au projet
    const [check] = await conn.query<CheckRow[]>(
      `SELECT 1 as ok FROM project_assignments WHERE project_id = :pid AND user_id = :uid LIMIT 1`,
      { pid: projectId, uid: userId }
    );
    if (check.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 2) vérifier que tous les membres demandés appartiennent bien au même département + actifs
    const memberIds = members.map((m) => Number(m.user_id)).filter(Boolean);
    if (memberIds.length > 0) {
      const placeholders = memberIds.map(() => "?").join(",");
      const [valids] = await conn.query<RowDataPacket[]>(
        `
        SELECT u.id
        FROM users u
        WHERE u.id IN (${placeholders})
          AND u.department_id = ?
          AND u.status = 'active'
        `,
        [...memberIds, departmentId]
      );
      const okIds = new Set<number>(valids.map((r) => Number(r.id as number)));
      const invalid = memberIds.filter((id) => !okIds.has(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: "Certains membres ne sont pas autorisés (département/status)" },
          { status: 400 }
        );
      }
    }

    await conn.beginTransaction();

    // 3) créer l'équipe
    const [insTeam] = await conn.query<ResultSetHeader>(
      `INSERT INTO teams (name, description, created_by) VALUES (:n, :d, :uid)`,
      { n: name, d: description, uid: userId }
    );
    const teamId = Number(insTeam.insertId);

    // 4) lier l'équipe au projet (owner par défaut)
    await conn.query<ResultSetHeader>(
      `INSERT INTO project_team_roles (project_id, team_id, team_role)
       VALUES (:pid, :tid, 'owner')`,
      { pid: projectId, tid: teamId }
    );

    // 5) ajouter les membres (lead ou member)
    if (memberIds.length > 0) {
      const values = members.map((m) => [
        teamId,
        Number(m.user_id),
        m.role_in_team === "lead" ? "lead" : "member",
      ]) as Array<[number, number, RoleInTeam]>;

      const placeholders = values.map(() => "(?, ?, ?)").join(",");
      await conn.query<ResultSetHeader>(
        `INSERT INTO team_members (team_id, user_id, role_in_team) VALUES ${placeholders}`,
        values.flat()
      );
    }

    await conn.commit();

    return NextResponse.json(
      {
        success: true,
        team: {
          id: teamId,
          name,
          description,
          project_id: projectId,
          members: members.map((m) => ({
            user_id: Number(m.user_id),
            role_in_team: m.role_in_team === "lead" ? "lead" : "member",
          })),
        },
      },
      { status: 201 }
    );
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* noop */
    }
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "";
    const msg =
      message === "Forbidden"
        ? "Forbidden"
        : message === "Unauthorized"
        ? "Unauthorized"
        : "Server error";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Server error" ? 500 : msg === "Unauthorized" ? 401 : 403 }
    );
  } finally {
    conn.release();
  }
}
