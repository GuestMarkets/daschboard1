export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

type AssignManagerBody = {
  departmentId: number;
  userId: number;
};

interface DepartmentRow extends RowDataPacket {
  id: number;
  name: string;
  code: string;
  manager_id: number | null;
  manager_name: string | null;
  member_count: number | null;
}

/** Valide le body brut en { departmentId, userId }. */
function parseAssignManagerBody(body: unknown): AssignManagerBody | null {
  if (typeof body !== "object" || body === null) return null;

  const b = body as { departmentId?: unknown; userId?: unknown };

  const departmentId = Number(b.departmentId);
  const userId = Number(b.userId);

  if (
    Number.isFinite(departmentId) &&
    Number.isFinite(userId) &&
    departmentId > 0 &&
    userId > 0
  ) {
    return { departmentId, userId };
  }
  return null;
}

export async function POST(req: Request) {
  // Body en unknown → validation ensuite
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }

  try {
    // ✅ Dans ton setup, cookies() est un Promise → on l’attend
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;

    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload?.is_admin) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const parsed = parseAssignManagerBody(rawBody);
    if (!parsed) {
      return NextResponse.json({ error: "Paramètres requis" }, { status: 400 });
    }
    const { departmentId, userId } = parsed;

    const pool = getPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // ancien responsable → simple membre (si existait)
      await conn.query(
        `UPDATE users SET is_manager = 0 WHERE department_id = ? AND is_manager = 1`,
        [departmentId]
      );

      // assigner le user comme manager de ce dept
      await conn.query(
        `UPDATE users SET department_id = ?, is_manager = 1 WHERE id = ?`,
        [departmentId, userId]
      );

      // stocker le manager dans la table departments (si colonne manager_id)
      await conn.query(
        `UPDATE departments SET manager_id = ? WHERE id = ?`,
        [userId, departmentId]
      );

      await conn.commit();

      // renvoyer le département mis à jour
      const [rows] = await conn.query<DepartmentRow[]>(
        `SELECT d.id, d.name, d.code, d.manager_id,
                (SELECT name FROM users WHERE id = d.manager_id) AS manager_name,
                (SELECT COUNT(*) FROM users WHERE department_id = d.id) AS member_count
         FROM departments d
         WHERE d.id = ?`,
        [departmentId]
      );

      const r = rows?.[0];
      const department = r
        ? {
            id: r.id,
            name: r.name,
            code: r.code,
            managerId: r.manager_id,
            managerName: r.manager_name ?? null,
            memberCount: Number(r.member_count ?? 0),
          }
        : null;

      return NextResponse.json({ department });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    console.error(e);
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
