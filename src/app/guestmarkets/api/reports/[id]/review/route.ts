export const runtime = "nodejs";

import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { NextRequest } from "next/server";
import { pool } from "../../../../../../../lib/db"; // ← 7 niveaux
import { ok, err, getMe } from "../../../_utils";

// Actions autorisées (typage strict)
const ALLOWED_ACTIONS = ["approved", "rejected", "changes_requested"] as const;
type ReportAction = (typeof ALLOWED_ACTIONS)[number];

// Typage de la ligne retournée par report_recipients
interface RecipientRow extends RowDataPacket {
  status: string;
}

// Typage du corps de requête attendu
interface PostPayload {
  action: string;
  message?: string;
}

// POST { action: 'approved'|'rejected'|'changes_requested', message?: string }
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // ← attendu par ton RouteHandlerConfig
) {
  try {
    const me = await getMe();

    // Récupération sûre de l'id dynamiquement (params est une Promise)
    const { id: idParam } = await context.params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return err("ID invalide", 400);
    }

    // Lecture "safe" du body sans `any`
    let bodyUnknown: unknown = {};
    try {
      bodyUnknown = await req.json();
    } catch {
      // Body vide ou JSON invalide → bodyUnknown reste {}
    }

    const body =
      typeof bodyUnknown === "object" && bodyUnknown !== null
        ? (bodyUnknown as Partial<PostPayload>)
        : ({} as Partial<PostPayload>);

    const rawAction = typeof body.action === "string" ? body.action : "";
    if (!ALLOWED_ACTIONS.includes(rawAction as ReportAction)) {
      return err("Action invalide", 400);
    }
    const action: ReportAction = rawAction as ReportAction;

    // Vérifie que l'utilisateur est destinataire du rapport
    const [rows] = await pool.execute<RecipientRow[]>(
      `SELECT status
         FROM report_recipients
        WHERE report_id = ? AND user_id = ?
        LIMIT 1`,
      [id, me.id]
    );

    if (!rows[0]) {
      return err("Accès interdit", 403);
    }

    // Mise à jour du statut du destinataire
    await pool.execute<ResultSetHeader>(
      `UPDATE report_recipients
          SET status = ?, unread = 0, decided_at = NOW()
        WHERE report_id = ? AND user_id = ?`,
      [action, id, me.id]
    );

    // Mise à jour du statut global du rapport
    await pool.execute<ResultSetHeader>(
      `UPDATE reports
          SET status = ?, updated_at = NOW()
        WHERE id = ?`,
      [action, id]
    );

    // Insertion éventuelle d'un commentaire
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message) {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO report_comments (report_id, user_id, text, created_at)
         VALUES (?, ?, ?, NOW())`,
        [id, me.id, message]
      );
    }

    return ok({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}
