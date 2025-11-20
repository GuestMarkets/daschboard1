// app/api/calendar/google/callback/route.ts
import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { exchangeCodeForTokens } from "../../../../../../lib/google";

type Tokens = Awaited<ReturnType<typeof exchangeCodeForTokens>>;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");

  const base = process.env.APP_BASE_URL
    ? `${process.env.APP_BASE_URL}/admin/calendar`
    : "/admin/calendar";

  // Erreur renvoyée par Google (ex: access_denied) → redirection avec message
  if (err) {
    const msg = encodeURIComponent(`${err}${errDesc ? `: ${errDesc}` : ""}`);
    return NextResponse.redirect(`${base}?oauth_error=${msg}`);
  }

  if (!code) {
    return NextResponse.json({ error: "Code manquant" }, { status: 400 });
  }

  try {
    const tokens: Tokens = await exchangeCodeForTokens(code);

    // Extraction sécurisée du userId depuis state="uid:<number>"
    let userIdFromState: number | null = null;
    if (state.startsWith("uid:")) {
      const parsed = Number(state.slice(4));
      if (Number.isFinite(parsed)) userIdFromState = parsed;
    }

    if (userIdFromState == null) {
      return NextResponse.json(
        { error: "Utilisateur inconnu (state manquant)." },
        { status: 400 }
      );
    }

    // Mise à jour des tokens Google en base
    await pool.query(
      `UPDATE user_google_accounts
       SET access_token = ?, 
           refresh_token = ?, 
           scope = ?, 
           token_type = ?, 
           expiry_date = ?, 
           connected = 1, 
           updated_at = NOW()
       WHERE user_id = ?`,
      [
        tokens.access_token ?? null,
        tokens.refresh_token ?? null,
        tokens.scope ?? null,
        tokens.token_type ?? null,
        tokens.expiry_date ?? null,
        userIdFromState,
      ]
    );

    return NextResponse.redirect(base);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur callback Google";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
