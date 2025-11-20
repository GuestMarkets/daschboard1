export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

type Row = RowDataPacket & {
  id: number;
  name: string;
  email: string;
};

export async function GET() {
  try {
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;

    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);

    if (!payload?.is_admin) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const pool = getPool();
    const [rows] = await pool.query<Row[]>(
      `SELECT id, name, email
       FROM users
       WHERE (is_manager = 0 OR is_manager IS NULL)
         AND department_id IS NULL
       ORDER BY name ASC`
    );

    const items = (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      isManager: false,
      departmentId: null,
    }));

    return NextResponse.json({ items });
  } catch (e: unknown) {
    console.error(e);

    // Type narrowing propre
    const message =
      e instanceof Error ? e.message : "Erreur serveur inconnue";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
