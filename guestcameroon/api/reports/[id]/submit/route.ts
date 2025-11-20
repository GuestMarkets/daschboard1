export const runtime = "nodejs";

import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { pool } from "../../../../../../../lib/db"; // ← 7 niveaux
import { ok, err, getMe } from "../../../_utils"; // ← vérifie bien ce chemin si besoin

interface ReportStatusRow extends RowDataPacket {
  status: "draft" | "changes_requested" | "submitted" | string;
}

type Params = { id: string };

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const me = await getMe();

    // Avec Next 15+, params est un Promise -> on l'attend
    const { id: idParam } = await params;
    const id = Number(idParam);

    if (!Number.isFinite(id)) {
      return err("ID invalide", 400);
    }

    const [rows] = await pool.execute<ReportStatusRow[]>(
      "SELECT status FROM reports WHERE id=? AND author_id=? LIMIT 1",
      [id, me.id]
    );

    const r = rows[0];
    if (!r) {
      return err("Accès interdit", 403);
    }

    if (r.status !== "draft" && r.status !== "changes_requested") {
      return err("Déjà soumis", 400);
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE reports SET status='submitted', updated_at=NOW() WHERE id=?",
      [id]
    );

    await pool.execute<ResultSetHeader>(
      `UPDATE report_recipients
         SET status='submitted',
             unread=1,
             read_at=NULL,
             decided_at=NULL
       WHERE report_id=?`,
      [id]
    );

    return ok({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}
