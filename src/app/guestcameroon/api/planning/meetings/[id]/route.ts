// app/guestmarkets/api/planning/meetings/[taskId]/route.ts
import { NextResponse, NextRequest } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";

type RSVP = "yes" | "no" | "maybe" | "pending";

/** Lignes renvoyées par la requête SELECT de l'événement */
interface CalendarEventRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  start_at: string; // ISO datetime stockée en DB
  end_at: string | null;
  timezone: string | null;
  created_by: number;
  owner_name: string; // COALESCE(u.name,'')
}

/** Lignes renvoyées par la requête SELECT des participants */
interface AttendeeRow extends RowDataPacket {
  user_id: number;
  name: string; // COALESCE(u.name,'')
  email: string; // COALESCE(u.email,'')
  role: string; // host / required / optional ...
  rsvp: RSVP | null;
}

/** Body accepté par PATCH */
type PatchBody = {
  title?: string;
  description?: string | null;
  start_at?: string;
  end_at?: string | null;
  timezone?: string;
  attendee_ids?: Array<number | string>;
};

/** Helper pour extraire un message d'erreur sans utiliser `any` */
function getErrorMessage(err: unknown, fallback = "Server error"): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim().length > 0) return m;
  }
  return fallback;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser();
    const { id } = await context.params;
    const eventId = Number(id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const [rows] = await pool.query<CalendarEventRow[]>(
      `SELECT ce.id, ce.title, ce.description, ce.start_at, ce.end_at, ce.timezone,
              ce.created_by, COALESCE(u.name,'') AS owner_name
         FROM calendar_events ce
         JOIN users u ON u.id = ce.created_by
        WHERE ce.id = ?
          AND (ce.created_by = ?
               OR EXISTS (SELECT 1 FROM calendar_event_attendees a WHERE a.event_id = ce.id AND a.user_id = ?))`,
      [eventId, user.id, user.id]
    );
    const ev = rows[0];
    if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [att] = await pool.query<AttendeeRow[]>(
      `SELECT a.user_id, COALESCE(u.name,'') AS name, COALESCE(u.email,'') AS email,
              a.role, a.rsvp
         FROM calendar_event_attendees a
         JOIN users u ON u.id = a.user_id
        WHERE a.event_id = ?`,
      [eventId]
    );

    return NextResponse.json({
      item: {
        id: ev.id,
        title: ev.title,
        description: ev.description ?? null,
        start_at: String(ev.start_at),
        end_at: ev.end_at ? String(ev.end_at) : null,
        timezone: String(ev.timezone || "UTC"),
        created_by: ev.created_by,
        owner_name: ev.owner_name,
        attendees: att.map((r) => ({
          user_id: r.user_id,
          name: r.name,
          email: r.email,
          role: r.role,
          rsvp: (r.rsvp as RSVP | null) ?? "pending",
        })),
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

/** PATCH = reprogrammer / éditer titre/desc/heures */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser();
    const { id } = await context.params;
    const eventId = Number(id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as PatchBody;

    // Seul le créateur peut modifier
    const [own] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM calendar_events WHERE id = ? AND created_by = ?`,
      [eventId, user.id]
    );
    if (!own[0]) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const fields: string[] = [];
    const values: unknown[] = [];

    if (typeof body.title === "string") {
      fields.push("title = ?");
      values.push(body.title.trim());
    }
    if ("description" in body) {
      fields.push("description = ?");
      values.push(body.description !== undefined ? body.description : null);
    }
    if (typeof body.start_at === "string") {
      fields.push("start_at = ?");
      values.push(String(body.start_at));
    }
    if (typeof body.end_at === "string") {
      fields.push("end_at = ?");
      values.push(String(body.end_at));
    }
    if (typeof body.timezone === "string") {
      fields.push("timezone = ?");
      values.push(String(body.timezone));
    }

    if (fields.length) {
      values.push(eventId);
      await pool.query<ResultSetHeader>(
        `UPDATE calendar_events SET ${fields.join(", ")} WHERE id = ?`,
        values
      );
    }

    // Optionnel: remplacer la liste des participants (hors host)
    if (Array.isArray(body.attendee_ids)) {
      const attIds = Array.from(
        new Set(
          body.attendee_ids
            .map((n) => Number(n))
            .filter((v) => Number.isFinite(v) && v > 0)
        )
      );

      await pool.query<ResultSetHeader>(
        `DELETE FROM calendar_event_attendees WHERE event_id = ? AND role <> 'host'`,
        [eventId]
      );

      if (attIds.length) {
        // On évite de réinsérer l'hôte
        const rowsToInsert = attIds
          .filter((v) => v !== user.id)
          .map((uid) => [eventId, uid, "required", "pending"] as const);

        if (rowsToInsert.length) {
          await pool.query<ResultSetHeader>(
            `INSERT INTO calendar_event_attendees (event_id, user_id, role, rsvp)
             VALUES ${rowsToInsert.map(() => "(?,?,?,?)").join(",")}`,
            rowsToInsert.flat()
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

/** DELETE = supprimer une réunion (créateur uniquement) */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser();
    const { id } = await context.params;
    const eventId = Number(id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const [own] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM calendar_events WHERE id = ? AND created_by = ?`,
      [eventId, user.id]
    );
    if (!own[0]) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await pool.query<ResultSetHeader>(
      `DELETE FROM calendar_event_attendees WHERE event_id = ?`,
      [eventId]
    );
    await pool.query<ResultSetHeader>(
      `DELETE FROM calendar_events WHERE id = ?`,
      [eventId]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
