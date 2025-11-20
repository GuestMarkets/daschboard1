// app/api/projects/[projectId]/files/[fileId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../lib/db";
import type { ResultSetHeader } from "mysql2";

/**
 * DELETE /api/projects/[projectId]/files/[fileId]
 * Supprime l'entrée project_files par id.
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string; fileId: string }> }
): Promise<Response> {
  try {
    // ⚠️ En Next 15, params est un Promise durant la validation de types
    const { projectId, fileId } = await context.params;

    const fid = Number(fileId);
    if (!Number.isFinite(fid)) {
      return NextResponse.json({ error: "Bad fileId" }, { status: 400 });
    }

    // (Optionnel) vérifier aussi projectId si nécessaire
    // ex: "DELETE FROM project_files WHERE id = ? AND project_id = ?"
    const [res] = await pool.query<ResultSetHeader>(
      "DELETE FROM project_files WHERE id = ?",
      [fid]
    );

    if (res.affectedRows === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Erreur inconnue lors de la suppression";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
