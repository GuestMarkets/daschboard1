// app/api/auth/signup/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import {
  hashPassword,
  isValidEmail,
  isStrongPassword,
  signJwt,
  SESSION_COOKIE_NAME,
} from "../../../../../lib/auth";
import { jsonError, jsonOk } from "@/app/api/_utils/responses";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

export const runtime = "nodejs";

type Body = { name?: string; email?: string; password?: string };

interface UserIdRow extends RowDataPacket {
  id: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (name.length < 2) return jsonError("Nom trop court (>= 2)");
    if (!isValidEmail(email)) return jsonError("Email invalide");
    if (!isStrongPassword(password)) return jsonError("Mot de passe trop court (>= 8)");

    const pool = getPool();

    // Email unique ?
    const [dup] = await pool.query<UserIdRow[]>(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (Array.isArray(dup) && dup.length > 0) {
      return jsonError("Email déjà utilisé", 409);
    }

    // Création (statut 'pending' pour correspondre aux checks login)
    const password_hash = await hashPassword(password);
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO users (name, email, password_hash, is_admin, status) VALUES (?, ?, ?, 0, "pending")',
      [name, email, password_hash]
    );

    const insertedId = result.insertId;

    // Génère un token (utilisable pour poser le cookie + créer une session)
    const { token, jti, expiresAt } = await signJwt({
      sub: String(insertedId),
      email,
      is_admin: false,
    });

    // Journaliser la session
    await pool.query(
      "INSERT INTO sessions (user_id, jwt_id, created_at, expires_at) VALUES (?, ?, NOW(), ?)",
      [insertedId, jti, new Date(expiresAt)]
    );

    // Réponse + Cookie HttpOnly cohérent avec le login
    const res = jsonOk({ id: insertedId, name, email }) as NextResponse;

    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      expires: new Date(expiresAt),
    });

    return res;
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return jsonError("Erreur serveur (signup)", 500, { detail });
  }
}
