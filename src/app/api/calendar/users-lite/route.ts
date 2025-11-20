export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { getAuthUserId } from "../../../../../lib/auth_user";
import type { RowDataPacket } from "mysql2";

interface UserRow extends RowDataPacket {
  id: number | string; // selon la conf MySQL, peut revenir en string (BIGINT)
  name: string;
  email: string;
}

export async function GET(req: Request) {
  // Auth requise
  await getAuthUserId(req);

  const pool = getPool();

  // ⬇️ Typage conforme à mysql2: le générique doit satisfaire QueryResult
  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, name, email FROM users ORDER BY name ASC"
  );

  const items = rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    email: r.email,
  }));

  return NextResponse.json({ items });
}
