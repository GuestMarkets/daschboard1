export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getPool } from "../../../../../../lib/db";
import { getAuthUserId } from "../../../../../../lib/auth_user";
import { clampEnd, mapEventRow, notPast } from "../../_utils";
import { googleUpsertEvent } from "../../../../../../lib/google_calendar";

/** Types pour le PATCH body afin d’éviter les implicit any */
type PatchBody = {
  title?: string;
  description?: string | null;
  type?: string;
  allDay?: boolean;
  timezone?: string;
  startAt?: string; // ISO
  endAt?: string;   // ISO
  attendees?: unknown[]; // on nettoie ensuite
  taskId?: number | null;
  syncGoogle?: boolean;
};

/** Type de sécurité pour les paramètres SQL (évite any[]) */
type SqlParam = string | number | null | Date | boolean;

/**
 * Si tu as déjà un type EventRow dans ton codebase, on le réutilise implicitement ici.
 * On crée un type local qui étend le row DB retourné par mysql2.
 * - DbEventRow = EventRow + RowDataPacket + (champ agrégé 'attendees' renvoyé par SQL)
 */
type EventRow = {
  id: number;
  title: string;
  description: string | null;
  type: string | null;
  all_day: 0 | 1;
  timezone: string | null;
  start_at: string | Date;
  end_at: string | Date;
  created_by: number;
  task_id: number | null;
  google_event_id: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
};

// Le SELECT ajoute un JSON d'invités => on le marque en optionnel
type DbEventRow = RowDataPacket & EventRow & { attendees?: unknown };

