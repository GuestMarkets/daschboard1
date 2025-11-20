export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { requireUser, userCanReadChannel, userCanWriteChannel } from "../_utils";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { publish } from "../../../../../lib/chatBus";

function toId(v: any) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : NaN;
}

export async function GET(req: Request) {
  try {
    const { userId, isSuper } = await requireUser();
    const url = new URL(req.url);
    const channelId = toId(url.searchParams.get("channelId"));
    if (!Number.isFinite(channelId)) {
      return NextResponse.json({ error: "channelId requis" }, { status: 400 });
    }

    const since = url.searchParams.get("since"); // ISO ou messageId
    if (!(await userCanReadChannel(userId, channelId, isSuper))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let sql = `
      SELECT m.id, m.channel_id, m.from_user_id, u.name AS from_name, m.body, m.created_at, m.updated_at, m.deleted_at
      FROM chat_messages m
      JOIN users u ON u.id=m.from_user_id
      WHERE m.channel_id=? AND m.deleted_at IS NULL`;
    const params: any[] = [channelId];

    if (since && /^\d+$/.test(since)) {
      sql += " AND m.id > ?";
      params.push(Number(since));
    } else if (since) {
      const d = new Date(since);
      if (!isNaN(+d)) {
        sql += " AND m.created_at > ?";
        params.push(d);
      }
    }

    sql += " ORDER BY m.created_at ASC, m.id ASC LIMIT 200";
    const [rows] = await pool.query<RowDataPacket[]>(sql, params);

    const ids = rows.map(r => r.id);
    let files: any[] = [];
    if (ids.length) {
      const [f] = await pool.query<RowDataPacket[]>(
        `SELECT f.id, f.message_id, f.original_name, f.mime_type, f.size_bytes
         FROM chat_files f
         WHERE f.message_id IN (${ids.map(()=>"?").join(",")})`,
        ids
      );
      files = f as any[];
    }

    return NextResponse.json({ items: rows, files });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: e?.status || 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId, isSuper } = await requireUser();
    // récup nom pour SSE
    const [urow] = await pool.query<RowDataPacket[]>("SELECT name FROM users WHERE id=? LIMIT 1", [userId]);
    const fromName = (urow[0]?.name as string) || "Utilisateur";

    const ct = req.headers.get("content-type") || "";

    // ====== Multipart: fichier PDF (avec texte optionnel) ======
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const channelId = toId(fd.get("channelId"));
      const text = (String(fd.get("text") || "") || null);
      const file = fd.get("file") as File | null;

      if (!Number.isFinite(channelId)) return NextResponse.json({ error: "channelId requis" }, { status: 400 });
      if (!(await userCanWriteChannel(userId, channelId as number, isSuper))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!file) return NextResponse.json({ error: "file requis" }, { status: 400 });
      if (file.type !== "application/pdf") return NextResponse.json({ error: "PDF uniquement" }, { status: 400 });

      const [r] = await pool.query<ResultSetHeader>(
        "INSERT INTO chat_messages(channel_id,from_user_id,body) VALUES(?,?,?)",
        [channelId, userId, text]
      );
      const msgId = Number(r.insertId);

      const ab = Buffer.from(await file.arrayBuffer());
      const [rf] = await pool.query<ResultSetHeader>(
        "INSERT INTO chat_files(message_id,original_name,mime_type,size_bytes) VALUES(?,?,?,?)",
        [msgId, file.name, file.type, ab.byteLength]
      );
      const fileId = Number(rf.insertId);
      await pool.query("INSERT INTO chat_file_blobs(file_id,content) VALUES(?,?)", [fileId, ab]);

      publish(channelId as number, {
        id: msgId,
        channel_id: channelId,
        from_user_id: userId,
        from_name: fromName,
        body: text,
        created_at: new Date().toISOString(),
        files: [{ id: fileId, message_id: msgId, original_name: file.name, mime_type: file.type, size_bytes: ab.byteLength }],
      });

      return NextResponse.json({ ok: true, id: msgId, fileId });
    }

    // ====== JSON: message texte ======
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON requis" }, { status: 400 });
    const channelId = toId(body.channelId);
    const text = String(body.text || "").trim();
    if (!Number.isFinite(channelId) || !text) return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
    if (!(await userCanWriteChannel(userId, channelId as number, isSuper))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [r] = await pool.query<ResultSetHeader>(
      "INSERT INTO chat_messages(channel_id,from_user_id,body) VALUES(?,?,?)",
      [channelId, userId, text]
    );
    const msgId = Number(r.insertId);

    publish(channelId as number, {
      id: msgId,
      channel_id: channelId,
      from_user_id: userId,
      from_name: fromName,
      body: text,
      created_at: new Date().toISOString(),
      files: [],
    });

    return NextResponse.json({ ok: true, id: msgId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: e?.status || 500 });
  }
}
