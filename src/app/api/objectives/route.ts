// app/api/objectives/route.ts
import { NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import { requireUser } from "../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

type ObjectiveStatus = "todo" | "in_progress" | "done";
type Priority = "passable" | "normal" | "high";

interface ObjectiveRow extends RowDataPacket {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  unit: string;
  target: number;
  current: number;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  status: ObjectiveStatus;
  priority: Priority;
  created_at: string; // DATETIME
  updated_at: string; // DATETIME
}

interface ObjectiveWithJoins extends ObjectiveRow {
  owner_name: string;
  calendar_event_id: number | null;
  calendar_start_at: string | null; // DATETIME
  calendar_end_at: string | null;   // DATETIME
}

type SubtaskInput = {
  title: string;
  weight?: number;
  dueDate?: string | null; // YYYY-MM-DD ou null
};

// GET: liste des objectifs (aucun paramètre requis ici → on supprime `req` pour éviter l'avertissement ESLint)
export async function GET() {
  try {
    const [rows] = await pool.query<ObjectiveWithJoins[]>(
      `
      SELECT
        o.*,
        u.name AS owner_name,
        ce.id       AS calendar_event_id,
        ce.start_at AS calendar_start_at,
        ce.end_at   AS calendar_end_at
      FROM objectives o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN calendar_events ce ON ce.objective_id = o.id
      ORDER BY o.updated_at DESC
      `
    );

    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur liste objectifs";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireUser();

    const body = (await req.json()) as {
      userId?: number;
      title?: string;
      description?: string | null;
      unit?: string;
      target?: number;
      startDate?: string; // YYYY-MM-DD
      endDate?: string;   // YYYY-MM-DD
      subtasks?: SubtaskInput[];
    };

    const {
      userId,            // ← utilisateur assigné
      title,
      description,
      unit = "%",
      target = 100,
      startDate,         // YYYY-MM-DD
      endDate,           // YYYY-MM-DD
      subtasks = [],     // [{title, weight?, dueDate?}]
    } = body || {};

    if (!userId) throw new Error("Utilisateur requis.");
    if (!title?.trim()) throw new Error("Titre requis.");
    if (!startDate) throw new Error("Date de début requise.");
    if (!endDate) throw new Error("Date de fin requise.");

    // Création objectif
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO objectives (
         user_id, title, description, unit, target, current,
         start_date, end_date, status, priority, created_at, updated_at
       )
       VALUES (?,?,?,?,?,0,?,?,'todo','passable',NOW(),NOW())`,
      [
        userId,
        title.trim(),
        description?.trim() || null,
        unit.trim() || "%",
        Number(target ?? 0),
        startDate,
        endDate,
      ]
    );

    const newId = ins.insertId;

    // Sous-objectifs (facultatif)
    if (Array.isArray(subtasks) && subtasks.length) {
      const values: Array<[number, string, number, string | null]> = subtasks
        .filter(
          (s): s is SubtaskInput & { title: string } =>
            Boolean(s && typeof s.title === "string" && s.title.trim())
        )
        .map((s) => [
          newId,
          s.title!.trim(),
          Number(s.weight ?? 0),
          s.dueDate ?? null,
        ]);

      if (values.length) {
        await pool.query<ResultSetHeader>(
          `INSERT INTO objective_subtasks
             (objective_id, title, weight, due_date, done, created_at)
           VALUES ${values.map(() => "(?,?,?,?,0,NOW())").join(",")}`,
          values.flat()
        );
      }
    }

    // Crée une entrée calendrier (événement couvrant la période, all_day)
    await pool.query<ResultSetHeader>(
      `INSERT INTO calendar_events
         (title, description, type, all_day, timezone, start_at, end_at,
          created_by, objective_id, visibility, created_at, updated_at)
       VALUES
         (?,?,?,?,?,?,?,?,?,'attendees',NOW(),NOW())`,
      [
        title.trim(),
        description?.trim() || null,
        "other",
        1,
        "UTC",
        `${startDate} 00:00:00`,
        `${endDate} 23:59:59`,
        user.id,
        newId,
      ]
    );

    // Retour complet avec LEFT JOIN
    const [rows] = await pool.query<ObjectiveWithJoins[]>(
      `
      SELECT
        o.*,
        u.name AS owner_name,
        ce.id       AS calendar_event_id,
        ce.start_at AS calendar_start_at,
        ce.end_at   AS calendar_end_at
      FROM objectives o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN calendar_events ce ON ce.objective_id = o.id
      WHERE o.id = ?
      `,
      [newId]
    );

    return NextResponse.json({ item: rows[0] ?? null });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Erreur création objectif";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
