// app/api/me/events/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

// ---- Types de domaine ----
type EventType = "task" | "meeting" | "reminder" | "other";
type Visibility = "private" | "attendees" | "org";

interface Attendee {
  user_id: number;
  role: string;
  rsvp: "yes" | "no" | "maybe" | null;
}

interface EventRowRaw extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  type: EventType;
  all_day: 0 | 1;
  timezone: string;
  start_at: string; // ISO en base (timestamp ou datetime)
  end_at: string;
  created_by: number;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  // L’agrégat JSON renvoyé par MySQL. Selon la config du driver, ça peut être une string JSON.
  attendees: string | null;
}

interface EventItem {
  id: number;
  title: string;
  description: string | null;
  type: EventType;
  all_day: boolean;
  timezone: string;
  start_at: string;
  end_at: string;
  created_by: number;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  attendees: Attendee[];
}

interface CreateEventBody {
  title?: string;
  start_at?: string; // "YYYY-MM-DDTHH:mm"
  end_at?: string;
  type?: EventType;
  description?: string | null;
  all_day?: boolean;
  timezone?: string;
  visibility?: Visibility;
}

// GET /api/me/events?from=YYYY-MM-DD&to=YYYY-MM-DD&q=...&type=meeting|task|...
export async function GET(req: Request) {
  try {
    const { user } = await requireUser();

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const q = searchParams.get("q")?.trim() ?? "";
    const type = (searchParams.get("type")?.trim() ?? "") as EventType | "";
    const onlyMine = searchParams.get("mine") ?? "1"; // par défaut: événements créés par moi

    const where: string[] = [];
    const params: Record<string, string | number> = {};

    if (onlyMine === "1") {
      where.push("e.created_by = :uid");
      params.uid = user.id;
    } else {
      // visibilité minimale: perso + où je suis invité
      where.push("(e.created_by = :uid OR a.user_id = :uid)");
      params.uid = user.id;
    }

    if (from) {
      where.push("e.end_at >= :from");
      params.from = `${from} 00:00:00`;
    }
    if (to) {
      where.push("e.start_at <= :to");
      params.to = `${to} 23:59:59`;
    }

    if (q) {
      where.push("(e.title LIKE :q OR e.description LIKE :q)");
      params.q = `%${q}%`;
    }
    if (type) {
      where.push("e.type = :type");
      params.type = type;
    }

    const sql = `
      SELECT e.id, e.title, e.description, e.type, e.all_day, e.timezone,
             e.start_at, e.end_at, e.created_by, e.visibility, e.created_at, e.updated_at,
             JSON_ARRAYAGG(JSON_OBJECT('user_id', a.user_id, 'role', a.role, 'rsvp', a.rsvp)) AS attendees
      FROM calendar_events e
      LEFT JOIN calendar_event_attendees a ON a.event_id = e.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY e.id
      ORDER BY e.start_at ASC
      LIMIT 500
    `;

    const [rows] = await pool.query<EventRowRaw[]>(sql, params);

    // Normalisation (all_day -> boolean, attendees -> tableau typé)
    const items: EventItem[] = (rows ?? []).map((r) => {
      const attendees: Attendee[] = r.attendees
        ? (typeof r.attendees === "string"
            ? (JSON.parse(r.attendees) as Attendee[])
            : (r.attendees as unknown as Attendee[])) // au cas où le driver renverrait déjà un objet
        : [];

      return {
        id: r.id,
        title: r.title,
        description: r.description,
        type: r.type,
        all_day: r.all_day === 1,
        timezone: r.timezone,
        start_at: r.start_at,
        end_at: r.end_at,
        created_by: r.created_by,
        visibility: r.visibility,
        created_at: r.created_at,
        updated_at: r.updated_at,
        attendees,
      };
    });

    return NextResponse.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch events";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireUser();
    const body = (await req.json()) as CreateEventBody;

    const title = String(body.title ?? "").trim();
    if (!title) throw new Error("Title is required");

    const start_at = body.start_at; // "YYYY-MM-DDTHH:mm"
    const end_at = body.end_at;
    if (!start_at || !end_at) throw new Error("Dates are required");

    const type: EventType = (body.type ?? "other") as EventType;
    const description: string | null = body.description ?? null;
    const all_day = body.all_day ? 1 : 0;
    const timezone = String(body.timezone ?? "UTC");
    const visibility: Visibility = (body.visibility ?? "attendees") as Visibility;

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO calendar_events
        (title, description, type, all_day, timezone, start_at, end_at, created_by, visibility)
       VALUES (:title,:description,:type,:all_day,:timezone,:start_at,:end_at,:uid,:visibility)`,
      { title, description, type, all_day, timezone, start_at, end_at, uid: user.id, visibility }
    );

    const insertId = res.insertId;

    // ajoute l'auteur en "host"
    await pool.query<ResultSetHeader>(
      `INSERT INTO calendar_event_attendees (event_id, user_id, role, rsvp)
       VALUES (:eid, :uid, 'host', 'yes')`,
      { eid: insertId, uid: user.id }
    );

    // renvoie l'item complet
    const [rows] = await pool.query<EventRowRaw[]>(
      `SELECT e.id, e.title, e.description, e.type, e.all_day, e.timezone,
              e.start_at, e.end_at, e.created_by, e.visibility, e.created_at, e.updated_at,
              JSON_ARRAYAGG(JSON_OBJECT('user_id', a.user_id, 'role', a.role, 'rsvp', a.rsvp)) AS attendees
       FROM calendar_events e
       LEFT JOIN calendar_event_attendees a ON a.event_id = e.id
       WHERE e.id = :id
       GROUP BY e.id`,
      { id: insertId }
    );

    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: "Not found after insert" }, { status: 404 });
    }

    const attendees: Attendee[] = row.attendees
      ? (typeof row.attendees === "string"
          ? (JSON.parse(row.attendees) as Attendee[])
          : (row.attendees as unknown as Attendee[]))
      : [];

    const item: EventItem = {
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      all_day: row.all_day === 1,
      timezone: row.timezone,
      start_at: row.start_at,
      end_at: row.end_at,
      created_by: row.created_by,
      visibility: row.visibility,
      created_at: row.created_at,
      updated_at: row.updated_at,
      attendees,
    };

    return NextResponse.json({ item });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
