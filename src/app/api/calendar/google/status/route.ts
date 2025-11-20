// app/api/calendar/google/status/route.ts
import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

interface GoogleAccountRow extends RowDataPacket {
  gmail: string | null;
  connected: number | boolean;
}

export async function GET() {
  try {
    const { user } = await requireUser();

    const [rows] = await pool.query<GoogleAccountRow[]>(
      "SELECT gmail, connected FROM user_google_accounts WHERE user_id = ? LIMIT 1",
      [user.id]
    );

    const rec = rows[0] ?? null;
    const gmail = rec?.gmail ?? null;
    const connected = Boolean(rec?.connected) && !!gmail;

    return NextResponse.json({
      connected,
      has_gmail: !!gmail,
      gmail,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur statut Google";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
