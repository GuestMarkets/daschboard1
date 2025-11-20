// app/api/calendar/events/[taskId]/rsvp/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";

// Force Node.js runtime (si lib/db utilise des modules Node)
export const runtime = "nodejs";
// Pas de cache sur cette route
export const dynamic = "force-dynamic";

type RSVP = "yes" | "no" | "maybe";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  // Selon ton Next, ctx.params est une Promise -> on l'attend
  const { id } = await ctx.params;

  // Auth (si requireUser lit les cookies/headers tout seul, garde sans arg)
  const { user } = await requireUser();

  // Validation de l'ID
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "ID d'événement invalide" }, { status: 400 });
  }

  // Lecture corps JSON avec garde
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const rsvp = (body as { rsvp?: string })?.rsvp as RSVP | undefined;

  // Validation rsvp
  if (rsvp !== "yes" && rsvp !== "no" && rsvp !== "maybe") {
    return NextResponse.json({ error: "RSVP invalide" }, { status: 400 });
  }

  // UPDATE (placeholder '?' si tu es sur MySQL/SQLite ; pour Postgres remplacer par $1, $2, $3)
  await pool.query(
    `UPDATE calendar_event_attendees
     SET rsvp = ?
     WHERE event_id = ? AND user_id = ?`,
    [rsvp, eventId, user.id]
  );

  return NextResponse.json({ ok: true });
}