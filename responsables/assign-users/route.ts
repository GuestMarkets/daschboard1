export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";

// ✅ Définition d’un type strict pour le corps de la requête
interface AssignUsersBody {
  departmentId?: number;
  userIds?: number[];
}

export async function POST(req: Request) {
  let body: AssignUsersBody = {};

  try {
    // ✅ Lecture et typage du JSON sans any
    body = (await req.json().catch(() => ({}))) as AssignUsersBody;

    const ck = cookies();
    const token = (await ck).get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload?.is_admin) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const departmentId = Number(body?.departmentId);
    const userIds: number[] = Array.isArray(body?.userIds)
      ? body.userIds.map(Number).filter(Boolean)
      : [];

    if (!departmentId || userIds.length === 0) {
      return NextResponse.json({ error: "Paramètres requis" }, { status: 400 });
    }

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // ✅ Mise à jour uniquement des non-managers
      await conn.query(
        `UPDATE users 
         SET department_id = ?
         WHERE id IN (${userIds.map(() => "?").join(",")})
           AND (is_manager = 0 OR is_manager IS NULL)`,
        [departmentId, ...userIds]
      );

      await conn.commit();
      return NextResponse.json({ ok: true });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error: unknown) {
    // ✅ Gestion d’erreur typée sans utiliser "any"
    if (error instanceof Error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.error("Erreur inconnue :", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
