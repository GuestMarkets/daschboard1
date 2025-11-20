// lib/rbac.ts
import type { RowDataPacket } from "mysql2";
import { pool } from "./db";

/* =========================
   Types (alignés avec lib/auth)
   ========================= */
export type Role = "user" | "manager" | "admin" | "superAdmin";
export type Company = "guestmarkets" | "guestcameroon";

/** Paramètre typé pour éviter `any` dans getRoleFromRow */
type RoleSource = {
  role?: string | null;
  is_manager?: 0 | 1 | boolean;
};

/** Type générique pour les paramètres SQL (mysql2 accepte ces primitives) */
type SqlParam = string | number | boolean | Date | null;

/** Retour typé pour meetingsVisibilityWhere */
type VisibilityWhere = {
  whereSQL: string;
  params: SqlParam[];
};

/* =========================
   Fonctions existantes (réutilisées)
   ========================= */
export function getCompanyFromEmail(email: string): Company | null {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain.endsWith("guestmarkets.net")) return "guestmarkets";
  if (domain.endsWith("guestcameroon.com")) return "guestcameroon";
  return null;
}

export function getRoleFromRow(row: RoleSource): Role {
  const raw = String(row.role ?? "").trim();
  if (/^superadmin$/i.test(raw)) return "superAdmin";
  if (/^admin$/i.test(raw)) return "admin";
  if (row.is_manager === 1 || row.is_manager === true || /^manager$/i.test(raw) || /^responsable$/i.test(raw)) {
    return "manager";
  }
  return "user";
}

/**
 * Priorité : superAdmin > admin > manager > user
 * Retourne le chemin DÉFINITIF (avec le dossier de l'entreprise).
 */
export function dashboardPath(company: Company, role: Role): string {
  const base = company === "guestmarkets" ? "/guestmarkets" : "/guestcameroon";
  switch (role) {
    case "superAdmin":
      return `${base}/admin/overview`;
    case "admin":
      return `${base}/admin/overview`;
    case "manager":
      return `${base}/managers/overview`;
    default:
      return `${base}/users/overview`;
  }
}

/* =========================
   Modèle utilisateur DB
   ========================= */
export type UserRow = RowDataPacket & {
  id: number;
  name: string;
  email: string;
  role: string | null;
  is_admin: 0 | 1;
  is_manager: 0 | 1;
  status: "active" | "pending" | "suspended" | null;
  department_id: number | null;
  company?: Company | null;
};

export async function getUserRow(userId: number): Promise<UserRow | null> {
  const [rows] = await pool.query<UserRow[]>(
    `SELECT id, name, email, role, is_admin, is_manager, status, department_id
       FROM users
      WHERE id=? LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/* =========================
   Rôles simples
   ========================= */
export function isSuperAdminLike(row: UserRow | null): boolean {
  if (!row) return false;
  const r = getRoleFromRow(row);
  return !!row.is_admin || r === "superAdmin" || r === "admin";
}

export function isSuperAdmin(row: UserRow | null): boolean {
  if (!row) return false;
  const r = getRoleFromRow(row);
  return !!row.is_admin || r === "superAdmin";
}

export function isManager(row: UserRow | null): boolean {
  if (!row) return false;
  const r = getRoleFromRow(row);
  return row.is_manager === 1 || r === "manager";
}

/* =========================
   Types lignes auxiliaires
   ========================= */
type TeamRow = RowDataPacket & { leader_user_id?: number };
type TeamMemberRow = RowDataPacket & { user_id: number };
type IdRow = RowDataPacket & { id: number };

/* =========================
   Équipes (lead & membres)
   ========================= */
export async function isTeamLead(userId: number): Promise<boolean> {
  const [rows] = await pool.query<TeamRow[]>(
    `SELECT 1 FROM teams WHERE leader_user_id=? LIMIT 1`,
    [userId]
  );
  return !!rows[0];
}

export async function getLeadTeamMemberIds(userId: number): Promise<number[]> {
  const [rows] = await pool.query<TeamMemberRow[]>(
    `SELECT tm.user_id
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
      WHERE t.leader_user_id = ?`,
    [userId]
  );
  return rows.map((r) => Number(r.user_id));
}

/* =========================
   Chef de projet (facultatif si table projects existe)
   ========================= */
export async function isProjectLead(userId: number): Promise<boolean> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM projects WHERE manager_user_id = ? LIMIT 1`,
      [userId]
    );
    return !!rows[0];
  } catch {
    return false; // si la table n'existe pas, on retourne false
  }
}

