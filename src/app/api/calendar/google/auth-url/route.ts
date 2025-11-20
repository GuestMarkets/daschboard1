// app/api/calendar/google/auth-url/route.ts
import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";
import { getAuthUrl } from "../../../../../../lib/google";
import type { RowDataPacket } from "mysql2/promise";

interface UserGoogleAccountRow extends RowDataPacket {
  gmail: string | null;
}

export async function GET() {
  try {
    const { user } = await requireUser();

    const [rows] = await pool.query<UserGoogleAccountRow[]>(
      "SELECT gmail FROM user_google_accounts WHERE user_id = ? LIMIT 1",
      [user.id]
    );

    const gmail = rows[0]?.gmail ?? null;

    if (!gmail) {
      return NextResponse.json(
        { error: "Aucune adresse Gmail enregistrée." },
        { status: 400 }
      );
    }

    // Optionnel: passer un state (ex: anti-CSRF)
    const url = getAuthUrl(`uid:${user.id}`);

    return NextResponse.json({ url });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Erreur génération URL Google";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
