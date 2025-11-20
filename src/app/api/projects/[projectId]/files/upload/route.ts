// app/api/projects/[projectId]/files/upload/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../../lib/auth";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

/**
 * Stocke les métadonnées dans project_files
 * et le binaire dans project_file_blobs(project_file_id, content LONGBLOB).
 *
 * Table complémentaire :
 *   CREATE TABLE IF NOT EXISTS project_file_blobs (
 *     id BIGINT AUTO_INCREMENT PRIMARY KEY,
 *     project_file_id BIGINT NOT NULL,
 *     content LONGBLOB NOT NULL,
 *     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 *     INDEX (project_file_id),
 *     FOREIGN KEY (project_file_id) REFERENCES project_files(id) ON DELETE CASCADE
 *   );
 */

type JwtPayload = {
  sub?: string | number;
  [k: string]: unknown;
};

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim();
    if (key) acc[key] = decodeURIComponent(value || "");
    return acc;
  }, {});
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // 👉 Next.js 15 : params est un Promise
    const { projectId } = await params;

    // ✅ Récupération du token via l'en-tête Cookie (compat toutes versions)
    const cookieHeader = req.headers.get("cookie");
    const cookieMap = parseCookies(cookieHeader);

    const bearer = req.headers.get("authorization");
    const token =
      cookieMap[SESSION_COOKIE_NAME] ||
      (bearer && bearer.toLowerCase().startsWith("bearer ")
        ? bearer.slice(7).trim()
        : null);

    const payloadRaw = token ? await verifyJwt(token) : null;
    const payload: JwtPayload | null = (payloadRaw ?? null) as JwtPayload | null;

    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const pid = Number(projectId);
    if (!Number.isFinite(pid)) {
      return NextResponse.json({ error: "projectId invalide" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Seuls les PDF sont acceptés" },
        { status: 400 }
      );
    }

    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const userId =
        typeof payload.sub === "string"
          ? Number(payload.sub)
          : typeof payload.sub === "number"
          ? payload.sub
          : null;

      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO project_files (project_id, user_id, storage_path, original_name, mime_type, size_bytes)
         VALUES (?, ?, NULL, ?, ?, ?)`,
        [pid, userId, file.name, file.type || "application/pdf", buf.length]
      );

      const fileId = res.insertId;

      await conn.query<ResultSetHeader>(
        "INSERT INTO project_file_blobs (project_file_id, content) VALUES (?, ?)",
        [fileId, buf]
      );

      await conn.commit();

      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, project_id, user_id, storage_path, original_name, mime_type, size_bytes, uploaded_at
         FROM project_files
         WHERE id = ?`,
        [fileId]
      );

      const fileRow = rows[0] ?? null;
      if (!fileRow) {
        return NextResponse.json(
          { error: "Fichier inséré mais introuvable" },
          { status: 500 }
        );
      }

      return NextResponse.json({ file: fileRow });
    } catch (err: unknown) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
      throw err;
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Erreur upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
