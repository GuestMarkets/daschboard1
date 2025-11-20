export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

type Row = RowDataPacket & {
  id: number;
  name: string;
  code: string;
  manager_id: number | null;
  manager_name: string | null;
  member_count: number;
};

export async function GET() {
  try {
    const ck = await cookies();
    const cookieToken = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    const auth = ""; // on peut aussi lire Authorization si besoin
    const token = cookieToken || auth;

    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload?.is_admin) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const pool = getPool();
    const sql = `
      SELECT 
        d.id, d.name, d.code, d.manager_id,
        m.name AS manager_name,
        COUNT(u.id) AS member_count
      FROM departments d
      LEFT JOIN users m ON m.id = d.manager_id
      LEFT JOIN users u ON u.department_id = d.id
      GROUP BY d.id
      ORDER BY d.name ASC
    `;

    const [rows] = await pool.query<Row[]>(sql);

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      managerId: r.manager_id,
      managerName: r.manager_name,
      memberCount: Number(r.member_count || 0),
    }));

    return NextResponse.json({ items });
  } catch (e: unknown) {
    console.error(e);
    const message =
      e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
