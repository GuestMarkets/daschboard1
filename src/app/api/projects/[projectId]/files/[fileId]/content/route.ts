// app/api/projects/[projectId]/files/[fileId]/content/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../../lib/db";
import type { RowDataPacket } from "mysql2";

type ParamsNow = { projectId: string; fileId: string };
type ParamsPromise = Promise<ParamsNow>;
type Context = { params: ParamsNow } | { params: ParamsPromise };

async function resolveParams(context: Context): Promise<ParamsNow> {
  const params = (context as { params: ParamsNow | ParamsPromise }).params;
  if (params instanceof Promise) {
    return params;
  }
  return params;
}

export async function GET(_req: NextRequest, context: Context) {
  try {
    const { projectId, fileId } = await resolveParams(context);

    const pid = Number(projectId);
    const fid = Number(fileId);
    if (!Number.isFinite(pid) || !Number.isFinite(fid)) {
      return new NextResponse("Bad request", { status: 400 });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT f.original_name, b.content
      FROM project_files f
      JOIN project_file_blobs b ON b.project_file_id = f.id
      WHERE f.id = ? AND f.project_id = ?
      LIMIT 1
      `,
      [fid, pid]
    );

    if (rows.length === 0) {
      return new NextResponse("Not found", { status: 404 });
    }

    const originalName = String(rows[0].original_name || "document.pdf");
    const buf: Buffer = rows[0].content as Buffer;
    const u8 = new Uint8Array(buf);

    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Content-Length": String(u8.byteLength),
      "Content-Disposition": `inline; filename="${originalName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      "Cache-Control": "private, max-age=3600",
    });

    return new NextResponse(u8, { headers });
  } catch {
    // Pas de variable non utilisée -> on supprime `err`
    return new NextResponse("Server error", { status: 500 });
  }
}
