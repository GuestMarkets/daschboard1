export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2";

type DepRow = RowDataPacket & {
  department_id: number | null;
};

type UserRow = RowDataPacket & {
  id: number;
  name: string;
  email: string | null;
};

export async function GET() {
  try {
    const { user } = await requireUser();

    const [rows] = await pool.query<DepRow[]>(
      `SELECT department_id FROM users WHERE id = ? LIMIT 1`,
      [user.id]
    );

    const depId = rows[0]?.department_id ?? null;
    if (!depId) {
      return NextResponse.json({ items: [] });
    }

    const [users] = await pool.query<UserRow[]>(
      `SELECT id, name, email FROM users WHERE department_id = ? ORDER BY name ASC`,
      [depId]
    );

    return NextResponse.json({
      items: users.map((u) => ({
        id: Number(u.id),
        name: String(u.name),
        email: String(u.email ?? ""),
      })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
