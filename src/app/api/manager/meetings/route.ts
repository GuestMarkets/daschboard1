// app/api/meetings/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { requireManager } from "../../../../../lib/manager";
import type { RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";
export const revalidate = 0;

// Typage des lignes renvoyées par la requête SQL
interface MeetingRow extends RowDataPacket {
  id: number | string;
  title: string;
  description: string | null;
  start_at: string | Date;
  end_at: string | Date;
}

export async function GET() {
  try {
    const { userId } = await requireManager();
    const pool = getPool();

    // On utilise RowDataPacket[] pour satisfaire la contrainte QueryResult,
    // puis on affine en MeetingRow[] ensuite.
    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT
        e.id,
        e.title,
        e.description,
        e.start_at,
        e.end_at
      FROM calendar_events e
      INNER JOIN calendar_event_attendees a ON a.event_id = e.id
      WHERE a.user_id = :uid
        AND e.type = 'meeting'
      ORDER BY e.start_at DESC, e.id DESC
      `,
      { uid: userId }
    );

    const typedRows = rows as MeetingRow[];

    const out = typedRows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      description: r.description ?? "",
      startAt: r.start_at,
      endAt: r.end_at,
      // champs pour le tableau du modal (homogènes avec tâches)
      priority: "Moyenne" as const,
      status: "Programmée" as const,
      progress: 0,
      deadline: r.start_at,
    }));

    return NextResponse.json(out, { status: 200 });
  } catch (err: unknown) {
    let status = 500;
    let msg = "Server error";

    if (err instanceof Error) {
      if (err.message === "Forbidden") {
        status = 403;
        msg = "Forbidden";
      } else if (err.message === "Unauthorized") {
        status = 401;
        msg = "Unauthorized";
      }
    }

    return NextResponse.json({ error: msg }, { status });
  }
}
