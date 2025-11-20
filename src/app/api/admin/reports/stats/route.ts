export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../../../lib/db";
import { getMe } from "../../../_utils";

/**
 * Lignes renvoyées par les agrégations SQL
 */
interface StatusRow extends RowDataPacket {
  status: string;
  c: number | string; // COUNT(*) peut revenir typé string selon le driver
}

/**
 * Objet de stats retourné par l’API
 * On garde un Record<string, number> pour tolérer d’éventuels statuts supplémentaires,
 * tout en initialisant ceux attendus.
 */
type Stats = Record<string, number>;

/**
 * GET /api/admin/reports/stats?scope=all|received
 * Exclut "draft" des décomptes
 */
export async function GET(req: Request) {
  try {
    await getMe();
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") ?? "all";

    if (scope === "received") {
      const [rows] = await pool.query<StatusRow[]>(
        `SELECT rr.status, COUNT(*) AS c
           FROM report_recipients rr
           JOIN reports r ON r.id = rr.report_id
          WHERE r.status <> 'draft'
          GROUP BY rr.status`
      );
      return NextResponse.json(sumStats(rows));
    }

    const [rows] = await pool.query<StatusRow[]>(
      `SELECT r.status, COUNT(*) AS c
         FROM reports r
        WHERE r.status <> 'draft'
        GROUP BY r.status`
    );
    return NextResponse.json(sumStats(rows));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function sumStats(rows: ReadonlyArray<StatusRow>): Stats {
  const stats: Stats = {
    total: 0,
    submitted: 0,
    under_review: 0,
    approved: 0,
    rejected: 0,
    changes_requested: 0,
  };

  for (const r of rows) {
    const status = String(r.status);
    const count = Number(r.c);
    stats[status] = (stats[status] ?? 0) + count;
    stats.total += count;
  }

  return stats;
}
