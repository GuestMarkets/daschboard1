// app/guestmarkets/api/planning/meetings/[taskId]/rsvp/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2/promise";
import { pool } from "../../../../../../../../lib/db";
import { requireUser } from "../../../../../../../../lib/auth";

type AllowedRSVP = "yes" | "no" | "maybe" | "pending";
interface RSVPBody {
  rsvp?: string;
}

// (optionnel) force le runtime Node si nécessaire
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // ⬇️ Dans ta version de Next, params est un Promise — on l'attend donc :
    const { id: idParam } = await context.params;

    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Bad event id" }, { status: 400 });
    }

    const { user } = await requireUser();

    const body: RSVPBody = await req.json().catch(() => ({} as RSVPBody));
    const rsvpStr = (body?.rsvp ?? "pending").toLowerCase();

    const allowedRSVPs: readonly AllowedRSVP[] = [
      "yes",
      "no",
      "maybe",
      "pending",
    ] as const;

    if (!allowedRSVPs.includes(rsvpStr as AllowedRSVP)) {
      return NextResponse.json({ error: "Bad RSVP" }, { status: 400 });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE calendar_event_attendees
         SET rsvp = ?
       WHERE event_id = ? AND user_id = ?`,
      [rsvpStr, id, user.id]
    );

    // (optionnel) vérifier qu’une ligne a bien été mise à jour
    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "No matching attendee for this event/user" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
