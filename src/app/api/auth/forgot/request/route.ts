// app/api/auth/password/request/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../../../lib/db";
import { randomBytes } from "node:crypto";

type UserRow = RowDataPacket & { id: number };

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email requis" }, { status: 400 });
    }

    // Normalisation email
    const normEmail = email.trim().toLowerCase();

    // 1) On cherche l'utilisateur (non bloquant pour éviter l'énumération)
    const [users] = await pool.query<UserRow[]>(
      `SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1`,
      [normEmail]
    );

    const user = users?.[0];

    // Que l'utilisateur existe ou non, on répond ok pour éviter l'énumération
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    // 2) On peut (optionnel) révoquer d'anciens tokens non consommés pour cet utilisateur
    await pool.query(
      `DELETE FROM password_reset_tokens WHERE user_id = ? AND consumed_at IS NULL`,
      [user.id]
    );

    // 3) Génération du token et calcul d'expiration
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

    // 4) Insertion du nouveau token
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`,
      [user.id, token, expiresAt]
    );

    // 5) Journalisation de la demande
    const ua = req.headers.get("user-agent") ?? "unknown";
    const ipHeader = req.headers.get("x-forwarded-for") ?? "";
    const ip = ipHeader.split(",")[0]?.trim() || "0.0.0.0";

    // Table login_activity : (user_id, event, ip, user_agent)
    await pool.query(
      `INSERT INTO login_activity (user_id, event, ip, user_agent) VALUES (?, 'REQUEST_RESET', ?, ?)`,
      [user.id, ip, ua]
    );

    // 6) Construction du lien (dev: on renvoie le lien ; en prod, envoie un email)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const resetLink = `${baseUrl}/auth?mode=forgot&token=${encodeURIComponent(token)}`;

    return NextResponse.json({ ok: true, resetLink });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
