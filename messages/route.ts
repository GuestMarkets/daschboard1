// app/api/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";

// ✅ Définition des types pour plus de clarté
interface MessageRow extends RowDataPacket {
  id: number;
  senderId: number | null;
  recipientId: number;
  subject: string | null;
  body: string;
  createdAt: string;
}

interface MessagePayload {
  recipientId: number;
  subject?: string | null;
  body: string;
  senderId?: number | null;
}

export async function POST(req: NextRequest) {
  try {
    const { recipientId, subject, body, senderId }: MessagePayload = await req.json();

    if (!recipientId || !body || String(body).trim() === "") {
      return NextResponse.json({ error: "recipientId et body requis" }, { status: 400 });
    }

    // ✅ Insertion du message
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO messages (sender_id, recipient_id, subject, body)
       VALUES (?, ?, ?, ?)`,
      [senderId ?? null, Number(recipientId), subject ?? null, body]
    );

    const insertId = result.insertId;

    // ✅ Récupération du message inséré
    const [rows] = await pool.query<MessageRow[]>(
      `SELECT id, sender_id AS senderId, recipient_id AS recipientId, subject, body, created_at AS createdAt
       FROM messages WHERE id = ?`,
      [insertId]
    );

    const message = rows[0];

    return NextResponse.json({ message });
  } catch (e) {
    const error = e instanceof Error ? e.message : "DB error";
    return NextResponse.json({ error }, { status: 500 });
  }
}
