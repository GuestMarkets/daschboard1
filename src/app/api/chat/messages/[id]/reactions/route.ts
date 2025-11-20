export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../_utils";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { publish } from "../../../../../../../lib/chatBus";

function toId(v: any) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : NaN;
}


const ALLOWED_EMOJIS = [
  '👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🎉', '👏', '🔥',
  '✅', '❌', '⭐', '💡', '🤔', '👀', '💪', '🙏', '😊', '😕'
];

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { userId } = await requireUser();
    const params = await context.params;
    const messageId = toId(params.id);

    if (!Number.isFinite(messageId)) {
      return NextResponse.json({ error: "ID de message invalide" }, { status: 400 });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.emoji, COUNT(*) as count,
              GROUP_CONCAT(u.name) as user_names,
              MAX(CASE WHEN r.user_id = ? THEN 1 ELSE 0 END) as user_reacted
       FROM chat_message_reactions r
       JOIN users u ON u.id = r.user_id
       WHERE r.message_id = ?
       GROUP BY r.emoji
       ORDER BY count DESC, r.emoji`,
      [userId, messageId]
    );

    const reactions = rows.map(row => ({
      emoji: row.emoji,
      count: Number(row.count),
      userNames: row.user_names ? row.user_names.split(',') : [],
      userReacted: Boolean(row.user_reacted)
    }));

    return NextResponse.json({ reactions });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}


export async function POST(req: Request, context: RouteContext) {
  try {
    const { userId } = await requireUser();
    const params = await context.params;
    const messageId = toId(params.id);

    if (!Number.isFinite(messageId)) {
      return NextResponse.json({ error: "ID de message invalide" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.emoji) {
      return NextResponse.json({ error: "Emoji requis" }, { status: 400 });
    }

    if (!ALLOWED_EMOJIS.includes(body.emoji)) {
      return NextResponse.json({ error: "Emoji non autorisé" }, { status: 400 });
    }

    const [msgRows] = await pool.query<RowDataPacket[]>(
      `SELECT channel_id FROM chat_messages WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [messageId]
    );

    if (!msgRows.length) {
      return NextResponse.json({ error: "Message introuvable" }, { status: 404 });
    }

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM chat_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ? LIMIT 1`,
      [messageId, userId, body.emoji]
    );

    if (existing.length > 0) {
      return NextResponse.json({ error: "Réaction déjà ajoutée" }, { status: 400 });
    }

    await pool.query<ResultSetHeader>(
      `INSERT INTO chat_message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, NOW())`,
      [messageId, userId, body.emoji]
    );

    const [reactionStats] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM chat_message_reactions WHERE message_id = ? AND emoji = ?`,
      [messageId, body.emoji]
    );

    publish(msgRows[0].channel_id, {
      type: 'reaction_added',
      message_id: messageId,
      channel_id: msgRows[0].channel_id,
      emoji: body.emoji,
      user_id: userId,
      count: Number(reactionStats[0]?.count || 1),
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      message: "Réaction ajoutée",
      count: Number(reactionStats[0]?.count || 1)
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}


export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { userId } = await requireUser();
    const params = await context.params;
    const messageId = toId(params.id);

    if (!Number.isFinite(messageId)) {
      return NextResponse.json({ error: "ID de message invalide" }, { status: 400 });
    }

    const url = new URL(req.url);
    const emoji = url.searchParams.get('emoji');

    if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
      return NextResponse.json({ error: "Emoji invalide" }, { status: 400 });
    }

    const [msgRows] = await pool.query<RowDataPacket[]>(
      `SELECT channel_id FROM chat_messages WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [messageId]
    );

    if (!msgRows.length) {
      return NextResponse.json({ error: "Message introuvable" }, { status: 404 });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM chat_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`,
      [messageId, userId, emoji]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Réaction introuvable" }, { status: 404 });
    }

    const [reactionStats] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM chat_message_reactions WHERE message_id = ? AND emoji = ?`,
      [messageId, emoji]
    );

    publish(msgRows[0].channel_id, {
      type: 'reaction_removed',
      message_id: messageId,
      channel_id: msgRows[0].channel_id,
      emoji: emoji,
      user_id: userId,
      count: Number(reactionStats[0]?.count || 0),
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      message: "Réaction retirée",
      count: Number(reactionStats[0]?.count || 0)
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
