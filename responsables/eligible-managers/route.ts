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
  is_manager: number;
  department_id: number | null;
  status?: string | null;
};

export async function GET() {
  try {
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token)
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const payload = await verifyJwt(token);
    if (!payload?.is_admin)
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

    const pool = getPool();

    // On prend tous les comptes actifs (si colonne status), sinon tous
    const [rows] = await pool.query<Row[]>(
      `SELECT id, name, email, is_manager, department_id
       FROM users
       WHERE (status IS NULL OR status='active')`
    );

    const items = (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      isManager: !!r.is_manager,
      departmentId: r.department_id,
    }));

    return NextResponse.json({ items });
  } catch (e: unknown) {
    console.error(e);

    let message = "Erreur serveur";
    if (e instanceof Error) {
      message = e.message;
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
