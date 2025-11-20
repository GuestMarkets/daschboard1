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
  name: string;          // COALESCE(name,'') AS name -> string garanti
  email: string;         // COALESCE(email,'') AS email -> string garanti
  department_id: number | null;
};

type Scope = "ALL" | "LEAD_SCOPE" | "LEAD_SCOPE_EMPTY";

/** On type minimalement l’objet utilisateur retourné par requireUser() */
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
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  const count = rows[0]?.c ?? 0;
  return Number(count) > 0;
}

/**
 * Règles de périmètre:
 * - superAdmin : tous les users "actifs".
 * - sinon : union des IDs
 *    • Users des départements dont il est manager (users.department_id IN (…))
 *    • Users des équipes qu'il lead (via team_members)
 *    • Users des projets qu'il manage (via project_assignees)
 *
 * NB: on ignore proprement les tables manquantes -> jamais de 500 ici.
 */
export async function GET() {
  try {
    const { user } = (await requireUser()) as RequireUserResult;

    // === Cas superAdmin : full scope ===
    if (user.is_admin) {
      const [rows] = await pool.query<UserRow[]>(
        `SELECT id, COALESCE(name,'') AS name, COALESCE(email,'') AS email, department_id
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

    // === Détecter la présence des tables optionnelles ===
    const hasDepartments      = await tableExists("departments");
    const hasTeams            = await tableExists("teams");
    const hasTeamMembers      = await tableExists("team_members");
    const hasProjects         = await tableExists("projects");
    const hasProjectAssignees = await tableExists("project_assignees");

    // === IDs de périmètre ===

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

    // === Résolution des USERS par source ===

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

    // B) Users par équipes (si la table team_members existe)
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

    // === Union + exclusion de soi-même ===
    const unionIds = Array.from(new Set([...depUserIds, ...teamUserIds, ...projectUserIds])).filter(
      (id) => id && id !== uid
    );

    if (unionIds.length === 0) {
      return NextResponse.json({
        items: [],
        canInviteSuperAdmin: false,
        scope: "LEAD_SCOPE_EMPTY" as Scope,
      });
    }

    // === Chargement des fiches utilisateurs ===
    const placeholders = unionIds.map(() => "?").join(",");
    const [rows] = await pool.query<UserRow[]>(
      `SELECT id, COALESCE(name,'') AS name, COALESCE(email,'') AS email, department_id
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
