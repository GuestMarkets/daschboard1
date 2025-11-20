export const runtime = "nodejs";

import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { ok, err, toId, getMe } from "../../_utils";

// GET ?departmentId= (optionnel)
// défaut: service du user courant
export async function GET(req: Request) {
  try {
    const me = await getMe();
    const url = new URL(req.url);
    const dep = toId(url.searchParams.get("departmentId")) ?? me.department_id;

    if (!dep) {
      return ok({ items: [] });
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, email 
         FROM users
        WHERE department_id = ?
        ORDER BY name ASC`,
      [dep]
    );

    return ok({ items: rows });
  } catch (error: unknown) {
    if (error instanceof Error) {
      return err(error.message, 500);
    }
    return err("Erreur inconnue", 500);
  }
}
