// app/api/manager/projects/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { requireManager } from "../../../../../lib/manager";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
// Désactive tout cache côté serveur pour cette route
export const revalidate = 0;

/** OPTIONS: utile si un client fait une préflight request (CORS) */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      Vary: "Origin",
    },
  });
}

/** Types SQL (compatibles mysql2) */
type NullableDate = string | Date | null;

interface ProjectRow extends RowDataPacket {
  id: number;
  name: string;
  code: string;
  status: string;
  start_date: NullableDate;
  end_date: NullableDate;
  progress: number | null;
  updated_at: string | Date;
}

interface TeamCountRow extends RowDataPacket {
  project_id: number;
  team_count: number;
}

type ProjectWithCount = Omit<ProjectRow, keyof RowDataPacket> & { team_count: number };

export async function GET() {
  try {
    const { userId } = await requireManager();
    const pool = getPool();

    const [projects] = await pool.query<ProjectRow[]>(
      `
      SELECT
        p.id,
        p.name,
        p.code,
        p.status,
        p.start_date,
        p.end_date,
        p.progress,
        p.updated_at
      FROM projects p
      INNER JOIN project_assignments pa
        ON pa.project_id = p.id
      WHERE pa.user_id = :uid
      ORDER BY p.updated_at DESC, p.id DESC
      `,
      { uid: userId }
    );

    // Compteur d'équipes par projet (créées par ce manager)
    const [teamCounts] = await pool.query<TeamCountRow[]>(
      `
      SELECT ptr.project_id, COUNT(DISTINCT ptr.team_id) AS team_count
      FROM project_team_roles ptr
      INNER JOIN teams t ON t.id = ptr.team_id
      WHERE t.created_by = :uid
      GROUP BY ptr.project_id
      `,
      { uid: userId }
    );

    const mapCounts = new Map<number, number>();
    for (const r of teamCounts) {
      mapCounts.set(Number(r.project_id), Number(r.team_count));
    }

    const out: ProjectWithCount[] = projects.map((p) => ({
      // on copie les champs "données" (RowDataPacket est interface marqueur)
      id: p.id,
      name: p.name,
      code: p.code,
      status: p.status,
      start_date: p.start_date,
      end_date: p.end_date,
      progress: p.progress,
      updated_at: p.updated_at,
      team_count: mapCounts.get(Number(p.id)) ?? 0,
    }));

    return NextResponse.json(
      { projects: out },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          Vary: "Origin",
        },
      }
    );
  } catch (err: unknown) {
    const msgRaw =
      err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const msg =
      msgRaw === "Forbidden"
        ? "Forbidden"
        : msgRaw === "Unauthorized"
        ? "Unauthorized"
        : "Server error";

    const status = msg === "Server error" ? 500 : msg === "Unauthorized" ? 401 : 403;

    return NextResponse.json(
      { error: msg },
      {
        status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          Vary: "Origin",
        },
      }
    );
  }
}
