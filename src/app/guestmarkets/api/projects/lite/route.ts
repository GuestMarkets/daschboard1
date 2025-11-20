export const runtime = "nodejs";

import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { ok, err, toId } from "../../_utils";

// Typage fort de la ligne retournée par MySQL
interface ProjectRow extends RowDataPacket {
  id: number;
  name: string;
  code: string;
}

// GET ?userId= (optionnel) ⇒ projets où user est assigné OU manager
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const userIdParam = url.searchParams.get("userId");
    const userId = toId(userIdParam);

    if (userId != null) {
      const [rows] = await pool.execute<ProjectRow[]>(
        `SELECT DISTINCT p.id, p.name, p.code
           FROM projects p
      LEFT JOIN project_assignees pa ON pa.project_id = p.id
          WHERE pa.user_id = ? OR p.manager_id = ?
       ORDER BY p.end_date ASC, p.name ASC`,
        [userId, userId]
      );
      return ok({ items: rows });
    } else {
      const [rows] = await pool.execute<ProjectRow[]>(
        `SELECT p.id, p.name, p.code
           FROM projects p
       ORDER BY p.end_date ASC, p.name ASC`
      );
      return ok({ items: rows });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}
