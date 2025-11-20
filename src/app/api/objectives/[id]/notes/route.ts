// app/api/objectives/[taskId]/notes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

type Params = { id: string };

// Note: selon la config Next.js, `params` est un Promise<{ id: string }>
export async function POST(
  req: NextRequest,
  context: { params: Promise<Params> }
) {
  // Récupération sécurisée de l'ID depuis le contexte
  const { id: idParam } = await context.params;
  const id = Number(idParam);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "ID invalide" }, { status: 400 });
  }

  try {
    const { user } = await requireUser();

    // Lecture sécurisée du body JSON
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      // Pas de body ou JSON invalide -> body reste {}
    }

    const text =
      typeof (body as { text?: string }).text === "string"
        ? (body as { text: string }).text.trim()
        : "";

    if (!text) {
      return NextResponse.json({ error: "Texte requis." }, { status: 400 });
    }

    // ⚠️ Si tu es sur PostgreSQL (pg), remplace ? par $1, $2, $3
    await pool.query(
      `INSERT INTO objective_notes (objective_id, text, created_by, created_at)
       VALUES (?, ?, ?, NOW())`,
      [id, text, user.id]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur lors de l’ajout de la note.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
