// app/api/projects/[projectId]/teams/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

type TeamRole = "owner" | "contributor" | "support";

interface PostBody {
  teamId: number | string;
  teamRole?: TeamRole;
}

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// GET /api/projects/[projectId]/teams
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const pid = Number(projectId);
    if (!Number.isFinite(pid)) {
      return NextResponse.json({ error: "projectId invalide" }, { status: 400 });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         ptr.project_id,
         t.id AS team_id,
         t.name AS team_name,
         ptr.team_role,
         (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count
       FROM project_team_roles ptr
       JOIN teams t ON t.id = ptr.team_id
       WHERE ptr.project_id = ?`,
      [pid]
    );

    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e) ?? "Erreur" },
      { status: 500 }
    );
  }
}

// POST /api/projects/[projectId]/teams
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const pid = Number(projectId);
    if (!Number.isFinite(pid)) {
      return NextResponse.json({ error: "projectId invalide" }, { status: 400 });
    }

    // Auth: Bearer prioritaire, puis cookie
    const headerAuth = req.headers.get("authorization") ?? "";
    const bearer = headerAuth.toLowerCase().startsWith("bearer ")
      ? headerAuth.slice(7).trim()
      : null;

    const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    const token = bearer ?? cookieToken;

    const payload = token ? await verifyJwt(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = (await req.json()) as PostBody;

    const teamIdNum = Number(body.teamId);
    if (!Number.isFinite(teamIdNum)) {
      return NextResponse.json({ error: "teamId invalide" }, { status: 400 });
    }

    const allowedRoles: TeamRole[] = ["owner", "contributor", "support"];
    const incomingRole = body.teamRole;
    const role: TeamRole =
      incomingRole && allowedRoles.includes(incomingRole)
        ? incomingRole
        : "contributor";

    await pool.query<ResultSetHeader>(
      "INSERT IGNORE INTO project_team_roles (project_id, team_id, team_role) VALUES (?, ?, ?)",
      [pid, teamIdNum, role]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e) ?? "Erreur" },
      { status: 500 }
    );
  }
}
