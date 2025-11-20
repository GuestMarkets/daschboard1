export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../lib/db";
import { ok, err, getMe } from "../../../_utils";

type ReportRow = RowDataPacket & { status: string };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const me = await getMe();

    // ⚠️ Next 15/Route Handler: params est un Promise — il faut l'attendre
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return err("Identifiant invalide", 400);
    }

    const [rows] = await pool.execute<ReportRow[]>(
      `SELECT status FROM reports WHERE id=? AND author_id=? LIMIT 1`,
      [id, me.id]
    );

    const r = rows[0];
    if (!r) return err("Accès interdit", 403);

    if (!["draft", "changes_requested"].includes(String(r.status))) {
      return err("Non autorisé dans ce statut", 400);
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return err("Fichier manquant", 400);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";

    const [r1] = await pool.execute<ResultSetHeader>(
      `INSERT INTO report_files (report_id, user_id, original_name, mime_type, size_bytes, uploaded_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [id, me.id, file.name, mime, buf.length]
    );

    await pool.execute<ResultSetHeader>(
      `INSERT INTO report_file_blobs (report_file_id, content) VALUES (?, ?)`,
      [Number(r1.insertId), buf]
    );

    return ok({
      file: {
        id: Number(r1.insertId),
        original_name: file.name,
        mime_type: mime,
        size_bytes: buf.length,
        uploaded_at: new Date().toISOString(),
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur inattendue";
    return err(message, 500);
  }
}