/**
 * GET /api/calendar/events/[taskId]
 * Signature compatible avec:
 * (request: NextRequest, context: { params: Promise<{ id: string }>})
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id invalide" }, { status: 400 });
  }

  const userId = await getAuthUserId(req as unknown as Request);

  const pool = getPool();
  const [rows] = await pool.query<DbEventRow[]>(
    `
    SELECT
      e.*,
      COALESCE(
        JSON_ARRAYAGG(
          IF(a.user_id IS NULL, NULL, JSON_OBJECT('id', a.user_id))
        ),
        JSON_ARRAY()
      ) AS attendees
    FROM calendar_events e
    LEFT JOIN calendar_event_attendees a ON a.event_id = e.id
    WHERE e.id = ?
      AND (
        e.created_by = ?
        OR EXISTS (
          SELECT 1
          FROM calendar_event_attendees a2
          WHERE a2.event_id = e.id
            AND a2.user_id  = ?
        )
      )
    GROUP BY e.id
    `,
    [id, userId, userId]
  );

  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // rows[0] est maintenant typé comme DbEventRow (incluant EventRow)
  return NextResponse.json({ item: mapEventRow(rows[0]) });
}

/**
 * PATCH /api/calendar/events/[taskId]
 * Signature compatible avec:
 * (request: NextRequest, context: { params: Promise<{ id: string }>})
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id invalide" }, { status: 400 });
  }

  const userId = await getAuthUserId(req as unknown as Request);

  const body: PatchBody | null = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON invalide" }, { status: 400 });

  const title       = body.title !== undefined ? String(body.title).trim() : undefined;
  const description = body.description !== undefined ? (body.description ?? null) : undefined;
  const type        = body.type !== undefined ? (String(body.type) as string) : undefined;
  const allDay      = body.allDay !== undefined ? Boolean(body.allDay) : undefined;
  const timezone    = body.timezone !== undefined ? String(body.timezone) : undefined;
  const startAt     = body.startAt !== undefined ? String(body.startAt) : undefined;
  let   endAt       = body.endAt   !== undefined ? String(body.endAt)   : undefined;
  const taskId      = body.taskId !== undefined ? (body.taskId ?? null) : undefined;
  const syncGoogle  = !!body.syncGoogle;

  // Normalisation des dates
  if (startAt && endAt) endAt = clampEnd(startAt, endAt);
  if (startAt && !notPast(startAt)) {
    return NextResponse.json({ error: "Impossible de déplacer dans le passé" }, { status: 400 });
  }

  // Nettoyage/typage des participants
  const attendees: number[] | undefined = Array.isArray(body.attendees)
    ? body.attendees
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n > 0)
    : undefined;

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Vérifier droits (créateur ou participant)
    const [check] = await conn.query<(RowDataPacket & { created_by: number; google_event_id: string | null; })[]>(
      `
      SELECT e.created_by, e.google_event_id
      FROM calendar_events e
      WHERE e.id = ?
        AND (
          e.created_by = ?
          OR EXISTS (
              SELECT 1
              FROM calendar_event_attendees a2
              WHERE a2.event_id = e.id
                AND a2.user_id  = ?
          )
        )
      `,
      [id, userId, userId]
    );
    if (!check.length) {
      await conn.rollback();
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const prevGoogleId: string | null = (check[0].google_event_id ?? null);

    // Construction dynamique de l’UPDATE
    const updates: string[] = [];
    const paramsArr: SqlParam[] = [];
    if (title !== undefined)       { updates.push("title = ?");       paramsArr.push(title); }
    if (description !== undefined) { updates.push("description = ?"); paramsArr.push(description); }
    if (type !== undefined)        { updates.push("type = ?");        paramsArr.push(type); }
    if (allDay !== undefined)      { updates.push("all_day = ?");     paramsArr.push(allDay ? 1 : 0); }
    if (timezone !== undefined)    { updates.push("timezone = ?");    paramsArr.push(timezone); }
    if (startAt !== undefined)     { updates.push("start_at = ?");    paramsArr.push(startAt); }
    if (endAt !== undefined)       { updates.push("end_at = ?");      paramsArr.push(endAt); }
    if (taskId !== undefined)      { updates.push("task_id = ?");     paramsArr.push(taskId); }

    if (updates.length) {
      await conn.query(
        `UPDATE calendar_events SET ${updates.join(", ")} WHERE id = ?`,
        [...paramsArr, id]
      );
    }

    // Mise à jour des participants
    if (attendees !== undefined) {
      await conn.query("DELETE FROM calendar_event_attendees WHERE event_id = ?", [id]);

      if (attendees.length) {
        // mysql2 accepte un tableau de tuples pour VALUES ?
        const values: Array<[number, number, "required", "needs_action"]> =
          attendees.map((uid: number) => [id, uid, "required", "needs_action"]);

        await conn.query(
          "INSERT INTO calendar_event_attendees (event_id, user_id, role, status) VALUES ?",
          [values]
        );
      }
    }

    // Relecture pour réponse + éventuelle synchro Google
    const [rows] = await conn.query<DbEventRow[]>(
      `
      SELECT
        e.*,
        COALESCE(
          JSON_ARRAYAGG(JSON_OBJECT('id', a.user_id)),
          JSON_ARRAY()
        ) AS attendees
      FROM calendar_events e
      LEFT JOIN calendar_event_attendees a ON a.event_id = e.id
      WHERE e.id = ?
      GROUP BY e.id
      `,
      [id]
    );

    if (syncGoogle && rows.length) {
      const ev = rows[0]; // DbEventRow = EventRow + RowDataPacket

      const g = await googleUpsertEvent({
        userId,
        googleEventId: prevGoogleId ?? undefined,
        event: {
          title: ev.title,
          description: ev.description ?? undefined,
          start: (ev.start_at instanceof Date) ? ev.start_at.toISOString() : String(ev.start_at),
          end:   (ev.end_at   instanceof Date) ? ev.end_at.toISOString()   : String(ev.end_at),
          allDay: !!ev.all_day,
          timezone: ev.timezone || "UTC",
        }
      });

      if (g.googleEventId && g.googleEventId !== prevGoogleId) {
        await conn.query(
          "UPDATE calendar_events SET google_event_id = ? WHERE id = ?",
          [g.googleEventId, id]
        );
      }
    }

    await conn.commit();
    return NextResponse.json({ item: mapEventRow(rows[0]) });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
