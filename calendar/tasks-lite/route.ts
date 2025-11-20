export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { getAuthUserId } from "../../../../../lib/auth_user";
import type { RowDataPacket } from "mysql2/promise";

interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
}

export async function GET(req: Request) {
  try {
    const userId = await getAuthUserId(req);

    if (userId == null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pool = getPool();

    const [rows] = await pool.query<TaskRow[]>(
      `
      SELECT DISTINCT t.id, t.title
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      WHERE t.created_by = ? OR ta.user_id = ?
      ORDER BY t.due_date ASC, t.id DESC
      LIMIT 500
      `,
      [userId, userId]
    );

    const items = rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
    }));

    return NextResponse.json({ items });
  } catch {
    // On ne déclare pas la variable err si on ne l’utilise pas pour éviter l’avertissement ESLint
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
