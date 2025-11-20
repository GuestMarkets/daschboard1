// app/api/manager/performance/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { requireManager } from "../../../../../lib/manager";
import type { RowDataPacket } from "mysql2";

export const runtime = "nodejs";
export const revalidate = 0;

type SeriesPoint = { label: string; done: number };

type TotalsBlock = {
  total: number;
  done: number;
  blocked: number;
  in_progress: number;
  todo: number;
  overdue: number;
  avg_progress: number;
};

type TeamBlock = {
  totals: TotalsBlock;
  series: SeriesPoint[];
} | null;

function fmtWeek(ywk: number): string {
  // MySQL YEARWEEK(..., 3) style -> e.g. 202539 => "2025-W39"
  const s = String(ywk);
  return `${s.slice(0, 4)}-W${s.slice(4)}`;
}

// ---- Types de lignes MySQL (résultats agrégés) ----
interface AggRow extends RowDataPacket {
  done: number;
  blocked: number;
  in_prog: number;
  todo: number;
  total: number;
  avg_prog: number;
}

interface OverdueRow extends RowDataPacket {
  overdue: number;
}

interface VelocityRow extends RowDataPacket {
  done7: number;
}

interface SeriesRow extends RowDataPacket {
  ywk: number;
  c: number;
}

interface IdRow extends RowDataPacket {
  id: number;
}

interface TeamIdRow extends RowDataPacket {
  team_id: number;
}

interface UserIdRow extends RowDataPacket {
  user_id: number;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "Unknown error";
  }
}

