// app/guestmarkets/api/planning/meetings/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

/** Types de réponse harmonisés avec ton front */
type RSVP = "yes" | "no" | "maybe" | "pending";
type Att = {
  user_id: number;
  name: string;
  email: string;
  role: "host" | "required" | "optional";
  rsvp: RSVP;
};
type EventLite = {
  id: number;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  timezone: string;
  created_by: number;
  owner_name: string;
  attendees: Att[];
};

/** Lignes retournées par les requêtes SQL */
interface EventRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  start_at: string; // grâce à dateStrings: true côté pool
  end_at: string | null;
  timezone: string | null;
  created_by: number;
  owner_name: string;
}

interface AttendeeRow extends RowDataPacket {
  event_id: number;
  user_id: number;
  name: string;
  email: string;
  role: "host" | "required" | "optional";
  rsvp: RSVP | null;
}

/* =========================
   GET: réunions visibles pour l'utilisateur
   - Créées par lui
   - OU où il est participant
   ========================= */
export async function GET() {
  try {
    const { user } = await requireUser();
    const uid = user.id;

    const [rows] = await pool.query<EventRow[]>(
      `SELECT ce.id, ce.title, ce.description, ce.start_at, ce.end_at, ce.timezone,
              ce.created_by, COALESCE(u.name,'') AS owner_name
         FROM calendar_events ce
         JOIN users u ON u.id = ce.created_by
        WHERE ce.created_by = ?
           OR EXISTS (SELECT 1 FROM calendar_event_attendees a WHERE a.event_id = ce.id AND a.user_id = ?)
        ORDER BY ce.start_at ASC`,
      [uid, uid]
    );

    const eventIds: number[] = rows.map((r) => r.id);
    const attendeesMap = new Map<number, Att[]>();

    if (eventIds.length > 0) {
      const placeholders = eventIds.map(() => "?").join(",");
      const [att] = await pool.query<AttendeeRow[]>(
        `SELECT a.event_id, a.user_id, COALESCE(u.name,'') AS name, COALESCE(u.email,'') AS email,
                a.role, a.rsvp
           FROM calendar_event_attendees a
           JOIN users u ON u.id = a.user_id
          WHERE a.event_id IN (${placeholders})`,
        eventIds
      );

      for (const r of att) {
        const evId = r.event_id;
        const arr = attendeesMap.get(evId) ?? [];
        arr.push({
          user_id: r.user_id,
          name: r.name,
          email: r.email,
          role: r.role,
          rsvp: (r.rsvp ?? "pending") as RSVP,
        });
        attendeesMap.set(evId, arr);
      }
    }

    const items: EventLite[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      start_at: r.start_at, // "YYYY-MM-DD HH:MM:SS"
      end_at: r.end_at,
      timezone: r.timezone ?? "UTC",
      created_by: r.created_by,
      owner_name: r.owner_name,
      attendees: attendeesMap.get(r.id) ?? [],
    }));

    return NextResponse.json({ items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* =========================
   POST: créer une réunion
   body: {
     title, description|null, start_at, end_at, timezone,
     attendee_ids:number[], invite_super_admin:boolean
   }
   ========================= */
type PostBody = {
  title: string;
  description?: string | null;
  start_at: string; // "YYYY-MM-DD HH:MM:SS"
  end_at: string; // "YYYY-MM-DD HH:MM:SS"
  timezone?: string;
  attendee_ids?: Array<number | string>;
  invite_super_admin?: boolean;
};

export async function POST(req: Request) {
  try {
    const { user } = await requireUser();
    const uid = user.id;

    const raw = (await req.json()) as unknown;
    const body = (raw ?? {}) as Partial<PostBody>;

    const title: string = String(body.title ?? "").trim();
    const description: string | null =
      body.description !== undefined && body.description !== null
        ? String(body.description)
        : null;
    const start_at: string = String(body.start_at ?? "").trim();
    const end_at: string = String(body.end_at ?? "").trim();
    const timezone: string = String(body.timezone ?? "UTC");

    const attendee_ids: number[] = Array.isArray(body.attendee_ids)
      ? body.attendee_ids
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : [];

    const invite_super_admin: boolean = Boolean(body.invite_super_admin);

    if (!title || !start_at || !end_at) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Création de l’événement
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO calendar_events (title, description, start_at, end_at, timezone, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, description, start_at, end_at, timezone, uid]
    );
    const eventId = res.insertId;

    // Ajout du créateur comme "host"
    await pool.query<ResultSetHeader>(
      `INSERT INTO calendar_event_attendees (event_id, user_id, role, rsvp)
       VALUES (?, ?, 'host', 'pending')`,
      [eventId, uid]
    );

    // Participants requis (déduplication, sans l'hôte)
    const dedup = Array.from(new Set(attendee_ids.filter((id) => id !== uid)));
    if (dedup.length > 0) {
      const values = dedup.flatMap((id) => [eventId, id, "required", "pending"] as const);
      const placeholders = dedup.map(() => "(?,?,?,?)").join(",");
      await pool.query<ResultSetHeader>(
        `INSERT INTO calendar_event_attendees (event_id, user_id, role, rsvp)
         VALUES ${placeholders}`,
        values as unknown as (string | number)[]
      );
    }

    // Option: inviter tous les superAdmin (si activé)
    if (invite_super_admin) {
      interface AdminRow extends RowDataPacket {
        id: number;
      }
      const [admins] = await pool.query<AdminRow[]>(
        `SELECT id
           FROM users
          WHERE is_admin = 1
            AND (status IS NULL OR status='' OR status='active')`
      );
      const adminIds = admins
        .map((r) => r.id)
        .filter((id) => id !== uid && !dedup.includes(id));

      if (adminIds.length > 0) {
        const values = adminIds.flatMap((id) => [eventId, id, "optional", "pending"] as const);
        const placeholders = adminIds.map(() => "(?,?,?,?)").join(",");
        await pool.query<ResultSetHeader>(
          `INSERT INTO calendar_event_attendees (event_id, user_id, role, rsvp)
           VALUES ${placeholders}`,
          values as unknown as (string | number)[]
        );
      }
    }

    return NextResponse.json({ ok: true, id: eventId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
