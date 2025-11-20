// app/api/calendar/google/disconnect/route.ts
import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

export async function POST() {
  try {
    const { user } = await requireUser();

    await pool.query(
      `UPDATE user_google_accounts
       SET access_token = NULL,
           refresh_token = NULL,
           scope = NULL,
           token_type = NULL,
           expiry_date = NULL,
           connected = 0,
           updated_at = NOW()
       WHERE user_id = ?`,
      [user.id]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Erreur déconnexion Google";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