/* =========================
   Département & actifs
   ========================= */
export async function getDepartmentMemberIds(departmentId: number): Promise<number[]> {
  const [rows] = await pool.query<IdRow[]>(
    `SELECT id FROM users WHERE status='active' AND department_id=?`,
    [departmentId]
  );
  return rows.map((r) => Number(r.id));
}

export async function getActiveUserIds(): Promise<number[]> {
  const [rows] = await pool.query<IdRow[]>(
    `SELECT id FROM users WHERE status='active'`
  );
  return rows.map((r) => Number(r.id));
}

/* =========================
   Portée d’attribution des participants
   =========================
   - superAdmin/admin : tous les utilisateurs actifs
   - manager : membres de son département
   - team lead : membres de ses équipes
   - user : lui-même
*/
export async function getAllowedAttendeeIds(currentUserId: number): Promise<number[]> {
  const me = await getUserRow(currentUserId);
  if (!me) return [];

  if (isSuperAdminLike(me)) {
    return await getActiveUserIds();
  }

  if (isManager(me) && me.department_id) {
    return await getDepartmentMemberIds(me.department_id);
  }

  if (await isTeamLead(me.id)) {
    const teamMembers = await getLeadTeamMemberIds(me.id);
    return Array.from(new Set<number>([...teamMembers, me.id]));
  }

  return [me.id];
}

/* =========================
   Visibilité des réunions
   ========================= */
export async function meetingsVisibilityWhere(userId: number): Promise<VisibilityWhere> {
  const me = await getUserRow(userId);
  if (!me) return { whereSQL: "AND 1=0", params: [] };

  if (isSuperAdminLike(me)) {
    return { whereSQL: "", params: [] };
  }

  if (isManager(me) && me.department_id) {
    const deptId = me.department_id;
    return {
      whereSQL: `
        AND (
          u.department_id = ? OR EXISTS (
            SELECT 1
              FROM calendar_event_attendees a
              JOIN users uu ON uu.id = a.user_id
             WHERE a.event_id = ev.id AND uu.department_id = ?
          )
        )`,
      params: [deptId, deptId],
    };
  }

  if (await isTeamLead(me.id)) {
    const teamIds = await getLeadTeamMemberIds(me.id);
    if (teamIds.length) {
      return {
        whereSQL: `
          AND (
            ev.created_by = ? OR EXISTS (
              SELECT 1 FROM calendar_event_attendees a
               WHERE a.event_id = ev.id AND a.user_id IN (${teamIds.map(() => "?").join(",")})
            )
          )`,
        params: [me.id, ...teamIds],
      };
    }
    return { whereSQL: `AND ev.created_by = ?`, params: [me.id] };
  }

  return {
    whereSQL: `AND (ev.created_by = ? OR EXISTS (SELECT 1 FROM calendar_event_attendees a WHERE a.event_id=ev.id AND a.user_id=?))`,
    params: [me.id, me.id],
  };
}

/* =========================
   Accès Planning (garde)
   ========================= */
export async function canAccessPlanning(userId: number): Promise<boolean> {
  const me = await getUserRow(userId);
  if (!me) return false;
  if (isSuperAdminLike(me) || isManager(me)) return true;
  if (await isTeamLead(userId)) return true;
  if (await isProjectLead(userId)) return true;
  return false;
}
