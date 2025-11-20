// app/api/planning/meetings/[taskId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../../../../lib/auth";
import { pool } from "../../../../../../lib/db";
import type { RowDataPacket } from "mysql2/promise";

/* ---- Types ---- */

type EventStatus = "scheduled" | "ongoing" | "missed" | "done";

interface CalendarEventBase extends RowDataPacket {
  id: number;
  created_by: number;
  start_at: string;      // ex: "2025-10-21 10:00:00"
  end_at: string;        // ex: "2025-10-21 11:00:00"
  started_at: string | null;
  status: EventStatus;
  title?: string;
  description?: string | null;
}

interface CalendarEventOwner extends RowDataPacket {
  id: number;
  created_by: number;
}

type PatchBody =
  | { action: "start" }
  | {
      action: "edit";
      title?: string;
      description?: string | null;
      start_at?: string;
      end_at?: string;
    }
  | { action?: string };

/* ---- Helpers ---- */

async function parseBody<T>(req: Request, fallback: T): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return fallback;
  }
}

function toDate(value: string): Date {
  // La DB renvoie "YYYY-MM-DD HH:mm:ss" → on remplace l'espace par "T"
  return new Date(value.replace(" ", "T"));
}

/* ---- Routes ---- */

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> } // ✅ params asynchrone attendu par le validator
) {
  const { id: idParam } = await ctx.params; // ✅ on "await" params
  const id = Number(idParam);

  const { user } = await requireUser();

  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await parseBody<PatchBody>(req, {});

  const [rows] = await pool.query<CalendarEventBase[]>(
    `SELECT id, created_by, start_at, end_at, started_at, status, title, description
       FROM calendar_events
      WHERE id=? LIMIT 1`,
    [id]
  );

  const ev = rows?.[0];
  if (!ev) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (Number(ev.created_by) !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const s = toDate(String(ev.start_at));
  const e = toDate(String(ev.end_at));
  const isLaunched = !!ev.started_at;

  const action = String(body.action || "").trim();

  if (action === "start") {
    if (now < s || now >= e) {
      return NextResponse.json(
        { error: "Vous ne pouvez lancer qu'entre l'heure de début et de fin." },
        { status: 400 }
      );
    }

    await pool.query(
      `UPDATE calendar_events
          SET started_at = NOW(), status='ongoing'
        WHERE id=? AND started_at IS NULL`,
      [id]
    );

    return NextResponse.json({ ok: true });
  }

  if (action === "edit") {
    const editBody = body as Extract<PatchBody, { action: "edit" }>;

    const title =
      typeof editBody.title === "string" ? (editBody.title ?? "").trim() : ev.title ?? "";

    const description =
      typeof editBody.description === "string" ? editBody.description : ev.description ?? null;

    const start_at = String(editBody.start_at ?? ev.start_at);
    const end_at = String(editBody.end_at ?? ev.end_at);

    // validations
    const sNew = toDate(start_at);
    const eNew = toDate(end_at);
    if (!(eNew.getTime() > sNew.getTime())) {
      return NextResponse.json({ error: "Heure de fin invalide" }, { status: 400 });
    }

    // Cas refusé : déjà lancée et terminée → on empêche la modification “horaire”
    const ended = now.getTime() >= e.getTime();
    if (isLaunched && ended) {
      return NextResponse.json(
        { error: "Déjà terminée, modification horaire impossible" },
        { status: 400 }
      );
    }

    // Interdit de reprogrammer dans moins de 30 min
    if (sNew.getTime() < Date.now() + 30 * 60 * 1000) {
      return NextResponse.json(
        { error: "La réunion doit commencer dans ≥ 30 min" },
        { status: 400 }
      );
    }

    await pool.query(
      `UPDATE calendar_events
          SET title=?,
              description=?,
              start_at=?,
              end_at=?,
              started_at = IF(status='missed', NULL, started_at)
        WHERE id=?`,
      [title || "", description, start_at, end_at, id]
    );

    // Recalcule status immédiatement après modif
    await pool.query(
      `UPDATE calendar_events ev
          SET status = (
            CASE
              WHEN ev.started_at IS NOT NULL AND NOW() >= ev.end_at THEN 'done'
              WHEN ev.started_at IS NOT NULL AND NOW() <  ev.end_at THEN 'ongoing'
              WHEN ev.started_at IS NULL     AND NOW() >  ev.end_at THEN 'missed'
              ELSE 'scheduled'
            END
          )
        WHERE ev.id = ?`,
      [id]
    );

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> } // ✅ params asynchrone
) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);

  const { user } = await requireUser();

  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [rows] = await pool.query<CalendarEventOwner[]>(
    `SELECT id, created_by FROM calendar_events WHERE id=? LIMIT 1`,
    [id]
  );

  const ev = rows?.[0];
  if (!ev) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (Number(ev.created_by) !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await pool.query(`DELETE FROM calendar_events WHERE id=?`, [id]);
  // On ne fait pas échouer la suppression si la table attendees n'existe pas / autre souci
  await pool.query(`DELETE FROM calendar_event_attendees WHERE event_id=?`, [id]).catch(() => {});

  return NextResponse.json({ ok: true });
}
