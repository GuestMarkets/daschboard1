export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../../../lib/db"; // 7 niveaux
import { err, getMe } from "../../../../_utils";

// Types stricts pour les résultats SQL
type MetaRow = RowDataPacket & {
  id: number;
  report_id: number;
  original_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  author_id: number;
};

type RcptRow = RowDataPacket & {
  ok: number; // SELECT 1 AS ok
};

type BlobRow = RowDataPacket & {
  content: Buffer; // colonne binaire (BLOB)
};

// Signature attendue par Next 14/15 (params as Promise)
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; fileId: string }> }
): Promise<Response> {
  try {
    const me = await getMe();

    // ✅ params est un Promise -> on attend
    const { id, fileId } = await context.params;
    // (id) peut servir à des audits/contrôles, mais on ne l’utilise pas ici.
    const fileIdNum = Number(fileId);
    if (!Number.isFinite(fileIdNum)) {
      return err("Identifiant de fichier invalide", 400);
    }

    // Métadonnées du fichier + auteur du rapport
    const [metaRows] = await pool.execute<MetaRow[]>(
      `SELECT rf.id,
              rf.report_id,
              rf.original_name,
              rf.mime_type,
              rf.size_bytes,
              r.author_id
         FROM report_files rf
         JOIN reports r ON r.id = rf.report_id
        WHERE rf.id = ? LIMIT 1`,
      [fileIdNum]
    );
    const m = metaRows[0];
    if (!m) return err("Fichier introuvable", 404);

    // Contrôle d'accès : auteur ou destinataire
    if (Number(m.author_id) !== me.id) {
      const [rcpt] = await pool.execute<RcptRow[]>(
        `SELECT 1 AS ok
           FROM report_recipients
          WHERE report_id = ? AND user_id = ?
          LIMIT 1`,
        [Number(m.report_id), me.id]
      );
      if (!rcpt[0]?.ok) return err("Accès interdit", 403);
    }

    // Récupération du blob
    const [blobRows] = await pool.execute<BlobRow[]>(
      `SELECT content
         FROM report_file_blobs
        WHERE report_file_id = ?
        LIMIT 1`,
      [fileIdNum]
    );
    const b = blobRows[0];
    if (!b) return err("Contenu manquant", 404);

    // Headers
    const contentType =
      m.mime_type && m.mime_type.trim()
        ? m.mime_type
        : "application/octet-stream";

    const declaredLength = Number.isFinite(m.size_bytes ?? NaN)
      ? Number(m.size_bytes)
      : undefined;

    const safeName = String(m.original_name ?? "file").replace(/"/g, "'");

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", `inline; filename="${safeName}"`);
    headers.set("X-Content-Type-Options", "nosniff");

    // Longueur : valeur stockée si dispo, sinon taille réelle
    const actualLength = b.content.byteLength;
    headers.set("Content-Length", String(declaredLength ?? actualLength));

    // ✅ Corps en Uint8Array (BodyInit valide côté Node runtime)
    const body = new Uint8Array(b.content);

    return new NextResponse(body, { headers });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}
