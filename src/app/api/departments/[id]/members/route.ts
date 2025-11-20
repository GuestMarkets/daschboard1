// app/api/departments/[taskId]/members/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db"; // ← depuis app/api/departments/[taskId]/members/route.ts
import type { RowDataPacket } from "mysql2";

type Params = { id: string };

export async function GET(
  _req: NextRequest,
  context: { params: Promise<Params> } // ← Next attend params en Promise
) {
  try {
    const { id } = await context.params; // ← on "await" les params
    const deptId = Number(id);

    if (!Number.isFinite(deptId)) {
      return NextResponse.json(
        { error: "Paramètre 'id' invalide." },
        { status: 400 }
      );
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `
        SELECT
          id AS user_id,
          name,
          email,
          NULL AS title
        FROM users
        WHERE department_id = ?
        ORDER BY name ASC
      `,
      [deptId]
    );

    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
