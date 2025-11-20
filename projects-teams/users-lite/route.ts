export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2";

interface UserRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
}

export async function GET(req: Request) {
  try {
    // ✅ cookies() est asynchrone en runtime nodejs
    const ck = await cookies();

    // ✅ Extraction du token
    const cookieToken = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const headerToken = bearerMatch ? bearerMatch[1].trim() : null;

    const token = cookieToken ?? headerToken;

    // ✅ Vérification JWT typée
    const payload = token ? await verifyJwt(token) : null;

    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    // ✅ Requête typée MySQL
    const [rows] = await pool.query<UserRow[]>(
      "SELECT id, name, email FROM users WHERE status='active' ORDER BY name ASC"
    );

    return NextResponse.json({ items: rows });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
