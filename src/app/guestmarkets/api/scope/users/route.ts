export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../lib/auth";
import { cookies, headers } from "next/headers";

// — util pour token
async function getToken(): Promise<string | null> {
  const ck = await cookies();
  const cookieToken = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
  const hdrs = await headers();
  const auth = hdrs.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  return bearer || cookieToken || null;
}

type UserRow = RowDataPacket & {
  id: number;
  name: string | null;
  email: string | null;
};

type UserItem = {
  id: number;
  name: string;
  email: string;
};

// GET /guestmarkets/api/scope/users?q=...
export async function GET(req: Request) {
  try {
    const token = await getToken();
    const payload = token ? await verifyJwt(token) : null;
    if (!payload) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const uid = Number(payload.sub);

    // TODO: Remplacer par la vraie logique de portée (departments/teams/projects dirigés).
    // En attendant, on renvoie au moins l'utilisateur courant (utile pour l'UI et évite la variable non utilisée).
    const [rows] = await pool.query<UserRow[]>(
      `SELECT id, name, email
         FROM users
        WHERE id = ?`,
      [uid]
    );

    const items: UserItem[] = rows
      .map((r) => ({
        id: Number(r.id),
        name: String(r.name ?? ""),
        email: String(r.email ?? ""),
      }))
      .filter((u) => {
        if (!q) return true;
        const s = `${u.name} ${u.email}`.toLowerCase();
        return s.includes(q);
      });

    return NextResponse.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
