// app/api/teams/my-led/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2";

export async function GET(req: Request) {
  try {
    const ck = await cookies();
    const token =
      ck.get(SESSION_COOKIE_NAME)?.value ||
      (req.headers.get("authorization")?.toLowerCase().startsWith("bearer ")
        ? req.headers.get("authorization")!.slice(7).trim()
        : null);

    const payload = token ? await verifyJwt(token) : null;

    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const uid = Number(payload.sub);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.name, t.description, t.leader_user_id,
              t.created_at, t.updated_at,
              u.name AS leader_name, u.email AS leader_email
         FROM teams t
         LEFT JOIN users u ON u.id = t.leader_user_id
        WHERE t.leader_user_id = ?
        ORDER BY t.id DESC`,
      [uid]
    );

    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
