// app/api/objectives/[taskId]/subtasks/[subId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

/** Lignes renvoyées par la requête objectif */
interface ObjectiveRow extends RowDataPacket {
  id: number;
  userId: number | null; // alias dans la requête: user_id AS userId
  owner: string | null;  // u.name AS owner
  title: string;
  description: string | null;
  unit: string | null;
  target: number | null;
  current: number | null;
  startDate: Date | string | null; // o.start_date AS startDate
  endDate: Date | string | null;   // o.end_date AS endDate
  status: string | null;
  priority: string | null;
  calendar_event_id: string | number | null; // selon schéma
  created_at: Date | string;
  updated_at: Date | string;
}

/** Lignes renvoyées par la requête sous-tâches */
interface SubtaskRow extends RowDataPacket {
  id: number;
  objective_id: number;
  title: string;
  weight: number | null;
  dueDate: Date | string | null; // due_date AS dueDate
  done: 0 | 1;
}

/** Objet renvoyé au client */
interface ObjectiveWithSubs extends ObjectiveRow {
  subtasks: SubtaskRow[];
}

// (Optionnel) verrouille l'exécution côté Node si tu utilises parfois l'edge
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; subId: string }> } // <-- params est une Promise ici
) {
  // On "await" les params pour satisfaire RouteHandlerConfig
  const { id: idParam, subId: subIdParam } = await ctx.params;

  const id = Number(idParam);
  const subId = Number(subIdParam);

  if (!Number.isFinite(id) || !Number.isFinite(subId)) {
    return NextResponse.json({ error: "ID invalide" }, { status: 400 });
  }

  try {
    await requireUser();

    // Lecture du body et sécurisation du parse
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { done } = (body || {}) as { done?: boolean };
    const doneFlag: 0 | 1 = done ? 1 : 0;

    // Mise à jour de la sous-tâche
    await pool.query(
      `UPDATE objective_subtasks 
       SET done = ? 
       WHERE id = ? AND objective_id = ?`,
      [doneFlag, subId, id]
    );

    // Récupération de l'objectif
    const [objRows] = await pool.query<ObjectiveRow[]>(
      `
      SELECT 
        o.id,
        o.user_id AS userId,
        u.name AS owner,
        o.title,
        o.description,
        o.unit,
        o.target,
        o.current,
        o.start_date AS startDate,
        o.end_date AS endDate,
        o.status,
        o.priority,
        o.calendar_event_id,
        o.created_at,
        o.updated_at
      FROM objectives o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = ?
      LIMIT 1
      `,
      [id]
    );

    const objective = objRows[0];
    if (!objective) {
      return NextResponse.json(
        { error: "Objectif introuvable" },
        { status: 404 }
      );
    }

    // Récupération des sous-tâches
    const [subsRows] = await pool.query<SubtaskRow[]>(
      `
      SELECT 
        id,
        objective_id,
        title,
        weight,
        due_date AS dueDate,
        done
      FROM objective_subtasks
      WHERE objective_id = ?
      ORDER BY id DESC
      `,
      [id]
    );

    const item: ObjectiveWithSubs = { ...objective, subtasks: subsRows };

    return NextResponse.json({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
