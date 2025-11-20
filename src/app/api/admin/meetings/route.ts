// app/api/admin/meetings/route.ts
import { NextRequest } from "next/server";
import { num, ok, err, exec, SqlParam } from "../_utils";

/** Type représentant une ligne retournée par la requête SQL */
type MeetingRow = {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  notes: string | null;
  status: string;
  owner_id: number;
  owner_name: string | null;
} & Record<string, unknown>; // pour correspondre à DbRow

/** GET /api/admin/meetings?user_id=... */
export async function GET(req: NextRequest) {
  try {
    const userId = num(req.nextUrl.searchParams.get("user_id"));

    let where = "WHERE 1=1";
    const params: SqlParam[] = [];

    if (userId != null) {
      where += " AND (m.user_id = ?)";
      params.push(userId);
    }

    const rows = await exec<MeetingRow>(
      `
        SELECT
          m.id,
          m.title,
          m.start_at,
          m.end_at,
          m.location,
          m.notes,
          m.status,
          m.user_id AS owner_id,
          u.name   AS owner_name
        FROM planning_meetings m
        LEFT JOIN users u ON u.id = m.user_id
        ${where}
        ORDER BY m.start_at ASC
      `,
      params
    );

    return ok({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur interne";
    return err(message);
  }
}
