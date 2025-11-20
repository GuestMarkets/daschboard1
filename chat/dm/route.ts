export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../_utils";
import type { RowDataPacket } from "mysql2";

function toId(v: any) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : NaN;
}

export async function POST(req: Request) {
  try {
    const { userId } = await requireUser();
    const body = await req.json().catch(() => ({}));
    const otherId = toId(body?.userId);
    if (!Number.isFinite(otherId)) {
      return NextResponse.json({ error: "userId requis" }, { status: 400 });
    }

    const a = Math.min(userId, otherId as number);
    const b = Math.max(userId, otherId as number);

    await pool.query(
      "INSERT IGNORE INTO chat_channels(type,name,dm_user_a,dm_user_b,created_by) VALUES('dm','Discussion privée',?,?,?)",
      [a, b, userId]
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, type, name FROM chat_channels WHERE type='dm' AND dm_user_a=? AND dm_user_b=?",
      [a, b]
    );

    const chanId = rows[0].id as number;
    await pool.query("INSERT IGNORE INTO chat_channel_members(channel_id,user_id) VALUES(?,?),(?,?)", [
      chanId, a, chanId, b,
    ]);

    return NextResponse.json({ channel: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: e?.status || 500 });
  }
}
