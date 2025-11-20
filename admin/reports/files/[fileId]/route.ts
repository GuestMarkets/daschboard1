// app/api/reports/files/[fileId]/route.ts
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../../../../lib/db";      // ← ajuste si besoin
import { getMe } from "../../../../_utils";              // ← ajuste si besoin

/** JSON Buffer tel que renvoyé parfois par MySQL/ORM: { type: "Buffer", data: number[] } */
type BufferLikeJSON = { type: "Buffer"; data: number[] };

/** Type guard pour { type:"Buffer", data:number[] } sans accéder à unknown directement */
function isBufferLikeJSON(v: unknown): v is BufferLikeJSON {
  if (typeof v !== "object" || v === null) return false;

  const maybeRec = v as Record<string, unknown>;
  if (maybeRec.type !== "Buffer") return false;

  const data = maybeRec.data;
  if (!Array.isArray(data)) return false;

  // Vérifie que tous les éléments sont des nombres finis
  return (data as unknown[]).every(
    (n): n is number => typeof n === "number" && Number.isFinite(n)
  );
}

/** Convertit ce qui vient de MySQL en ArrayBuffer "pur" (pas ArrayBufferLike) */
function toArrayBuffer(v: unknown): ArrayBuffer {
  // Buffer Node.js
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) {
    const u8 = v.subarray(0, v.byteLength); // vue propre
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    return ab;
  }
  // Déjà un ArrayBuffer
  if (v instanceof ArrayBuffer) return v;

  // Uint8Array / DataView → copie dans un ArrayBuffer dédié
  if (v instanceof Uint8Array) {
    const ab = new ArrayBuffer(v.byteLength);
    new Uint8Array(ab).set(v);
    return ab;
  }
  if (typeof DataView !== "undefined" && v instanceof DataView) {
    const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    return ab;
  }

  // SharedArrayBuffer → copie dans un ArrayBuffer
  if (typeof SharedArrayBuffer !== "undefined" && v instanceof SharedArrayBuffer) {
    const u8 = new Uint8Array(v);
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    return ab;
  }

  // Objet JSONifié { type:"Buffer", data:number[] }
  if (isBufferLikeJSON(v)) {
    const src = Uint8Array.from(v.data);
    const ab = new ArrayBuffer(src.byteLength);
    new Uint8Array(ab).set(src);
    return ab;
  }

  // Chaîne (base64 ou "binary")
  if (typeof v === "string") {
    const s = v.replace(/\s+/g, "");
    const looksB64 = /^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0;
    const buf = Buffer.from(s, looksB64 ? "base64" : "binary");
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    return ab;
  }

  throw new Error("Unsupported blob format from DB");
}

/** Lignes tapées pour la requête MySQL */
interface ReportFileRow extends RowDataPacket {
  original_name: string | null;
  mime_type: string | null;
  content: unknown;
}

/**
 * GET /api/reports/files/:fileId
 * → Affiche le PDF (ou autre mimetype) inline dans le navigateur
 *
 * ⚠️ Next.js 15: `context.params` est un Promise — il faut `await`.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ fileId: string }> }
) {
  try {
    await getMe(); // commente cette ligne si tu veux tester sans auth

    const { fileId } = await context.params; // ← IMPORTANT sous Next 15
    const id = Number(fileId);
    if (!Number.isFinite(id)) {
      return new Response(JSON.stringify({ error: "Bad id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [rows] = await pool.query<ReportFileRow[]>(
      `SELECT f.original_name, f.mime_type, b.content
         FROM report_files f
         JOIN report_file_blobs b ON b.report_file_id = f.id
        WHERE f.id = ?
        LIMIT 1`,
      [id]
    );

    const f = rows[0];
    if (!f) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ✅ on convertit en ArrayBuffer (pas ArrayBufferLike)
    const ab = toArrayBuffer(f.content);
    const mime = String(f.mime_type || "application/pdf");
    const name = String(f.original_name || "document.pdf");

    // Variante A (directe) : passer l'ArrayBuffer au body
    return new Response(ab, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
        "Content-Length": String(ab.byteLength),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });

    // Variante B (si tu préfères Blob) :
    // const blob = new Blob([ab], { type: mime });
    // return new Response(blob, { status: 200, headers: { ... } });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
