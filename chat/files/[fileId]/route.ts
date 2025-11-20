export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import type { RowDataPacket } from "mysql2";

export async function GET(_req: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    // Next.js 15 → params est une Promise
    const { fileId } = await context.params;

    const fid = Number(fileId);
    if (!fid) {
      return new NextResponse("Bad Request", { status: 400 });
    }

    const [m] = await pool.query<RowDataPacket[]>(
      `SELECT f.original_name, f.mime_type, b.content
       FROM chat_files f
       JOIN chat_file_blobs b ON b.file_id = f.id
       WHERE f.id = ? LIMIT 1`,
      [fid]
    );

    if (!m.length) {
      return new NextResponse("Not found", { status: 404 });
    }

    const mime = (m[0].mime_type as string) || "application/pdf";

    const buf = Buffer.from(m[0].content as Buffer);

    return new NextResponse(buf, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(
          m[0].original_name
        )}"`
      }
    });
  } catch (err) {
    console.error(err);
    return new NextResponse("Server error", { status: 500 });
  }
}
