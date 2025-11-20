export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import type { RowDataPacket } from "mysql2";

// Typage de la ligne renvoyée par la requête
interface ProjectRow extends RowDataPacket {
  project_id: number;
  project_code: string;
  project_name: string;
  team_role: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
): Promise<Response> {
  try {
    // Avec Next.js (versions récentes), params est un Promise
    const { teamId } = await params;

    const tid = Number(teamId);
    if (!Number.isFinite(tid)) {
      return NextResponse.json(
        { error: "Paramètre teamId invalide" },
        { status: 400 }
      );
    }

    // On précise le type des lignes attendues
    const [rows] = await pool.query<ProjectRow[]>(
      `
        SELECT
          ptr.project_id,
          p.code AS project_code,
          p.name AS project_name,
          ptr.team_role
        FROM project_team_roles ptr
        JOIN projects p ON p.id = ptr.project_id
        WHERE ptr.team_id = ?
        ORDER BY p.created_at DESC
      `,
      [tid]
    );

    return NextResponse.json({ items: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
