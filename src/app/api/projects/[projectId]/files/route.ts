// app/api/projects/[projectId]/files/route.ts
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/** Type d’une ligne de project_files */
type ProjectFileRow = RowDataPacket & {
  id: number;
  project_id: number;
  user_id: number | null;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
};

/** Corps attendu pour le POST */
interface UploadMeta {
  originalName: string;
  mimeType?: string;
  sizeBytes?: number;
  storagePath: string;
}

/** Type du payload JWT */
type JwtPayload = Awaited<ReturnType<typeof verifyJwt>>;

/** Extraction sécurisée du message d’erreur */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return "Erreur inconnue";
  }
}

/** Types minimaux pour l'accès aux cookies (sans dépendre d'APIs internes instables) */
type Cookie = { name: string; value: string };
type CookieStore = { get: (name: string) => Cookie | undefined };

/** Type guard pour Promise-like, sans utiliser `any` ni `Function` */
function isPromiseLike<T>(val: unknown): val is PromiseLike<T> {
  return (
    typeof val === "object" &&
    val !== null &&
    "then" in val &&
    typeof (val as PromiseLike<T>).then === "function"
  );
}

/** Helper robuste : gère cookies() sync et async, sans any/Function/ts-comments */
async function getCookieStore(): Promise<CookieStore> {
  const c = cookies() as unknown;
  if (isPromiseLike<CookieStore>(c)) {
    return await c;
  }
  return c as CookieStore;
}

/** Next.js 15+: params est un Promise<{ projectId: string }> */
type RouteParams = { params: Promise<{ projectId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await params;
    const pid = Number(projectId);

    const [rows] = await pool.query<ProjectFileRow[]>(
      `SELECT id, project_id, user_id, storage_path, original_name, mime_type, size_bytes, uploaded_at
       FROM project_files WHERE project_id=? ORDER BY id DESC LIMIT 50`,
      [pid]
    );

    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await params;
    const pid = Number(projectId);

    // ✅ compatible env où cookies() est Promise OU sync
    const ck = await getCookieStore();

    const authHeader = req.headers.get("authorization");
    const bearer =
      authHeader && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : null;

    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? bearer ?? null;
    const payload: JwtPayload = token ? await verifyJwt(token) : null;

    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = (await req.json()) as UploadMeta;
    const { originalName, mimeType, sizeBytes, storagePath } = body;

    if (!originalName || !storagePath) {
      return NextResponse.json(
        { error: "originalName & storagePath requis" },
        { status: 400 }
      );
    }

    const sub = (payload as Record<string, unknown>)?.sub;
    const userId =
      typeof sub === "string" && Number.isFinite(Number(sub)) ? Number(sub) : null;

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO project_files (project_id, user_id, storage_path, original_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        pid,
        userId,
        String(storagePath),
        String(originalName),
        mimeType ?? "application/octet-stream",
        Number(sizeBytes ?? 0),
      ]
    );

    const [rows] = await pool.query<ProjectFileRow[]>(
      `SELECT id, project_id, user_id, storage_path, original_name, mime_type, size_bytes, uploaded_at
       FROM project_files WHERE id=?`,
      [res.insertId]
    );

    return NextResponse.json({ file: rows[0] }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
