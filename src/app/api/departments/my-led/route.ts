// app/api/departments/my-led/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2";

export async function GET(req: Request) {
  try {
    // ✅ cookies() est maintenant asynchrone → on attend la promesse
    const ck = await cookies();

    const authHeader = req.headers.get("authorization") ?? "";
    const bearer =
      authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : null;

    const token = ck.get(SESSION_COOKIE_NAME)?.value || bearer;

    const payload = token ? await verifyJwt(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const uid = Number((payload as { sub: string | number }).sub);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT d.id,
              d.name,
              d.code,
              d.description,
              d.manager_id AS leader_user_id,
              d.manager_name AS leader_name,
              d.member_count,
              d.status,
              d.color,
              d.created_at,
              d.updated_at
         FROM departments d
        WHERE d.manager_id = ?
        ORDER BY d.id DESC`,
      [uid]
    );

    return NextResponse.json({ items: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
