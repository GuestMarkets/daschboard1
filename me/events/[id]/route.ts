// app/api/me/events/[taskId]/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";
import type { RowDataPacket } from "mysql2";

// --- Types utilitaires DB ---
interface CreatedByRow extends RowDataPacket {
  created_by: number;
}

interface Attendee {
  user_id: number;
  role: string;
  rsvp: string | null;
}

// ATTENTION: selon la config MySQL, JSON_ARRAYAGG renvoie souvent une string JSON.
// On la typpe en string|null puis on parse manuellement.
interface EventRow extends RowDataPacket {
  // colonnes de e.* (non exhaustif)
  attendees: string | null; // JSON stringifié d'un tableau d'Attendee, ou null
}

// Corps attendu sur le PATCH
interface PatchBody {
  title?: string;
  description?: string;
  type?: string;
  timezone?: string;
  visibility?: string;
  all_day?: boolean;
  start_at?: string; // ou Date si vous stockez en DATETIME -> adapter ici
  end_at?: string;
}

// Paramètres pour l'UPDATE avec placeholders nommés
type PatchParams = {
  id: number;
  title?: string;
  description?: string;
  type?: string;
  timezone?: string;
  visibility?: string;
  all_day?: 0 | 1;
  start_at?: string;
  end_at?: string;
};

// (Optionnel) expliciter le runtime si nécessaire
// export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser();

    // Dans Next 15+, context.params est un Promise
    const { id: idParam } = await context.params;
    const id = Number(idParam);

    const body: PatchBody = await req.json();

    // sécurité: seul le créateur peut modifier
    const [rows] = await pool.query<CreatedByRow[]>(
      `SELECT created_by FROM calendar_events WHERE id=:id`,
      { id }
    );
    const row = rows[0];
    if (!row) throw new Error("Not found");
    if (row.created_by !== user.id) throw new Error("Forbidden");

    const patch: string[] = [];
    const p: PatchParams = { id };

    for (const k of ["title", "description", "type", "timezone", "visibility"] as const) {
      if (k in body) {
        patch.push(`${k} = :${k}`);
        // ts-expect-error indexation contrôlée par 'as const' ci-dessus
        p[k] = body[k] as never;
      }
    }
    if ("all_day" in body) {
      patch.push(`all_day = :all_day`);
      p.all_day = body.all_day ? 1 : 0;
    }
    if ("start_at" in body) {
      patch.push(`start_at = :start_at`);
      p.start_at = body.start_at;
    }
    if ("end_at" in body) {
      patch.push(`end_at = :end_at`);
      p.end_at = body.end_at;
    }

    if (!patch.length) {
      // Rien à mettre à jour
      return NextResponse.json({ ok: true });
    }

    await pool.query(
      `UPDATE calendar_events SET ${patch.join(", ")} WHERE id=:id`,
      p
    );

    const [full] = await pool.query<EventRow[]>(
      `SELECT e.*, JSON_ARRAYAGG(
          JSON_OBJECT('user_id', a.user_id, 'role', a.role, 'rsvp', a.rsvp)
        ) AS attendees
       FROM calendar_events e
       LEFT JOIN calendar_event_attendees a ON a.event_id = e.id
       WHERE e.id = :id
       GROUP BY e.id`,
      { id }
    );

    const itemRow = full[0];

    // MySQL peut renvoyer "[null]" si aucun attendee -> on filtre proprement
    const attendees: Attendee[] = itemRow?.attendees
      ? (JSON.parse(itemRow.attendees) as (Attendee | null)[]).filter(
          (x): x is Attendee => !!x && typeof x.user_id === "number"
        )
      : [];

    // On reconstruit l'objet retourné en y remplaçant 'attendees' (string) par le tableau parsé
    const item = itemRow ? { ...itemRow, attendees } : null;

    return NextResponse.json({ item });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser();

    const { id: idParam } = await context.params;
    const id = Number(idParam);

    const [rows] = await pool.query<CreatedByRow[]>(
      `SELECT created_by FROM calendar_events WHERE id=:id`,
      { id }
    );
    const row = rows[0];
    if (!row) throw new Error("Not found");
    if (row.created_by !== user.id) throw new Error("Forbidden");

    await pool.query(`DELETE FROM calendar_events WHERE id=:id`, { id });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
