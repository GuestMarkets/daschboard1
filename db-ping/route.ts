// app/api/db-ping/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../lib/db";

export async function GET() {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    return NextResponse.json({ ok: true, rows });
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e);
      return NextResponse.json(
        { ok: false, error: e.message },
        { status: 500 }
      );
    }
    console.error("Unknown error:", e);
    return NextResponse.json(
      { ok: false, error: "Unexpected error" },
      { status: 500 }
    );
  }
}
