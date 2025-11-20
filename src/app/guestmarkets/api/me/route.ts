// app/guestmarkets/api/me/route.ts
export const runtime = "nodejs";

import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";

/* ===================== Helpers ===================== */
const getToken = async (req: Request): Promise<string | null> => {
  // Dans ton setup, cookies() renvoie Promise<ReadonlyRequestCookies>
  const ck = await cookies();
  const auth = req.headers.get("authorization") || "";
  const headerToken = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : null;
  const cookieToken = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
  return cookieToken ?? headerToken ?? null;
};

type UserRow = RowDataPacket & {
  id: number;
  name: string | null;
  email: string | null;
  status: string | null;         // 'active' | 'pending' | 'suspended' | null
  is_admin: 0 | 1;
  is_manager?: 0 | 1;            // si présent dans ta table
  role?: string | null;          // ENUM('user','Admin','superAdmin') éventuellement
  department_id?: number | null; // si présent dans ta table
};

async function getUserRow(uid: number): Promise<UserRow | null> {
  const [rows] = await pool.execute<UserRow[]>(
    `SELECT id, name, email, status, is_admin, is_manager, role, department_id
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [uid]
  );
  return rows?.[0] || null;
}

/* ======= Types utilitaires pour les rôles "lead" ======= */
type IdRow = RowDataPacket & { id: number };

type DepartmentLeadInfo = {
  is_department_lead: boolean;
  department_ids: number[];
};

type TeamLeadInfo = {
  is_team_lead: boolean;
  lead_team_ids: number[];
};

type ProjectLeadInfo = {
  is_project_lead: boolean;
  managed_project_ids: number[];
};

async function getDepartmentLeadInfo(uid: number): Promise<DepartmentLeadInfo> {
  const [rows] = await pool.execute<IdRow[]>(
    `SELECT id FROM departments WHERE manager_id = ?`,
    [uid]
  );
  const ids = rows.map((r) => Number(r.id));
  return { is_department_lead: ids.length > 0, department_ids: ids };
}

async function getTeamLeadInfo(uid: number): Promise<TeamLeadInfo> {
  const [rows] = await pool.execute<IdRow[]>(
    `SELECT id FROM teams WHERE leader_user_id = ?`,
    [uid]
  );
  const ids = rows.map((r) => Number(r.id));
  return { is_team_lead: ids.length > 0, lead_team_ids: ids };
}

async function getProjectLeadInfo(uid: number): Promise<ProjectLeadInfo> {
  const [rows] = await pool.execute<IdRow[]>(
    `SELECT id FROM projects WHERE manager_id = ?`,
    [uid]
  );
  const ids = rows.map((r) => Number(r.id));
  return { is_project_lead: ids.length > 0, managed_project_ids: ids };
}

/* ====================================================
   GET /guestmarkets/api/me
   Le front attend: { ok: boolean; user: { id, name, role, email, status, is_admin, ...flags } }
   ==================================================== */
export async function GET(req: Request) {
  try {
    const token = await getToken(req);
    const payload = token ? await verifyJwt(token) : null;
    if (!payload) {
      return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
    }

    const uid = Number(payload.sub);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "Token invalide" }, { status: 401 });
    }

    const u = await getUserRow(uid);
    if (!u) {
      return NextResponse.json({ ok: false, error: "Utilisateur introuvable" }, { status: 404 });
    }

    // Normalisation DB
    const dbIsAdmin = !!u.is_admin;
    const dbIsManager = typeof u.is_manager === "number" ? !!u.is_manager : false;
    const dbRole = (u.role ? String(u.role) : "user").toLowerCase(); // "user" | "admin" | "superadmin"

    // Infos "lead"
    const [dep, team, proj] = await Promise.all([
      getDepartmentLeadInfo(uid),
      getTeamLeadInfo(uid),
      getProjectLeadInfo(uid),
    ]);

    // Décision (3 rôles max) :
    // - superAdmin si is_admin=1 OU role='superAdmin'
    // - RESP si manager/lead OU role='Admin'
    // - user sinon
    const isSuper = dbIsAdmin || dbRole === "superadmin";
    const isResp =
      !isSuper &&
      (dbIsManager ||
        dbRole === "admin" ||
        dep.is_department_lead ||
        team.is_team_lead ||
        proj.is_project_lead);

    type DisplayRole = "superAdmin" | "RESP" | "user";
    const display_role: DisplayRole = isSuper ? "superAdmin" : isResp ? "RESP" : "user";

    return NextResponse.json({
      ok: true,
      user: {
        id: Number(u.id),
        name: String(u.name || ""),
        email: u.email ? String(u.email) : "",
        status: u.status ? String(u.status) : "", // ex: 'active' / 'pending' / 'suspended'
        is_admin: isSuper, // cohérent avec role
        role: display_role, // <- le front affiche ce rôle

        // Flags utiles côté front (inchangés)
        is_department_lead: dep.is_department_lead,
        is_team_lead: team.is_team_lead,
        is_project_lead: proj.is_project_lead,

        department_ids: dep.department_ids,
        lead_team_ids: team.lead_team_ids,
        managed_project_ids: proj.managed_project_ids,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
