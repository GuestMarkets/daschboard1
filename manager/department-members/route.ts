// app/api/manager/department-members/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { requireManager } from "../../../../../lib/manager";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { departmentId } = await requireManager();
    const pool = getPool();

    const [rows] = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.is_manager,
        u.role
      FROM users u
      WHERE u.department_id = :dep
        AND u.status = 'active'
      ORDER BY u.name ASC
      `,
      { dep: departmentId }
    );

    return NextResponse.json({ members: rows }, { status: 200 });
  } catch (error: unknown) {
    let msg = "Server error";
    let status = 500;

    if (error instanceof Error) {
      if (error.message === "Forbidden") {
        msg = "Forbidden";
        status = 403;
      } else if (error.message === "Unauthorized") {
        msg = "Unauthorized";
        status = 401;
      }
    }

    return NextResponse.json({ error: msg }, { status });
  }
}
