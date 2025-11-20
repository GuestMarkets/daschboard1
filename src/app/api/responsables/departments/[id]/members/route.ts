export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

type Row = RowDataPacket & {
  id: number;
  name: string;
  email: string;
  is_manager: number;
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    // Dans ta config, cookies() est async → il faut l’await
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload?.is_admin) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    // params est un Promise dans Next 15 typed routes → on l’attend
    const { id } = await ctx.params;
    const deptId = Number(id);

    if (!Number.isFinite(deptId)) {
      return NextResponse.json({ error: "Paramètre invalide" }, { status: 400 });
    }

    const pool = getPool();
    const [rows] = await pool.query<Row[]>(
      `SELECT id, name, email, is_manager
       FROM users
       WHERE department_id = ?
       ORDER BY is_manager DESC, name ASC`,
      [deptId]
    );

    const items = (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      isManager: !!r.is_manager,
    }));

    return NextResponse.json({ items });
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur inconnue" }, { status: 500 });
  }
}
