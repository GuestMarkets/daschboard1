export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../lib/db";
import { ok, err, toId, getMe } from "../../../_utils";

// Typage des lignes retournées par la table project_notes + jointure users
interface NoteRow extends RowDataPacket {
  id: number;
  project_id: number;
  user_id: number;
  text: string;
  created_at: Date | string;
  author_name: string | null;
}

// Helper pour extraire un message d'erreur sans utiliser `any`
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Erreur";
  }
}

// GET /guestmarkets/api/projects/[projectId]/notes
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  try {
    const { projectId } = await context.params; // <— params est un Promise maintenant
    const pid = toId(projectId);
    if (!pid) return err("Projet invalide", 400);

    const [rows] = await pool.execute<NoteRow[]>(
      `SELECT n.id, n.project_id, n.user_id, n.text, n.created_at,
              u.name AS author_name
         FROM project_notes n
    LEFT JOIN users u ON u.id = n.user_id
        WHERE n.project_id = ?
        ORDER BY n.created_at DESC, n.id DESC`,
      [pid]
    );

    return ok({ items: rows });
  } catch (e: unknown) {
    return err(getErrorMessage(e) || "Erreur", 500);
  }
}

// POST /guestmarkets/api/projects/[projectId]/notes
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  try {
    const me = await getMe();

    const { projectId } = await context.params; // <— idem
    const pid = toId(projectId);
    if (!pid) return err("Projet invalide", 400);

    // On tape le body de manière sûre sans `any`
    const rawBody = (await req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof rawBody.text === "string" ? rawBody.text.trim() : "";

    if (!text) return err("Texte de note requis", 400);

    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO project_notes (project_id, user_id, text, created_at)
       VALUES (?, ?, ?, NOW())`,
      [pid, me.id, text]
    );

    const id = Number(res.insertId);

    const [rows] = await pool.execute<NoteRow[]>(
      `SELECT n.id, n.project_id, n.user_id, n.text, n.created_at,
              u.name AS author_name
         FROM project_notes n
    LEFT JOIN users u ON u.id = n.user_id
        WHERE n.id = ?`,
      [id]
    );

    return ok({ note: rows[0] ?? null });
  } catch (e: unknown) {
    return err(getErrorMessage(e) || "Erreur", 500);
  }
}
