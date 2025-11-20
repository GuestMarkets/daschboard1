export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool } from "../../../../../lib/db";
import { getAuthUserId } from "../../../../../lib/auth_user";
import { clampEnd, mapEventRow, notPast } from "../_utils";
import { googleUpsertEvent } from "../../../../../lib/google_calendar";

// ===== Types =====
type EventType = "task" | "meeting" | "reminder" | "other";

type CreateEventBody = {
  title: string;
  description?: string | null;
  type?: EventType;
  allDay?: boolean;
  timezone?: string;
  startAt: string; // ISO
  endAt: string;   // ISO
  taskId?: number | null;
  attendees?: unknown[]; // normalisé juste après
  syncGoogle?: boolean;
};

type Attendee = { id: number };

// Lignes renvoyées par MySQL (avec le champ "attendees" agrégé en JSON)
type DBEventRow = RowDataPacket & {
  id: number;
  title: string;
  description: string | null;
  type: EventType;
  all_day: 0 | 1;
  timezone: string;
  start_at: string; // datetime en BDD
  end_at: string;   // datetime en BDD
  created_by: number;
  task_id: number | null;
  google_event_id?: string | null;
  attendees: unknown; // peut être string JSON ou array selon le driver
};

// ===== Utils =====
function isAttendee(val: unknown): val is Attendee {
  if (typeof val !== "object" || val === null) return false;
  // cast sans any : on passe par Record<string, unknown>
  const rec = val as Record<string, unknown>;
  return typeof rec.id === "number";
}

function normalizeAttendees(input: unknown): Attendee[] {
  // mysql2 peut renvoyer déjà un tableau d'objets ou une chaîne JSON
  if (Array.isArray(input)) {
    return input.filter(isAttendee);
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isAttendee);
    } catch {
      // ignore JSON parse error -> renvoie un tableau vide
    }
  }
  return [];
}

// ===== Handlers =====
export async function GET(req: Request) {
  const userId = await getAuthUserId(req);

  const url = new URL(req.url);
  const from = url.searchParams.get("from"); // yyyy-mm-dd
  const to   = url.searchParams.get("to");   // yyyy-mm-dd

  if (!from || !to) {
    return NextResponse.json({ error: "from/to requis" }, { status: 400 });
  }

  const pool = getPool();
  const [rows] = await pool.query<DBEventRow[]>(
    `SELECT e.*,
            COALESCE(JSON_ARRAYAGG(IF(a.user_id IS NULL, NULL, JSON_OBJECT('id', a.user_id))), JSON_ARRAY()) AS attendees
     FROM calendar_events e
     LEFT JOIN calendar_event_attendees a ON a.event_id = e.id
     WHERE
       (e.created_by = ? OR EXISTS (SELECT 1 FROM calendar_event_attendees a2 WHERE a2.event_id=e.id AND a2.user_id=?))
       AND e.end_at >= ? AND e.start_at <= DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY e.id
     ORDER BY e.start_at ASC`,
    [userId, userId, `${from} 00:00:00`, `${to} 23:59:59`]
  );

  const items = rows.map((r) => {
    const att = normalizeAttendees(r.attendees);
    // on reconstitue un "row" avec attendees normalisés sans utiliser any
    const rowWithAttendees: DBEventRow = { ...r, attendees: att };
    return mapEventRow(rowWithAttendees);
  });

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const userId = await getAuthUserId(req);

  const body = (await req.json().catch(() => null)) as CreateEventBody | null;
  if (!body) {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const title = String(body.title || "").trim();
  const description = body.description?.toString() ?? "";
  const type: EventType = body.type || "other";
  const allDay = !!body.allDay;
  const timezone = String(body.timezone || "UTC");
  const startAt = String(body.startAt || "");
  let endAt     = String(body.endAt || "");
  const taskId  = body.taskId != null ? Number(body.taskId) : null;

  // normalise et TAPE les attendees en number[]
  const attendees: number[] = Array.isArray(body.attendees)
    ? body.attendees
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n > 0)
    : [];

  const syncGoogle = !!body.syncGoogle;

  if (!title || !startAt || !endAt) {
    return NextResponse.json({ error: "Champs requis manquants" }, { status: 400 });
  }
  endAt = clampEnd(startAt, endAt);

  if (!notPast(startAt)) {
    return NextResponse.json({ error: "Impossible de programmer dans le passé" }, { status: 400 });
  }

  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [ins] = await conn.query<ResultSetHeader>(
      `INSERT INTO calendar_events (title, description, type, all_day, timezone, start_at, end_at, created_by, task_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [title, description || null, type, allDay ? 1 : 0, timezone, startAt, endAt, userId, taskId || null]
    );

    const eventId = ins.insertId;

    if (attendees.length) {
      // tuple typé pour le bulk insert
      const values: Array<[number, number, "required", "needs_action"]> = attendees.map((uid) => [
        eventId,
        uid,
        "required",
        "needs_action",
      ]);
      await conn.query(
        "INSERT INTO calendar_event_attendees (event_id, user_id, role, status) VALUES ?",
        [values]
      );
    }

    // Sync Google (best-effort)
    let googleEventId: string | null | undefined = null;
    if (syncGoogle) {
      const g = await googleUpsertEvent({
        userId,
        event: { title, description, start: startAt, end: endAt, allDay, timezone },
      });
      googleEventId = g.googleEventId ?? null;

      if (googleEventId) {
        await conn.query("UPDATE calendar_events SET google_event_id=? WHERE id=?", [
          googleEventId,
          eventId,
        ]);
      }
    }

    const [rows] = await conn.query<DBEventRow[]>(
      `SELECT e.*, COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id', a.user_id)), JSON_ARRAY()) AS attendees
       FROM calendar_events e
       LEFT JOIN calendar_event_attendees a ON a.event_id=e.id
       WHERE e.id=? GROUP BY e.id`,
      [eventId]
    );

    await conn.commit();

    const row = rows[0];
    const normalized = normalizeAttendees(row.attendees);
    const rowWithAttendees: DBEventRow = { ...row, attendees: normalized };
    return NextResponse.json({ item: mapEventRow(rowWithAttendees) }, { status: 201 });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
