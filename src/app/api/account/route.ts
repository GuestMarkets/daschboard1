export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../lib/db";
import {
  SESSION_COOKIE_NAME,
  verifyJwt,
  hashPassword,
  verifyPassword
} from "../../../../lib/auth";

type Role = "user" | "superAdmin";
type Status = "SUSPENDED" | "ACTIVE";

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
function ok(data: unknown) {
  return NextResponse.json(data, { status: 200 });
}

//
// 🔵 GET — récupérer les infos du compte
//
export async function GET() {
  try {
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return err("Non authentifié", 401);

    const payload = await verifyJwt(token);
    if (!payload) return err("Token invalide", 401);

    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, name, email, role, status
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [payload.sub]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return err("Utilisateur introuvable", 404);
    }

    const u = rows[0] as {
      id: number;
      name: string;
      email: string;
      role: Role;
      status: Status;
    };

    return ok({ me: u });
  } catch (e: any) {
    return err(e?.message ?? "Erreur serveur", 500);
  }
}

//
// 🟠 PATCH — modifier nom / mot de passe
//
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const newName: string | undefined = body?.name?.trim();
    const newPassword: string | undefined = body?.newPassword;
    const currentPassword: string | undefined = body?.currentPassword;

    if (!newName && !newPassword) return err("Aucun changement détecté.");

    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return err("Non authentifié", 401);

    const payload = await verifyJwt(token);
    if (!payload) return err("Token invalide", 401);

    const pool = getPool();

    // 🔹 Récupération utilisateur
    const [rows] = await pool.query(
      `SELECT id, name, email, role, status, password_hash
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [payload.sub]
    );

    if (!Array.isArray(rows) || rows.length === 0)
      return err("Utilisateur introuvable", 404);

    const u = rows[0] as {
      id: number;
      name: string;
      email: string;
      role: Role;
      status: Status;
      password_hash: string;
    };

    // 🔹 Vérification mot de passe actuel si non-admin
    if (newPassword && u.role !== "superAdmin") {
      if (!currentPassword) return err("Mot de passe actuel requis.");
      const okPw = await verifyPassword(currentPassword, u.password_hash);
      if (!okPw) return err("Mot de passe actuel incorrect.", 401);
    }

    // 🔹 Préparation UPDATE
    const sets: string[] = [];
    const params: any[] = [];

    if (newName && newName !== u.name) {
      sets.push("name = ?");
      params.push(newName);
    }

    if (newPassword) {
      sets.push("password_hash = ?");
      params.push(await hashPassword(newPassword));
    }

    if (sets.length === 0) return err("Aucun changement utile.");

    let suspended = false;

    if (u.role !== "superAdmin") {
      sets.push("status = 'SUSPENDED'");
      suspended = true;
    }

    // Ajout du paramètre id
    params.push(u.id);

    const sql = `UPDATE users SET ${sets.join(", ")} WHERE id = ? LIMIT 1`;

    await pool.query(sql, params);

    // 🔹 Suspendre + supprimer sessions
    if (suspended) {
      await pool.query("DELETE FROM sessions WHERE user_id = ?", [u.id]);

      return ok({
        success: true,
        suspended: true,
        message:
          "Modifications enregistrées. Votre compte est suspendu en attente de validation."
      });
    }

    return ok({
      success: true,
      suspended: false,
      message: "Modifications enregistrées."
    });
  } catch (e: any) {
    return err(e?.message ?? "Erreur serveur", 500);
  }
}
