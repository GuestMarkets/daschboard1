// app/api/planning/meetings/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/db";
import { meetingsVisibilityWhere } from "../../../../../lib/rbac";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** ---- Types DB ---- */
type EventStatus = "scheduled" | "ongoing" | "done" | "missed";

interface EventRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  start_at: string;     // ISO string en DB
  end_at: string;       // ISO string en DB
  timezone: string;
  created_by: number;
  owner_name: string;
  started_at: string | null;
  status: EventStatus;
}

type AttendeeRole = "host" | "required" | "optional";
type AttendeeRsvp = "pending" | "accepted" | "declined" | "tentative" | null;

interface AttendeeRow extends RowDataPacket {
  event_id: number;
  user_id: number;
  role: AttendeeRole;
  rsvp: AttendeeRsvp;
  name: string;
  email: string;
}

interface VisibilityWhere {
  whereSQL: string;
  params: Array<number | string>;
}

/** ---- Types API ---- */
interface PostBody {
  title: string;
  description?: string | null;
  start_at: string;   // ISO
  end_at: string;     // ISO
  timezone?: string;
  solo?: boolean;
  attendee_ids?: Array<number | string>;
}

/** ---- Utils ---- */
function recomputeStatusSQL(whereExtra = ""): string {
  // Recalcule status à partir de started_at / end_at / NOW()
  return `
    UPDATE calendar_events ev
       SET status = (
         CASE
           WHEN ev.started_at IS NOT NULL AND NOW() >= ev.end_at THEN 'done'
           WHEN ev.started_at IS NOT NULL AND NOW() <  ev.end_at THEN 'ongoing'
           WHEN ev.started_at IS NULL     AND NOW() >  ev.end_at THEN 'missed'
           ELSE 'scheduled'
         END
       )
     WHERE 1=1 ${whereExtra};
  `;
}

/** ---- GET ---- */
export async function GET(req: Request) {
  const { user } = await requireUser();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "all"; // "mine" | "all"

  // Visibilité
  let whereClause = "WHERE 1=1";
  let params: Array<number | string> = [];

  if (scope === "mine") {
    // uniquement mes réunions: créées par moi ou où je suis participant
    whereClause += ` AND (ev.created_by = ? OR EXISTS (SELECT 1 FROM calendar_event_attendees a WHERE a.event_id=ev.id AND a.user_id=?))`;
    params.push(user.id, user.id);

    // Recalcul status seulement sur mon périmètre
    await pool.query(
      recomputeStatusSQL(
        `AND (ev.created_by = ${user.id} OR EXISTS (SELECT 1 FROM calendar_event_attendees a WHERE a.event_id=ev.id AND a.user_id=${user.id}))`
      )
    );
  } else {
    // portée selon le rôle (manager/admin/lead…)
    const v = (await meetingsVisibilityWhere(user.id)) as VisibilityWhere;
    whereClause += " " + v.whereSQL;
    params = params.concat(v.params);

    // Recalcule sur tout (ou visible). Ici simple: tout
    await pool.query(recomputeStatusSQL());
  }

  const [rows] = await pool.query<EventRow[]>(
    `
      SELECT ev.id, ev.title, ev.description, ev.start_at, ev.end_at,
             ev.timezone, ev.created_by, u.name AS owner_name, ev.started_at, ev.status
        FROM calendar_events ev
        JOIN users u ON u.id = ev.created_by
       ${whereClause}
       ORDER BY ev.start_at ASC
    `,
    params
  );

  // Récupérer quelques participants (si utile côté UI)
  const ids = rows.map((r) => r.id);
  let attendeesMap: Record<number, Array<{
    user_id: number;
    name: string;
    email: string;
    role: AttendeeRole;
    rsvp: AttendeeRsvp;
  }>> = {};

  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const [att] = await pool.query<AttendeeRow[]>(
      `SELECT a.event_id, a.user_id, a.role, a.rsvp, uu.name, uu.email
         FROM calendar_event_attendees a
         JOIN users uu ON uu.id = a.user_id
        WHERE a.event_id IN (${placeholders})`,
      ids
    );

    attendeesMap = att.reduce((acc, r) => {
      (acc[r.event_id] ||= []).push({
        user_id: r.user_id,
        name: r.name,
        email: r.email,
        role: r.role,
        rsvp: r.rsvp,
      });
      return acc;
    }, {} as Record<number, Array<{
      user_id: number;
      name: string;
      email: string;
      role: AttendeeRole;
      rsvp: AttendeeRsvp;
    }>>);
  }

  const items = rows.map((r) => ({
    ...r,
    attendees: attendeesMap[r.id] || [],
  }));

  return NextResponse.json({ items });
}

/** ---- POST ---- */
export async function POST(req: Request) {
  const { user } = await requireUser();

  // On parse sans `any`
  let body: Partial<PostBody> = {};
  try {
    body = (await req.json()) as Partial<PostBody>;
  } catch {
    body = {};
  }

  const title = String(body.title ?? "").trim();
  const description: string | null = body.description ?? null;
  const start_at = String(body.start_at ?? "");
  const end_at = String(body.end_at ?? "");
  const timezone = String(body.timezone ?? "UTC");
  const solo = Boolean(body.solo);
  const attendee_ids: number[] = Array.isArray(body.attendee_ids)
    ? body.attendee_ids.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];

  if (!title) {
    return NextResponse.json({ error: "Title required" }, { status: 400 });
  }
  if (!start_at || !end_at) {
    return NextResponse.json({ error: "start_at and end_at required" }, { status: 400 });
  }

  // Interdit < 30 min
  const sMs = new Date(start_at.replace(" ", "T")).getTime();
  if (!(sMs >= Date.now() + 30 * 60 * 1000)) {
    return NextResponse.json({ error: "Start must be ≥ 30 min from now" }, { status: 400 });
  }

  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO calendar_events (title, description, start_at, end_at, timezone, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
    [title, description, start_at, end_at, timezone, user.id]
  );
  const eventId = Number(ins.insertId);

  // Participants
  if (solo) {
    await pool.query<ResultSetHeader>(
      `INSERT INTO calendar_event_attendees (event_id, user_id, role, rsvp)
       VALUES (?, ?, 'host', 'pending')`,
      [eventId, user.id]
    );
  } else if (attendee_ids.length) {
    const vals: Array<[number, number, AttendeeRole, Exclude<AttendeeRsvp, null>]> =
      attendee_ids.map((uidNum) => [
        eventId,
        uidNum,
        uidNum === user.id ? "host" : "required",
        "pending",
      ]);

    // INSERT ... VALUES ? => mysql2/promise accepte l'array encapsulé
    await pool.query<ResultSetHeader>(
      `INSERT INTO calendar_event_attendees (event_id, user_id, role, rsvp) VALUES ?`,
      [vals]
    );
  }

  return NextResponse.json({ ok: true, id: eventId });
}
