// app/api/projects/[projectId]/notes/route.ts
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/** Utilitaire pour formater les erreurs inconnues */
function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Erreur";
}

/** Interface minimale pour le store de cookies (évite de dépendre des types internes Next) */
interface CookieStore {
  get(name: string): { value: string } | undefined;
}

/** Compat: Next peut typer cookies() sync OU async selon la version.
 *  Ce helper renvoie toujours un CookieStore utilisable avec .get(...)
 */
async function getCookieStore(): Promise<CookieStore> {
  const maybe = cookies() as unknown;
  // Si c’est une Promise (anciennes defs de type), on attend:
  if (
    typeof maybe === "object" &&
    maybe !== null &&
    "then" in (maybe as Record<string, unknown>)
  ) {
    return (await (maybe as Promise<CookieStore>)) as CookieStore;
  }
  // Sinon c’est déjà le store synchrone:
  return maybe as CookieStore;
}

/** Typage strict d’une note */
interface NoteRow extends RowDataPacket {
  id: number;
  project_id: number;
  user_id: number | null;
  text: string;
  created_at: string; // ou Date selon config mysql
}

/** Typage du payload JWT (adapte selon ta lib d’auth) */
interface JwtPayload {
  sub: string | number;
}

/** Helper pour harmoniser l’accès à context.params (Promise dans Next 15) */
async function resolveParams<T>(params: T | Promise<T>): Promise<T> {
  return await params;
}

/* ===========================
   GET: liste des notes (max 50)
   =========================== */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await resolveParams(context.params);
    const pid = Number(projectId);

    if (!Number.isFinite(pid)) {
      return NextResponse.json({ error: "projectId invalide" }, { status: 400 });
    }

    const [rows] = await pool.query<NoteRow[]>(
      "SELECT id, project_id, user_id, text, created_at FROM project_notes WHERE project_id = ? ORDER BY id DESC LIMIT 50",
      [pid]
    );

    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

/* ===========================
   POST: créer une note
   =========================== */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    // ✅ Compatible toutes versions/types: on normalise l’accès au cookie store
    const ck = await getCookieStore();

    const authHeader = req.headers.get("authorization");
    const bearer =
      authHeader && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : null;

    const token = ck.get(SESSION_COOKIE_NAME)?.value || bearer;

    const payload = token ? ((await verifyJwt(token)) as JwtPayload) : null;
    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { projectId } = await resolveParams(context.params);
    const pid = Number(projectId);
    if (!Number.isFinite(pid)) {
      return NextResponse.json({ error: "projectId invalide" }, { status: 400 });
    }

    // Body strictement typé/validé simplement
    const bodyUnknown: unknown = await req.json().catch(() => null);
    if (
      typeof bodyUnknown !== "object" ||
      bodyUnknown === null ||
      typeof (bodyUnknown as { text?: unknown }).text !== "string"
    ) {
      return NextResponse.json(
        { error: "Format de requête invalide" },
        { status: 400 }
      );
    }

    const text = ((bodyUnknown as { text: string }).text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Note vide" }, { status: 400 });
    }

    const userId =
      typeof payload.sub === "string" ? Number(payload.sub) : Number(payload.sub);

    const [res] = await pool.query<ResultSetHeader>(
      "INSERT INTO project_notes (project_id, user_id, text) VALUES (?, ?, ?)",
      [pid, Number.isFinite(userId) ? userId : null, text]
    );

    const [rows] = await pool.query<NoteRow[]>(
      "SELECT id, project_id, user_id, text, created_at FROM project_notes WHERE id = ?",
      [res.insertId]
    );

    return NextResponse.json({ note: rows[0] ?? null });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
