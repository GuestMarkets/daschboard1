// app/guestmarkets/api/me/profile/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

interface UserDepartmentRow extends RowDataPacket {
  department_id: number | null;
}

export async function GET() {
  try {
    const { user } = await requireUser();

    const [rows] = await pool.query<UserDepartmentRow[]>(
      "SELECT department_id FROM users WHERE id = ? LIMIT 1",
      [user.id]
    );

    const department_id = rows?.[0]?.department_id ?? null;
    return NextResponse.json({ department_id });
  } catch (e: unknown) {
    const errorMessage =
      e instanceof Error ? e.message : "Server error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
