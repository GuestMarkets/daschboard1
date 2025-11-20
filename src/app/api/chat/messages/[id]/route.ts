export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../_utils";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { publish } from "../../../../../../lib/chatBus";

function toId(v: any) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : NaN;
}


async function canEditMessage(userId: number, messageId: number, isSuper: boolean): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT from_user_id, created_at, deleted_at FROM chat_messages WHERE id = ? LIMIT 1`,
    [messageId]
  );

  if (!rows.length || rows[0].deleted_at) return false;


  if (rows[0].from_user_id !== userId && !isSuper) return false;


  if (isSuper) return true;

  const createdAt = new Date(rows[0].created_at);
  const now = new Date();
  const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);

  return diffMinutes <= 15;
}

async function getChatSettings(): Promise<{ allowMessageDeletion: boolean }> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT setting_key, setting_value FROM chat_settings WHERE setting_key = 'allow_message_deletion' LIMIT 1`
    );
    return {
      allowMessageDeletion: rows.length > 0 ? rows[0].setting_value === 'true' : false
    };
  } catch {
   
    return { allowMessageDeletion: false };
  }
}

interface RouteContext {
  params: Promise<{ id: string }>;
}


export async function PUT(req: Request, context: RouteContext) {
  try {
    const { userId, isSuper } = await requireUser();
    const params = await context.params;
    const messageId = toId(params.id);

    if (!Number.isFinite(messageId)) {
      return NextResponse.json({ error: "ID de message invalide" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.text?.trim()) {
      return NextResponse.json({ error: "Texte requis" }, { status: 400 });
    }

    if (!(await canEditMessage(userId, messageId as number, isSuper))) {
      return NextResponse.json({
        error: "Message non modifiable (15min dépassées ou pas votre message)"
      }, { status: 403 });
    }


    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE chat_messages SET body = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [body.text.trim(), messageId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Message introuvable" }, { status: 404 });
    }


    const [msgRows] = await pool.query<RowDataPacket[]>(
      `SELECT m.channel_id, u.name AS from_name FROM chat_messages m
       JOIN users u ON u.id = m.from_user_id WHERE m.id = ? LIMIT 1`,
      [messageId]
    );

    if (msgRows.length > 0) {

      publish(msgRows[0].channel_id, {
        type: 'message_updated',
        id: messageId,
        channel_id: msgRows[0].channel_id,
        from_user_id: userId,
        from_name: msgRows[0].from_name,
        body: body.text.trim(),
        updated_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true, message: "Message modifié" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}


export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { userId, isSuper } = await requireUser();
    const params = await context.params;
    const messageId = toId(params.id);

    if (!Number.isFinite(messageId)) {
      return NextResponse.json({ error: "ID de message invalide" }, { status: 400 });
    }

    const settings = await getChatSettings();

  
    const canEdit = await canEditMessage(userId, messageId as number, isSuper);
    if (!canEdit && !settings.allowMessageDeletion) {
      return NextResponse.json({
        error: "Suppression non autorisée (15min dépassées ou paramètre admin désactivé)"
      }, { status: 403 });
    }


    const [msgRows] = await pool.query<RowDataPacket[]>(
      `SELECT channel_id, from_user_id FROM chat_messages WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [messageId]
    );

    if (!msgRows.length) {
      return NextResponse.json({ error: "Message introuvable" }, { status: 404 });
    }

 
    if (msgRows[0].from_user_id !== userId && !isSuper) {
      return NextResponse.json({ error: "Vous ne pouvez supprimer que vos propres messages" }, { status: 403 });
    }


    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE chat_messages SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [messageId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Message déjà supprimé" }, { status: 404 });
    }

    publish(msgRows[0].channel_id, {
      type: 'message_deleted',
      id: messageId,
      channel_id: msgRows[0].channel_id,
      deleted_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, message: "Message supprimé" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}
