// app/api/admin/department/tasks/[taskId]/subtasks/[subId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../../../lib/db";
import type { RowDataPacket } from "mysql2/promise";

/** Modèle minimal pour la sous-tâche ; on peut ajouter d'autres champs si besoin */
interface Subtask extends RowDataPacket {
  id: number;
  done: 0 | 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: unknown; // autorise d'autres colonnes sans recourir à `any`
}

/** Typage Next.js (v15+) : params est un Promise */
type RouteContext = {
  params: Promise<{ id: string; subId: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { subId: subIdParam } = await context.params;
  const subIdNum = Number(subIdParam);

  if (!Number.isFinite(subIdNum)) {
    return NextResponse.json(
      { error: 'Paramètre "subId" invalide : nombre attendu.' },
      { status: 400 }
    );
  }

  // On lit le body en toute sécurité
  const body = (await req.json().catch(() => ({}))) as Partial<{ done: boolean }>;
  const { done } = body;

  if (typeof done !== "boolean") {
    return NextResponse.json(
      { error: 'Paramètre "done" invalide : boolean attendu.' },
      { status: 400 }
    );
  }

  try {
    // Mise à jour
    await pool.query(`UPDATE task_subtasks SET done=? WHERE id=?`, [done ? 1 : 0, subIdNum]);

    // Lecture de la ligne mise à jour
    const [rows] = await pool.query<Subtask[]>(
      `SELECT * FROM task_subtasks WHERE id=?`,
      [subIdNum]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: "Sous-tâche introuvable." },
        { status: 404 }
      );
    }

    return NextResponse.json({ item: rows[0] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message || "Erreur" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { subId: subIdParam } = await context.params;
  const subIdNum = Number(subIdParam);

  if (!Number.isFinite(subIdNum)) {
    return NextResponse.json(
      { error: 'Paramètre "subId" invalide : nombre attendu.' },
      { status: 400 }
    );
  }

  try {
    const [result] = await pool.query(`DELETE FROM task_subtasks WHERE id=?`, [subIdNum]);

    // Optionnel : vérifier si une ligne a bien été supprimée (si driver renvoie affectedRows)
    // @ts-expect-error — selon le type retourné par mysql2, on protège l'accès.
    if (typeof result?.affectedRows === "number" && result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Sous-tâche introuvable." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message || "Erreur" }, { status: 400 });
  }
}