export async function GET() {
  try {
    const { userId, departmentId } = await requireManager();
    const pool = getPool();

    // ---- Moi : tâches assignées à moi ----
    const [mine] = await pool.query<AggRow[]>(
      `
      SELECT
        SUM(t.status='done')           AS done,
        SUM(t.status='blocked')        AS blocked,
        SUM(t.status='in_progress')    AS in_prog,
        SUM(t.status='todo')           AS todo,
        COUNT(*)                       AS total,
        AVG(t.progress)                AS avg_prog
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id = :uid
      `,
      { uid: userId }
    );

    const [mineOverdue] = await pool.query<OverdueRow[]>(
      `
      SELECT COUNT(*) AS overdue
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id = :uid
        AND t.status <> 'done'
        AND t.due_date < CURDATE()
      `,
      { uid: userId }
    );

    const [mineVelocity] = await pool.query<VelocityRow[]>(
      `
      SELECT COUNT(*) AS done7
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id = :uid
        AND t.status = 'done'
        AND t.updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `,
      { uid: userId }
    );

    const [mineSeries] = await pool.query<SeriesRow[]>(
      `
      SELECT YEARWEEK(t.updated_at, 3) AS ywk, COUNT(*) AS c
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id = :uid AND t.status='done'
        AND t.updated_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
      GROUP BY YEARWEEK(t.updated_at, 3)
      ORDER BY YEARWEEK(t.updated_at, 3)
      `,
      { uid: userId }
    );

    // ---- Département : tâches assignées aux membres du département ----
    const [deptUsers] = await pool.query<IdRow[]>(
      `SELECT id FROM users WHERE department_id = :dep AND status='active'`,
      { dep: departmentId }
    );

    const depIds = deptUsers.map((u) => Number(u.id));
    const depIdsList = depIds.length ? depIds : [-1];

    const [deptAgg] = await pool.query<AggRow[]>(
      `
      SELECT
        SUM(t.status='done')           AS done,
        SUM(t.status='blocked')        AS blocked,
        SUM(t.status='in_progress')    AS in_prog,
        SUM(t.status='todo')           AS todo,
        COUNT(*)                       AS total,
        AVG(t.progress)                AS avg_prog
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id IN (${depIdsList.map(() => "?").join(",")})
      `,
      depIdsList
    );

    const [deptOverdue] = await pool.query<OverdueRow[]>(
      `
      SELECT COUNT(*) AS overdue
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id IN (${depIdsList.map(() => "?").join(",")})
        AND t.status <> 'done'
        AND t.due_date < CURDATE()
      `,
      depIdsList
    );

    const [deptSeries] = await pool.query<SeriesRow[]>(
      `
      SELECT YEARWEEK(t.updated_at, 3) AS ywk, COUNT(*) AS c
      FROM tasks t
      INNER JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id IN (${depIdsList.map(() => "?").join(",")})
        AND t.status='done'
        AND t.updated_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
      GROUP BY YEARWEEK(t.updated_at, 3)
      ORDER BY YEARWEEK(t.updated_at, 3)
      `,
      depIdsList
    );

    // ---- Équipe (si vous êtes chef d'au moins une équipe) ----
    const [leadTeams] = await pool.query<TeamIdRow[]>(
      `
      SELECT DISTINCT tm.team_id
      FROM team_members tm
      INNER JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = :uid AND tm.role_in_team = 'lead' AND t.is_deleted = 0
      `,
      { uid: userId }
    );
    const leadTeamIds = leadTeams.map((x) => Number(x.team_id));

    let teamBlock: TeamBlock = null;
    if (leadTeamIds.length) {
      const [teamMembers] = await pool.query<UserIdRow[]>(
        `
        SELECT DISTINCT user_id FROM team_members
        WHERE team_id IN (${leadTeamIds.map(() => "?").join(",")})
        `,
        leadTeamIds
      );
      const teamUserIds = teamMembers.map((x) => Number(x.user_id));
      const teamIdsList = teamUserIds.length ? teamUserIds : [-1];

      const [teamAgg] = await pool.query<AggRow[]>(
        `
        SELECT
          SUM(t.status='done')           AS done,
          SUM(t.status='blocked')        AS blocked,
          SUM(t.status='in_progress')    AS in_prog,
          SUM(t.status='todo')           AS todo,
          COUNT(*)                       AS total,
          AVG(t.progress)                AS avg_prog
        FROM tasks t
        INNER JOIN task_assignees ta ON ta.task_id = t.id
        WHERE ta.user_id IN (${teamIdsList.map(() => "?").join(",")})
        `,
        teamIdsList
      );

      const [teamOverdue] = await pool.query<OverdueRow[]>(
        `
        SELECT COUNT(*) AS overdue
        FROM tasks t
        INNER JOIN task_assignees ta ON ta.task_id = t.id
        WHERE ta.user_id IN (${teamIdsList.map(() => "?").join(",")})
          AND t.status <> 'done'
          AND t.due_date < CURDATE()
        `,
        teamIdsList
      );

      const [teamSeries] = await pool.query<SeriesRow[]>(
        `
        SELECT YEARWEEK(t.updated_at, 3) AS ywk, COUNT(*) AS c
        FROM tasks t
        INNER JOIN task_assignees ta ON ta.task_id = t.id
        WHERE ta.user_id IN (${teamIdsList.map(() => "?").join(",")})
          AND t.status='done'
          AND t.updated_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
        GROUP BY YEARWEEK(t.updated_at, 3)
        ORDER BY YEARWEEK(t.updated_at, 3)
        `,
        teamIdsList
      );

      teamBlock = {
        totals: {
          total: Number(teamAgg[0]?.total ?? 0),
          done: Number(teamAgg[0]?.done ?? 0),
          blocked: Number(teamAgg[0]?.blocked ?? 0),
          in_progress: Number(teamAgg[0]?.in_prog ?? 0),
          todo: Number(teamAgg[0]?.todo ?? 0),
          overdue: Number(teamOverdue[0]?.overdue ?? 0),
          avg_progress: Number(teamAgg[0]?.avg_prog ?? 0),
        },
        series: teamSeries.map((r) => ({ label: fmtWeek(r.ywk), done: Number(r.c) })) as SeriesPoint[],
      };
    }

    const resp = {
      self: {
        totals: {
          total: Number(mine[0]?.total ?? 0),
          done: Number(mine[0]?.done ?? 0),
          blocked: Number(mine[0]?.blocked ?? 0),
          in_progress: Number(mine[0]?.in_prog ?? 0),
          todo: Number(mine[0]?.todo ?? 0),
          overdue: Number(mineOverdue[0]?.overdue ?? 0),
          avg_progress: Number(mine[0]?.avg_prog ?? 0),
          velocity7d: Number(mineVelocity[0]?.done7 ?? 0),
        },
        series: mineSeries.map((r) => ({ label: fmtWeek(r.ywk), done: Number(r.c) })) as SeriesPoint[],
      },
      department: {
        totals: {
          total: Number(deptAgg[0]?.total ?? 0),
          done: Number(deptAgg[0]?.done ?? 0),
          blocked: Number(deptAgg[0]?.blocked ?? 0),
          in_progress: Number(deptAgg[0]?.in_prog ?? 0),
          todo: Number(deptAgg[0]?.todo ?? 0),
          overdue: Number(deptOverdue[0]?.overdue ?? 0),
          avg_progress: Number(deptAgg[0]?.avg_prog ?? 0),
        },
        series: deptSeries.map((r) => ({ label: fmtWeek(r.ywk), done: Number(r.c) })) as SeriesPoint[],
      },
      teamLead: teamBlock, // null si aucune équipe dirigée
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: unknown) {
    const raw = getErrorMessage(err);
    const msg =
      raw === "Forbidden"
        ? "Forbidden"
        : raw === "Unauthorized"
        ? "Unauthorized"
        : "Server error";

    return NextResponse.json(
      { error: msg },
      { status: msg === "Server error" ? 500 : msg === "Unauthorized" ? 401 : 403 }
    );
  }
}
