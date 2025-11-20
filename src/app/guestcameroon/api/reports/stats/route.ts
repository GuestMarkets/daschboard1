export const runtime = "nodejs";

import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { ok, err, toId } from "../../_utils";

// Définition d’un type utilitaire pour les arguments SQL
type SqlArg = string | number;

// GET /reports/stats?user_id=&projectId=
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = toId(url.searchParams.get("user_id"));
    const projectId = toId(url.searchParams.get("projectId"));

    const args: SqlArg[] = [];
    let where = "1=1";

    if (userId) {
      where += " AND r.author_id = ?";
      args.push(userId);
    }

    if (projectId) {
      where += " AND r.project_id = ?";
      args.push(projectId);
    }

    const [byStatus] = await pool.execute<RowDataPacket[]>(
      `SELECT r.status, COUNT(*) AS cnt
         FROM reports r
        WHERE ${where}
        GROUP BY r.status`,
      args
    );

    const [byType] = await pool.execute<RowDataPacket[]>(
      `SELECT r.type, COUNT(*) AS cnt
         FROM reports r
        WHERE ${where}
        GROUP BY r.type`,
      args
    );

    const total = byStatus.reduce(
      (sum, row) => sum + Number(row.cnt || 0),
      0
    );

    return ok({ total, byStatus, byType });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Erreur inconnue lors de la récupération des rapports";
    return err(message, 500);
  }
}
