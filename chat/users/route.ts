export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import type { RowDataPacket } from "mysql2";
import { requireUser } from "../_utils";

export async function GET() {
  try {
    const { userId } = await requireUser();
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, email FROM users WHERE status='active' AND id<>? ORDER BY name ASC",
      [userId]
    );
    return NextResponse.json({ items: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: e?.status || 500 });
  }
}
