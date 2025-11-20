// app/api/users/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

type Company = "Guest Markets" | "Guest Cameroon" | "Other";

interface UserRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  is_admin: 0 | 1;
  is_manager: 0 | 1;
  role: "user" | "superAdmin";
  status: "active" | "suspended";
  created_at: string;
  updated_at: string;
}

interface CountRow extends RowDataPacket {
  c: number;
}

type SqlParam = string | number;

type BaseUser = {
  id: number;
  name: string;
  email: string;
};

type FullUser = BaseUser & {
  isAdmin: boolean;
  isManager: boolean;
  role: "user" | "superAdmin";
  status: "active" | "suspended";
  company: Company;
  createdAt: string;
  updatedAt: string;
};

function computeCompany(email: string): Company {
  const e = email.toLowerCase();
  if (e.includes("@guestmarkets")) return "Guest Markets";
  if (e.includes("@guestcameroon") || e.includes("@guestcameroun")) return "Guest Cameroon";
  return "Other";
}

export async function GET(req: Request) {
  try {
    // ---- Auth (cookie httpOnly OU Authorization: Bearer) ----
    const ck = await cookies(); // ✅ correction : cookies() renvoie une promesse
    const cookieToken = ck.get(SESSION_COOKIE_NAME)?.value ?? null;

    const auth = req.headers.get("authorization") || "";
    const bearer = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : null;

    const token = bearer || cookieToken;
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    // ---- Filtres ----
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const statusParam = url.searchParams.get("status") as "active" | "suspended" | null;
    const managerParam = url.searchParams.get("manager");
    const companyParam = url.searchParams.get("company") as Company | null;
    const lite = url.searchParams.get("lite") === "1";

    // Pagination
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") || "100")));
    const offset = (page - 1) * pageSize;

    const wheres: string[] = [];
    const params: SqlParam[] = [];

    if (q) {
      wheres.push("(u.name LIKE ? OR u.email LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    if (statusParam === "active" || statusParam === "suspended") {
      wheres.push("u.status = ?");
      params.push(statusParam);
    }
    if (managerParam === "1" || managerParam === "0") {
      wheres.push("u.is_manager = ?");
      params.push(managerParam === "1" ? 1 : 0);
    }

    const whereSql = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
    const pool = getPool();

    // ---- Compte total ----
    const [[cntRow]] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS c FROM users u ${whereSql}`,
      params
    );
    const totalMatching = Number(cntRow?.c ?? 0);

    // ---- Sélection ----
    const [rows] = await pool.query<UserRow[]>(
      `
      SELECT
        u.id, u.name, u.email,
        u.is_admin, u.is_manager,
        u.role, u.status,
        u.created_at, u.updated_at
      FROM users u
      ${whereSql}
      ORDER BY u.name ASC
      LIMIT ? OFFSET ?
      `,
      [...params, pageSize, offset]
    );

    // ---- Projection ----
    const fullAll: FullUser[] = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isAdmin: Boolean(u.is_admin),
      isManager: Boolean(u.is_manager),
      role: u.role,
      status: u.status,
      company: computeCompany(u.email),
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    }));

    const fullFiltered: FullUser[] = companyParam
      ? fullAll.filter((u) => u.company === companyParam)
      : fullAll;

    const items: Array<FullUser | BaseUser> = lite
      ? fullFiltered.map(({ id, name, email }) => ({ id, name, email }))
      : fullFiltered;

    const summary =
      lite
        ? undefined
        : {
            total: fullFiltered.length,
            active: fullFiltered.filter((u) => u.status === "active").length,
            suspended: fullFiltered.filter((u) => u.status === "suspended").length,
            superAdmins: fullFiltered.filter((u) => u.role === "superAdmin").length,
            managers: fullFiltered.filter((u) => u.isManager).length,
            byCompany: {
              "Guest Markets": fullFiltered.filter((u) => u.company === "Guest Markets").length,
              "Guest Cameroon": fullFiltered.filter((u) => u.company === "Guest Cameroon").length,
              Other: fullFiltered.filter((u) => u.company === "Other").length,
            },
          };

    return NextResponse.json({
      items,
      summary,
      page,
      pageSize,
      total: totalMatching,
      hasMore: offset + fullFiltered.length < totalMatching,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    console.error("[/api/users] error:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
