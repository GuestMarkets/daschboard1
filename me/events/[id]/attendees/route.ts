// app/api/me/events/[taskId]/attendees/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

// --- Types locaux ---
type AttendeeRole = "required" | "optional";
type RSVP = "yes" | "no" | "maybe" | "pending";

// IMPORTANT : hérite de RowDataPacket pour matcher la contrainte de mysql2
type CreatorRow = RowDataPacket & {
  created_by: number;
};

function getErrorMessage(e: unknown, fallback = "Unexpected error"): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

async function getEventId(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const event_id = Number(id);
  if (!Number.isFinite(event_id)) throw new Error("Invalid event id");
  return event_id;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser();
    const event_id = await getEventId(context);

    const bodyUnknown = (await req.json()) as unknown;
    const { user_id, role } = (() => {
      if (
        typeof bodyUnknown === "object" &&
        bodyUnknown !== null &&
        "user_id" in bodyUnknown
      ) {
        const record = bodyUnknown as Record<string, unknown>;
        const u = record["user_id"];
        const r = record["role"];
        const parsedUserId = typeof u === "number" ? u : Number(u);
        const parsedRole: AttendeeRole =
          r === "required" || r === "optional" ? r : "required";

        return { user_id: parsedUserId, role: parsedRole };
      }
      throw new Error("Invalid body: { user_id, role? } expected");
    })();

    if (!Number.isFinite(user_id)) throw new Error("Invalid user_id");

    // vérifier que je suis le créateur
    const [rows] = await pool.query<CreatorRow[]>(
      `SELECT created_by FROM calendar_events WHERE id=:id`,
      { id: event_id }
    );
    const row = rows[0];
    if (!row) throw new Error("Not found");
    if (row.created_by !== user.id) throw new Error("Forbidden");

    await pool.query(
      `INSERT INTO calendar_event_attendees (event_id, user_id, role, rsvp)
       VALUES (:event_id, :user_id, :role, 'pending')
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      { event_id, user_id, role }
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e, "Add attendee failed") },
      { status: 400 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser();
    const event_id = await getEventId(context);

    const bodyUnknown = (await req.json()) as unknown;
    const { rsvp } = (() => {
      if (
        typeof bodyUnknown === "object" &&
        bodyUnknown !== null &&
        "rsvp" in bodyUnknown
      ) {
        const v = (bodyUnknown as Record<string, unknown>)["rsvp"];
        if (v === "yes" || v === "no" || v === "maybe" || v === "pending") {
          return { rsvp: v as RSVP };
        }
      }
      throw new Error(
        "Invalid body: { rsvp: 'yes'|'no'|'maybe'|'pending' } expected"
      );
    })();

    await pool.query(
      `UPDATE calendar_event_attendees
       SET rsvp=:rsvp
       WHERE event_id=:event_id AND user_id=:uid`,
      { rsvp, event_id, uid: user.id }
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e, "RSVP failed") },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser();
    const event_id = await getEventId(context);

    const bodyUnknown = (await req.json()) as unknown;
    const { user_id } = (() => {
      if (
        typeof bodyUnknown === "object" &&
        bodyUnknown !== null &&
        "user_id" in bodyUnknown
      ) {
        const u = (bodyUnknown as Record<string, unknown>)["user_id"];
        return { user_id: typeof u === "number" ? u : Number(u) };
      }
      throw new Error("Invalid body: { user_id } expected");
    })();

    if (!Number.isFinite(user_id)) throw new Error("Invalid user_id");

    // seul créateur peut retirer un participant
    const [rows] = await pool.query<CreatorRow[]>(
      `SELECT created_by FROM calendar_events WHERE id=:id`,
      { id: event_id }
    );
    const row = rows[0];
    if (!row) throw new Error("Not found");
    if (row.created_by !== user.id) throw new Error("Forbidden");

    await pool.query(
      `DELETE FROM calendar_event_attendees
       WHERE event_id=:event_id AND user_id=:user_id`,
      { event_id, user_id }
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e, "Remove attendee failed") },
      { status: 400 }
    );
  }
}
