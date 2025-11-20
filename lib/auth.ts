// lib/auth.ts
import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import type { RowDataPacket } from "mysql2";
import { pool } from "./db";
import { randomUUID } from "crypto";

/* =========================
   Types
   ========================= */
export type AccountStatus = "PENDING" | "SUSPENDED" | "VALIDATED";

// Entreprises & rôles
export type Company = "guestmarkets" | "guestcameroon";
export type Role = "user" | "manager" | "admin" | "superAdmin";

export interface AuthPayload extends JWTPayload {
  sub: string;
  email: string;
  is_admin: boolean;
  jti: string;
  role?: Role;
  company?: Company;
}

export type CurrentUser = {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
  role: "superAdmin" | "user";
  status: AccountStatus;
};

/** Claims réellement présents dans le JWT */
type TokenClaims = JWTPayload & {
  sub: string;
  email: string;
  is_admin: boolean;
  jti: string;
  role?: Role;
  company?: Company;
};

/* =========================
   Constantes
   ========================= */
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");
const JWT_EXPIRES_IN_DAYS = Number(process.env.JWT_EXPIRES_IN_DAYS || 7);
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "session_token";

/* =========================
   Password helpers
   ========================= */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/* =========================
   JWT helpers
   ========================= */
export async function signJwt(
  payload: Pick<AuthPayload, "sub" | "email" | "is_admin"> &
           Partial<Pick<AuthPayload, "role" | "company">>
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + JWT_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);

  const token = await new SignJWT({
      ...payload,
      jti,
      ...(payload.role ? { role: payload.role } : {}),
      ...(payload.company ? { company: payload.company } : {}),
    })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(JWT_SECRET);

  return { token, jti, expiresAt };
}

export async function verifyJwt(token: string): Promise<AuthPayload | null> {
  try {
    // Typage strict des claims pour éviter tout `any`
    const { payload } = await jwtVerify<TokenClaims>(token, JWT_SECRET);

    // On renvoie un objet conforme à AuthPayload
    return {
      sub: payload.sub,
      email: payload.email,
      is_admin: payload.is_admin,
      jti: payload.jti,
      role: payload.role,
      company: payload.company,
      iat: payload.iat,
      exp: payload.exp,
      nbf: payload.nbf,
      iss: payload.iss,
      aud: payload.aud,
    };
  } catch {
    return null;
  }
}

/* =========================
   Validations
   ========================= */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export function isStrongPassword(pw: string): boolean {
  return pw.length >= 8;
}

/* =========================
   Token depuis la requête
   ========================= */
export async function getAuthTokenFromRequest(): Promise<string | null> {
  // Votre setup Next expose cookies()/headers() comme fonctions async -> on les await
  const ck = await cookies();
  const cookieToken = ck.get(SESSION_COOKIE_NAME)?.value ?? null;

  const hdrs = await headers();
  const auth = hdrs.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;

  return bearer || cookieToken || null;
}

/* =========================
   getCurrentUser (SERVER ONLY)
   ========================= */
type UserRow = RowDataPacket & {
  id: number;
  name: string;
  email: string;
  is_admin: 0 | 1;
  status: "active" | "pending" | "suspended" | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = await getAuthTokenFromRequest();
  if (!token) return null;

  const payload = await verifyJwt(token);
  if (!payload) return null;

  const [rows] = await pool.query<UserRow[]>(
    `SELECT id, name, email, is_admin,
            CASE
              WHEN status = 'active'    THEN 'VALIDATED'
              WHEN status = 'pending'   THEN 'PENDING'
              WHEN status = 'suspended' THEN 'SUSPENDED'
              ELSE COALESCE(status, 'VALIDATED')
            END AS status
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [Number(payload.sub)]
  );

  const u = rows?.[0];
  if (!u) return null;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    is_admin: !!u.is_admin,
    role: u.is_admin ? "superAdmin" : "user",
    status: (u.status ?? "VALIDATED") as AccountStatus,
  };
}

/* =========================
   Guards API
   ========================= */
export async function requireUser(): Promise<{ user: CurrentUser; token: string }> {
  const token = await getAuthTokenFromRequest();
  if (!token) throw new Error("Unauthorized");

  const payload = await verifyJwt(token);
  if (!payload) throw new Error("Unauthorized");

  const [rows] = await pool.query<UserRow[]>(
    `SELECT id, name, email, is_admin,
            CASE
              WHEN status = 'active'    THEN 'VALIDATED'
              WHEN status = 'pending'   THEN 'PENDING'
              WHEN status = 'suspended' THEN 'SUSPENDED'
              ELSE COALESCE(status, 'VALIDATED')
            END AS status
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [Number(payload.sub)]
  );

  const u = rows?.[0];
  if (!u) throw new Error("Unauthorized");

  const user: CurrentUser = {
    id: u.id,
    name: u.name,
    email: u.email,
    is_admin: !!u.is_admin,
    role: u.is_admin ? "superAdmin" : "user",
    status: (u.status ?? "VALIDATED") as AccountStatus,
  };

  if (user.status !== "VALIDATED") {
    if (user.status === "SUSPENDED") throw new Error("Account suspended");
    if (user.status === "PENDING") throw new Error("Account pending approval");
    throw new Error("Unauthorized");
  }

  return { user, token };
}

export async function requireAdmin(): Promise<{ user: CurrentUser; token: string }> {
  const r = await requireUser();
  if (!r.user.is_admin) throw new Error("Forbidden");
  return r;
}
