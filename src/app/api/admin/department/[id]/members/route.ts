// app/api/departments/[taskId]/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../lib/db";
import { RowDataPacket } from "mysql2";

interface UserRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  department_id: number;
}

// (Next 15) le validateur attend context.params comme Promise
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const departmentId = Number(id);
    if (!Number.isFinite(departmentId) || departmentId <= 0) {
      return NextResponse.json(
        { error: "Paramètre 'id' invalide." },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

    // Construire dynamiquement la requête selon la présence de q
    const baseSql = `
      SELECT id, name, email, department_id
      FROM users
      WHERE department_id = ?
    `;
    const searchSql = q
      ? ` AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)`
      : ``;

    const orderLimitSql = ` ORDER BY name ASC LIMIT 200`;

    const sql = baseSql + searchSql + orderLimitSql;
    const params: (number | string)[] = q
      ? [departmentId, `%${q}%`, `%${q}%`]
      : [departmentId];

    const [rows] = await pool.query<UserRow[]>(sql, params);

    return NextResponse.json({ items: rows });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erreur serveur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
