// app/guestmarkets/api/scope/tasks/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

/** ---- Types ---- */

type AuthUser = {
  id: number;
  /** bool ou tinyint(1) retourné par ta table users */
  is_admin?: boolean | 0 | 1;
};

interface IdRow extends RowDataPacket {
  id: number;
}

interface TaskRow extends RowDataPacket {
  id: number;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  due_date?: string | Date | null;
  // Le JSON_ARRAYAGG(...) revient généralement en string (JSON) côté mysql2
  assignees: string | null;
}

type Assignee = {
  id: number;
  name: string;
  email: string;
};

type ScopeTask = Omit<TaskRow, "assignees"> & {
  assignees: Assignee[];
  assigneeIds: number[];
};

/** Utilitaire: parse "assignees" venant de MySQL */
function parseAssignees(value: unknown): Assignee[] {
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (a: unknown): a is Assignee =>
              typeof a === "object" &&
              a !== null &&
              typeof (a as Record<string, unknown>).id === "number" &&
              typeof (a as Record<string, unknown>).name === "string" &&
              typeof (a as Record<string, unknown>).email === "string"
          )
          .map((a) => a);
      }
    } catch {
      // ignore, retournera []
    }
  }
  return [];
}

export async function GET() {
  try {
    const { user } = (await requireUser()) as { user: AuthUser };

    // Déterminer la meilleure portée
    const [depLead] = await pool.query<IdRow[]>(
      "SELECT id FROM departments WHERE manager_id = ? LIMIT 1",
      [user.id]
    );
    const [projLead] = await pool.query<IdRow[]>(
      "SELECT id FROM projects WHERE manager_id = ? LIMIT 1",
      [user.id]
    );
    const [teamLead] = await pool.query<IdRow[]>(
      "SELECT id FROM teams WHERE leader_user_id = ? LIMIT 1",
      [user.id]
    );

    const isAdmin = Boolean(user.is_admin);
    const isDep = depLead.length > 0;
    const isProj = projLead.length > 0;
    const isTeam = teamLead.length > 0;

    let userFilterSQL = "ta.user_id = ?";
    let userParams: ReadonlyArray<number> = [user.id];

    if (isAdmin || isDep) {
      // Membres des départements managés
      userFilterSQL =
        "ta.user_id IN (SELECT id FROM users WHERE department_id IN (SELECT id FROM departments WHERE manager_id = ?))";
      userParams = [user.id];
    } else if (isProj) {
      // Membres des équipes des projets managés (via vue vw_project_teams si dispo, sinon fallback)
      const [hasView] = await pool.query<RowDataPacket[]>(
        "SHOW FULL TABLES LIKE 'vw_project_teams'"
      );

      if (hasView.length > 0) {
        userFilterSQL =
          "ta.user_id IN (SELECT user_id FROM vw_project_teams WHERE project_id IN (SELECT id FROM projects WHERE manager_id = ?))";
        userParams = [user.id];
      } else {
        userFilterSQL = `ta.user_id IN (
          SELECT tm.user_id
          FROM team_members tm
          JOIN teams t ON t.id = tm.team_id
          WHERE t.project_id IN (SELECT id FROM projects WHERE manager_id = ?)
        )`;
        userParams = [user.id];
      }
    } else if (isTeam) {
      userFilterSQL =
        "ta.user_id IN (SELECT tm.user_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.leader_user_id = ?)";
      userParams = [user.id];
    }

    // Requête listes + assignees
    const [rows] = await pool.query<TaskRow[]>(
      `
      SELECT
        t.*,
        JSON_ARRAYAGG(JSON_OBJECT('id', a.id, 'name', a.name, 'email', a.email)) AS assignees
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      JOIN users a           ON a.id = ta.user_id
      WHERE ${userFilterSQL}
      GROUP BY t.id
      ORDER BY COALESCE(t.due_date, '9999-12-31') ASC, t.id DESC
      `,
      userParams
    );

    const items: ScopeTask[] = rows.map((r) => {
      const parsedAssignees = parseAssignees(r.assignees);
      return {
        ...r,
        assignees: parsedAssignees,
        assigneeIds: parsedAssignees.map((x) => x.id),
      };
    });

    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
