// app/guestmarkets/api/planning/people/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

/** Types utilitaires */
type IdRow = RowDataPacket & { id: number };
type CountRow = RowDataPacket & { c: number };
type UserRow = RowDataPacket & {
  id: number;
  name: string;
  email: string;
  department_id: number | null;
};

type Scope = "ALL" | "LEAD_SCOPE" | "LEAD_SCOPE_EMPTY";

type AuthUser = {
  id: number;
  is_admin?: boolean;
};

type RequireUserResult = { user: AuthUser };

/** Vérifie si une table existe dans la base courante */
async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS c
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName]
  );
  const count = rows[0]?.c ?? 0;
  return Number(count) > 0;
}

export async function GET(req: Request) {
  try {
    const { user } = (await requireUser()) as RequireUserResult;
    const url = new URL(req.url);
    const projectIdParam = url.searchParams.get("projectId");
    const teamIdParam = url.searchParams.get("teamId");

    const projectId = projectIdParam ? Number(projectIdParam) : null;
    const teamId = teamIdParam ? Number(teamIdParam) : null;

    // === Cas superAdmin : full scope (on ignore les filtres projet/équipe) ===
    if (user.is_admin) {
      const [rows] = await pool.query<UserRow[]>(
        `SELECT id,
                COALESCE(name,'')  AS name,
                COALESCE(email,'') AS email,
                department_id
           FROM users
          WHERE (status IS NULL OR status='' OR status='active')`
      );

      return NextResponse.json({
        items: rows.map((r) => ({
          id: Number(r.id),
          name: String(r.name),
          email: String(r.email),
          department_id: r.department_id != null ? Number(r.department_id) : null,
        })),
        canInviteSuperAdmin: true,
        scope: "ALL" as Scope,
      });
    }

    const uid = user.id;

    // === Détection des tables optionnelles ===
    const hasDepartments      = await tableExists("departments");
    const hasTeams            = await tableExists("teams");
    const hasTeamMembers      = await tableExists("team_members");
    const hasProjects         = await tableExists("projects");
    const hasProjectAssignees = await tableExists("project_assignees");

    // === IDs de périmètre (départements / équipes / projets) ===

    // 1) Départements dont il est manager
    let managedDepartmentIds: number[] = [];
    if (hasDepartments) {
      const [depRows] = await pool.query<IdRow[]>(
        `SELECT id FROM departments WHERE manager_id = ?`,
        [uid]
      );
      managedDepartmentIds = depRows.map((r) => Number(r.id));
    }

    // 2) Équipes dont il est leader
    let leadTeamIds: number[] = [];
    if (hasTeams) {
      const [teamRows] = await pool.query<IdRow[]>(
        `SELECT id FROM teams WHERE leader_user_id = ?`,
        [uid]
      );
      leadTeamIds = teamRows.map((r) => Number(r.id));
    }

    // 3) Projets qu'il manage
    let managedProjectIds: number[] = [];
    if (hasProjects) {
      const [projRows] = await pool.query<IdRow[]>(
        `SELECT id FROM projects WHERE manager_id = ?`,
        [uid]
      );
      managedProjectIds = projRows.map((r) => Number(r.id));
    }

    // === Résolution des IDs utilisateurs par périmètre brut ===

    // A) Users par département
    let depUserIds: number[] = [];
    if (managedDepartmentIds.length) {
      const placeholders = managedDepartmentIds.map(() => "?").join(",");
      const [uDep] = await pool.query<IdRow[]>(
        `SELECT id
           FROM users
          WHERE department_id IN (${placeholders})
            AND (status IS NULL OR status='' OR status='active')`,
        managedDepartmentIds
      );
      depUserIds = uDep.map((r) => Number(r.id));
    }

    // B) Users par équipes (via team_members)
    let teamUserIds: number[] = [];
    if (leadTeamIds.length && hasTeamMembers) {
      const placeholders = leadTeamIds.map(() => "?").join(",");
      const [uTeam] = await pool.query<IdRow[]>(
        `SELECT DISTINCT tm.user_id AS id
           FROM team_members tm
          WHERE tm.team_id IN (${placeholders})`,
        leadTeamIds
      );
      teamUserIds = uTeam.map((r) => Number(r.id));
    }

    // C) Users par projets (via project_assignees)
    let projectUserIds: number[] = [];
    if (managedProjectIds.length && hasProjectAssignees) {
      const placeholders = managedProjectIds.map(() => "?").join(",");
      const [uProj] = await pool.query<IdRow[]>(
        `SELECT DISTINCT pa.user_id AS id
           FROM project_assignees pa
          WHERE pa.project_id IN (${placeholders})`,
        managedProjectIds
      );
      projectUserIds = uProj.map((r) => Number(r.id));
    }

    // === Union brute + exclusion de soi-même ===
    let unionIds = Array.from(
      new Set([...depUserIds, ...teamUserIds, ...projectUserIds])
    ).filter((id) => id && id !== uid);

    // Si aucune personne dans son scope brut
    if (unionIds.length === 0) {
      return NextResponse.json({
        items: [],
        canInviteSuperAdmin: false,
        scope: "LEAD_SCOPE_EMPTY" as Scope,
      });
    }

    // === Affinage par projet ou équipe (filtre optionnel) ===

    // Filtre par projet : on se base sur project_assignees, restreint à unionIds
    if (projectId && hasProjectAssignees) {
      const placeholders = unionIds.map(() => "?").join(",");
      const params: Array<number> = [projectId, ...unionIds];

      const [projRows] = await pool.query<IdRow[]>(
        `SELECT DISTINCT pa.user_id AS id
           FROM project_assignees pa
          WHERE pa.project_id = ?
            AND pa.user_id IN (${placeholders})`,
        params
      );
      const projIds = projRows.map((r) => Number(r.id));
      unionIds = unionIds.filter((id) => projIds.includes(id));
    }

    // Filtre par équipe : on se base sur team_members, restreint à unionIds
    if (teamId && hasTeamMembers) {
      const placeholders = unionIds.map(() => "?").join(",");
      const params: Array<number> = [teamId, ...unionIds];

      const [teamRows] = await pool.query<IdRow[]>(
        `SELECT DISTINCT tm.user_id AS id
           FROM team_members tm
          WHERE tm.team_id = ?
            AND tm.user_id IN (${placeholders})`,
        params
      );
      const tIds = teamRows.map((r) => Number(r.id));
      unionIds = unionIds.filter((id) => tIds.includes(id));
    }

    // Après filtrage, plus personne
    if (!unionIds.length) {
      return NextResponse.json({
        items: [],
        canInviteSuperAdmin: false,
        scope: "LEAD_SCOPE" as Scope,
      });
    }

    // === Chargement des fiches utilisateurs ===
    const placeholders = unionIds.map(() => "?").join(",");
    const [rows] = await pool.query<UserRow[]>(
      `SELECT id,
              COALESCE(name,'')  AS name,
              COALESCE(email,'') AS email,
              department_id
         FROM users
        WHERE id IN (${placeholders})
          AND (status IS NULL OR status='' OR status='active')`,
      unionIds
    );

    return NextResponse.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        email: String(r.email),
        department_id: r.department_id != null ? Number(r.department_id) : null,
      })),
      canInviteSuperAdmin: false,
      scope: "LEAD_SCOPE" as Scope,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
