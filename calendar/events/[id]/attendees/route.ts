// app/api/calendar/events/[taskId]/attendees/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../../../../lib/db";
import { requireUser } from "../../../../../../../lib/auth";
import { getUserRow, getLeadTeamMemberIds } from "../../../../../../../lib/rbac";

// Corps attendu du POST
type AttendeesPatchBody = {
  add?: Array<number | string>;
  remove?: Array<number | string>;
};

// POST { add:[userId...], remove:[userId...] }
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // ⚠️ Avec la config de ton projet, params est un Promise -> on l'attend
  const { id } = await context.params;

  const { user } = await requireUser();
  const me = await getUserRow(user.id);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
  }

  // Récupération du body
  let body: AttendeesPatchBody;
  try {
    body = (await request.json()) as AttendeesPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const toAdd: number[] = (body.add ?? [])
    .map((v) => Number(v))
    .filter(Number.isFinite);
  const toRemove: number[] = (body.remove ?? [])
    .map((v) => Number(v))
    .filter(Number.isFinite);

  // Vérifier que l'event existe et récupérer le créateur
  const [evr] = await pool.query<RowDataPacket[]>(
    `SELECT created_by FROM calendar_events WHERE id=? AND type='meeting'`,
    [eventId]
  );
  if (!evr || evr.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ownerId = Number(evr[0].created_by);
  const isOwner = ownerId === me.id;
  const isSuper = Boolean(me.is_admin) || me.role === "superAdmin";
  if (!isOwner && !isSuper) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Déterminer le scope d'ajout autorisé
  let allowedIds: number[] = [];
  if (isSuper) {
    const [actives] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM users WHERE status='active'`
    );
    allowedIds = (actives ?? [])
      .map((r) => Number(r.id))
      .filter(Number.isFinite);
  } else if (me.is_manager && me.department_id) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM users WHERE status='active' AND department_id=?`,
      [me.department_id]
    );
    allowedIds = (rows ?? []).map((r) => Number(r.id)).filter(Number.isFinite);
  } else {
    allowedIds = await getLeadTeamMemberIds(me.id);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Ajouts
    for (const uid of toAdd) {
      if (!isSuper && !allowedIds.includes(uid)) continue;
      await conn.query(
        `INSERT IGNORE INTO calendar_event_attendees (event_id,user_id,role,rsvp)
         VALUES (?,?, 'required','pending')`,
        [eventId, uid]
      );
    }

    // Retraits (on ne supprime pas l'hôte via cet endpoint)
    for (const uid of toRemove) {
      await conn.query(
        `DELETE FROM calendar_event_attendees 
         WHERE event_id=? AND user_id=? AND role<>'host'`,
        [eventId, uid]
      );
    }

    await conn.commit();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur maj participants";
    try {
      await conn.rollback();
    } catch {
      // ignore rollback error
    }
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    conn.release();
  }
}
