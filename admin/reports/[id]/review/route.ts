export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { pool } from "../../../../../../../lib/db";
import { getMe } from "../../../../_utils";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

type AllowedAction = "approved" | "rejected" | "changes_requested";

interface ReviewBody {
  action?: AllowedAction;
  message?: string;
  setGlobal?: boolean;
}

function isAllowedAction(value: string): value is AllowedAction {
  return value === "approved" || value === "rejected" || value === "changes_requested";
}

/**
 * POST /api/admin/reports/:id/review
 * Body: { action: "approved"|"rejected"|"changes_requested", message?: string, setGlobal?: boolean }
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const me = await getMe();

    // ⚠️ Dans Next.js 15, params est une Promise
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    const body = (await req.json().catch(() => null)) as ReviewBody | null;
    const actionStr = body?.action ?? "";
    if (!isAllowedAction(actionStr)) {
      return NextResponse.json({ error: "Bad action" }, { status: 400 });
    }

    // Vérifier que je suis bien destinataire
    const [existRows] = await pool.query<RowDataPacket[]>(
      `SELECT user_id
         FROM report_recipients
        WHERE report_id = ? AND user_id = ?
        LIMIT 1`,
      [id, me.id]
    );

    if (existRows.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await pool.query<ResultSetHeader>(
      `UPDATE report_recipients
          SET status = ?, decided_at = NOW(), unread = 0
        WHERE report_id = ? AND user_id = ?`,
      [actionStr, id, me.id]
    );

    const trimmedMsg = body?.message?.trim();
    if (trimmedMsg) {
      await pool.query<ResultSetHeader>(
        `INSERT INTO report_comments (report_id, user_id, text)
         VALUES (?, ?, ?)`,
        [id, me.id, trimmedMsg]
      );
    }

    // (Optionnel) setGlobal: calculer et pousser un statut global dans reports
    // if (body?.setGlobal) { ... }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
