// app/api/activities/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { requireManager } from "../../../../../lib/manager";
import type { RowDataPacket } from "mysql2/promise";

export const runtime = "nodejs";
export const revalidate = 0;

function avatarFromTitle(t: string | null | undefined): string {
  const c = t?.trim()?.charAt(0)?.toUpperCase();
  return c && /[A-Z]/.test(c) ? c : "•";
}

interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
  status: "done" | string;
  updated_at: string | Date;
}

interface MeetingRow extends RowDataPacket {
  id: number;
  title: string;
  updated_at: string | Date; // aliasing start_at as updated_at in the query
}

type ActivityPublic = {
  id: string;
  avatar: string;
  action: string;
  user: "Vous";
  time: string; // ISO string for JSON
};

type ActivityInternal = ActivityPublic & {
  _ts: number; // internal numeric timestamp for sorting
};

export async function GET() {
  try {
    const { userId } = await requireManager();
    const pool = getPool();

    // Dernières tâches (assignées au manager), triées par MAJ
    const [tasks] = await pool.query<TaskRow[]>(
      `
      SELECT t.id, t.title, t.status, t.updated_at
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id = :uid
      ORDER BY t.updated_at DESC
      LIMIT 12
      `,
      { uid: userId }
    );

    // Dernières réunions où il est participant
    const [meetings] = await pool.query<MeetingRow[]>(
      `
      SELECT e.id, e.title, e.start_at AS updated_at
      FROM calendar_events e
      INNER JOIN calendar_event_attendees a ON a.event_id = e.id
      WHERE a.user_id = :uid AND e.type = 'meeting'
      ORDER BY e.start_at DESC
      LIMIT 8
      `,
      { uid: userId }
    );

    const acts: ActivityInternal[] = [];

    tasks.forEach((t) => {
      const updated = new Date(t.updated_at);
      const action =
        t.status === "done"
          ? `Tâche terminée : ${t.title}`
          : `Tâche mise à jour : ${t.title}`;
      acts.push({
        id: `task-${t.id}`,
        avatar: avatarFromTitle(t.title),
        action,
        user: "Vous",
        time: updated.toISOString(),
        _ts: updated.getTime(),
      });
    });

    meetings.forEach((m) => {
      const updated = new Date(m.updated_at);
      acts.push({
        id: `meet-${m.id}`,
        avatar: avatarFromTitle(m.title),
        action: `Réunion planifiée : ${m.title}`,
        user: "Vous",
        time: updated.toISOString(),
        _ts: updated.getTime(),
      });
    });

    // Tri global, les plus récents d'abord
    acts.sort((a, b) => b._ts - a._ts);

    // Construire le payload public sans destructurer _ts (évite no-unused-vars)
    const payload: ActivityPublic[] = acts.slice(0, 15).map((a) => ({
      id: a.id,
      avatar: a.avatar,
      action: a.action,
      user: a.user,
      time: a.time,
    }));

    return NextResponse.json(payload, { status: 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";

    const readable =
      msg === "Forbidden" ? "Forbidden"
      : msg === "Unauthorized" ? "Unauthorized"
      : "Server error";

    const status =
      readable === "Server error" ? 500
      : readable === "Unauthorized" ? 401
      : 403;

    return NextResponse.json({ error: readable }, { status });
  }
}
