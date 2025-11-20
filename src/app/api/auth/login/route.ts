// app/api/auth/login/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import {
  verifyPassword,
  signJwt,
  isValidEmail,
  SESSION_COOKIE_NAME,
  type Role,
  type Company,
} from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";

type Body = { email?: string; password?: string };
type UserStatus = "active" | "pending" | "suspended";

interface DBUserRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role?: string | null;       // 'user' | 'admin' | 'superadmin' (en base)
  is_manager?: 0 | 1 | null;
  is_admin?: 0 | 1 | null;
  status: UserStatus;         // 'active' | 'pending' | 'suspended'
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
function jsonOk<T>(data: T) {
  return NextResponse.json(data, { status: 200 });
}

// Entreprise depuis le domaine
function getCompanyFromEmail(email: string): Company | null {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain.endsWith("guestmarkets.net")) return "guestmarkets";
  if (domain.endsWith("guestcameroon.com")) return "guestcameroon";
  return null;
}

// Déduction du rôle par priorité: superAdmin > admin > manager > user
function computeRole(row: Pick<DBUserRow, "role" | "is_manager" | "is_admin">): Role {
  const dbRole = String(row.role ?? "").trim().toLowerCase(); // 'user' | 'admin' | 'superadmin'
  if ((row.is_admin ?? 0) === 1 || dbRole === "superadmin") return "superAdmin";
  if (dbRole === "admin") return "admin";
  if ((row.is_manager ?? 0) === 1) return "manager";
  return "user";
}

function dashboardPath(company: Company, role: Role): string {
  const base = company === "guestmarkets" ? "/guestmarkets" : "/guestcameroon";
  switch (role) {
    case "superAdmin":
      return "/admin/overview"; // ← absolu et cohérent
    case "admin":
      return `${base}/admin/overview`;
    case "manager":
      return `${base}/managers/overview`;
    default:
      return `${base}/users/overview`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!isValidEmail(email)) return jsonError("Email invalide");
    if (!password) return jsonError("Mot de passe requis");

    const company = getCompanyFromEmail(email);
    if (!company) return jsonError("Domaine email non autorisé", 403);

    const pool = getPool();
    const [rows] = await pool.query<DBUserRow[]>(
      `SELECT id, name, email, password_hash, role, is_manager, is_admin, status
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonError("Identifiants incorrects", 401);
    }

    const user: DBUserRow = rows[0];

    // status en DB : 'active' | 'pending' | 'suspended'
    if (user.status !== "active") {
      return jsonError("Compte suspendu (en attente d'approbation)", 403);
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return jsonError("Identifiants incorrects", 401);

    const role = computeRole({
      role: user.role ?? null,
      is_manager: user.is_manager ?? 0,
      is_admin: user.is_admin ?? 0,
    });

    const { token, jti, expiresAt } = await signJwt({
      sub: String(user.id),
      email: user.email,
      is_admin: role === "superAdmin" || role === "admin",
      role,
      company,
    });

    // optionnel: journaliser la session
    await pool.query(
      "INSERT INTO sessions (user_id, jwt_id, created_at, expires_at) VALUES (?, ?, NOW(), ?)",
      [user.id, jti, new Date(expiresAt)]
    );

    const redirect = dashboardPath(company, role);

    const res = jsonOk({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        is_manager: Boolean(user.is_manager),
        is_admin: Boolean(user.is_admin),
        status: user.status,
        company,
      },
      token,
      redirect,
    }) as NextResponse;

    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      expires: new Date(expiresAt),
    });

    return res;
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("Erreur serveur (login):", err.message, err.stack);
    } else {
      console.error("Erreur serveur (login):", err);
    }
    return jsonError("Erreur serveur (login)", 500);
  }
}
