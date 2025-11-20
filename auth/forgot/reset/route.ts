// app/api/auth/password/reset/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../../../lib/db";
import { hashPassword } from "../../../../../../lib/auth";

type PasswordResetRow = RowDataPacket & {
  id: number;
  userId: number;         // si ta colonne s'appelle `user_id`, on la mappe via l'alias SQL
  token: string;
  consumedAt: string | null; // récupérée en tant que string via dateStrings:true
  expiresAt: string;         // idem
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token: string | undefined = body?.token;
    const password: string | undefined = body?.password;

    if (!token || !password) {
      return NextResponse.json({ error: "Données manquantes" }, { status: 400 });
    }

    // 1) Récupérer le token
    const [rows] = await pool.query<PasswordResetRow[]>(
      `
      SELECT
        id,
        user_id AS userId,
        token,
        consumed_at AS consumedAt,
        expires_at AS expiresAt
      FROM password_reset_tokens
      WHERE token = ?
      LIMIT 1
      `,
      [token]
    );

    const t = rows?.[0];

    // 2) Vérifications de validité
    if (!t) {
      return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 400 });
    }

    if (t.consumedAt) {
      return NextResponse.json({ error: "Lien déjà utilisé" }, { status: 400 });
    }

    const exp = new Date(t.expiresAt);
    if (isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
      return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 400 });
    }

    // 3) Hash du mot de passe
    const passwordHash = await hashPassword(password);

    // 4) Mettre à jour l'utilisateur (status 'suspended' en base pour matcher ton CASE dans getCurrentUser)
    await pool.query(
      `
      UPDATE users
      SET password_hash = ?, status = 'suspended'
      WHERE id = ?
      `,
      [passwordHash, t.userId]
    );

    // 5) (Optionnel) Invalider des sessions en base si tu as une table 'sessions'
    // On essaie, mais on n'échoue pas si la table n'existe pas.
    try {
      await pool.query(`DELETE FROM sessions WHERE user_id = ?`, [t.userId]);
    } catch {
      // pas de table 'sessions' ou autre schéma : on ignore
    }

    // 6) Marquer le token comme consommé
    await pool.query(
      `
      UPDATE password_reset_tokens
      SET consumed_at = NOW()
      WHERE id = ?
      `,
      [t.id]
    );

    // 7) Journaliser l'activité
    const ua = req.headers.get("user-agent") ?? "unknown";
    const ipHeader = req.headers.get("x-forwarded-for") ?? "";
    const ip = ipHeader.split(",")[0]?.trim() || "0.0.0.0";

    await pool.query(
      `
      INSERT INTO login_activity (user_id, event, ip, user_agent)
      VALUES (?, 'PASSWORD_RESET', ?, ?)
      `,
      [t.userId, ip, ua]
    );

    await pool.query(
      `
      INSERT INTO login_activity (user_id, event, ip, user_agent)
      VALUES (?, 'SUSPEND', ?, ?)
      `,
      [t.userId, ip, ua]
    );

    return NextResponse.json({
      ok: true,
      message:
        "Mot de passe mis à jour. Votre compte est suspendu en attente de validation.",
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
