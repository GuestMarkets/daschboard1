// app/api/tasks/users-lite/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2";

export async function GET() {
  try {
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;

    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, email FROM users ORDER BY name ASC"
    );

    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
