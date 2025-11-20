// app/api/calendar/google/save-gmail/route.ts
import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

interface SaveGmailRequestBody {
  email?: string;
}

export async function POST(req: Request) {
  try {
    const { user } = await requireUser();

    // ✅ Typage strict du corps de la requête
    const body = (await req.json().catch(() => ({}))) as SaveGmailRequestBody;
    const email = String(body.email || "").trim().toLowerCase();

    // ✅ Validation d’adresse Gmail
    if (!email.endsWith("@gmail.com")) {
      return NextResponse.json(
        { error: "Adresse Gmail invalide." },
        { status: 400 }
      );
    }

    // ✅ Insertion ou mise à jour de l’adresse Gmail dans la base
    await pool.query(
      `INSERT INTO user_google_accounts (user_id, gmail, connected)
       VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE gmail=VALUES(gmail), connected=0, updated_at=NOW()`,
      [user.id, email]
    );

    return NextResponse.json({ ok: true, gmail: email });
  } catch (e) {
    // ✅ Typage sécurisé de l’erreur
    const errorMessage =
      e instanceof Error ? e.message : "Erreur enregistrement Gmail";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
