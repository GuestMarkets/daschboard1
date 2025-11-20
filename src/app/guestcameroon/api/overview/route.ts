// app/api/overview/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/auth";

/**
 * GET /api/overview
 * On ignore volontairement le scope demandé par le client et on recalcule côté serveur :
 * - Admin  → global
 * - Manager de département → department
 * - Sinon → self
 *
 * Sortie : { tasks, meetings, goals, projects, actions }
 */
export async function GET(_req: Request) {
  try {
    // Auth + statut validé (throws si KO)
    const { user } = await requireUser();

    // Détermine si l’utilisateur est responsable d’au moins un département
    const [leadDeps] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM departments WHERE manager_id = ? LIMIT 1",
      [user.id]
    );
    const isDepartmentLead = (leadDeps as RowDataPacket[]).length > 0;

    type Scope = "global" | "department" | "self";
    const scope: Scope = user.is_admin ? "global" : isDepartmentLead ? "department" : "self";

    // WHERE helpers (on passe TOUJOURS par un alias 'u' pour l’utilisateur lié à la ligne)
    const whereSelf = "u.id = ?";
    const whereDeptUsers = "u.department_id IN (SELECT id FROM departments WHERE manager_id = ?)";
    const whereAll = "1=1";

    const whereUsers = scope === "global" ? whereAll : scope === "department" ? whereDeptUsers : whereSelf;
    const whereParamUsers: [] | [number] = scope === "global" ? [] : [user.id];

    // ==== Types de lignes ====
    type ISODateish = string | Date | null;

    interface TaskRow extends RowDataPacket {
      id: number;
      title: string;
      description: string | null;
      priority: string | null;
      status: string;
      progress: number | null;
      due_date: string | null;
      due_time: string | null;
      assignee_id: number;
      assignee_name: string | null;
      assignee_dept: string | null;
      project_id: null; // compat UI (sans projet)
      project_name: null; // compat UI (sans projet)
      created_at: ISODateish;
      updated_at: ISODateish;
    }

    interface MeetingRow extends RowDataPacket {
      id: number;
      title: string;
      description: string | null;
      start_at: ISODateish;
      end_at: ISODateish;
      status: "in_progress" | "scheduled" | "missed" | "done";
      location: null;
    }

    interface GoalRow extends RowDataPacket {
      id: number;
      title: string;
      current: number | null;
      target: number | null;
      start_date: string | null;
      end_date: string | null;
      status: string;
      owner_id: number;
      owner_name: string | null;
      owner_dept: string | null;
    }

    interface ProjectRow extends RowDataPacket {
      id: number;
      name: string;
      code: string | null;
      status: string;
      progress: number | null;
      end_date: string | null;
      manager_id: number;
      manager_name: string | null;
      manager_dept: string | null;
      created_at: ISODateish;
      updated_at: ISODateish;
    }

    type ActionItemType = "task" | "meeting" | "goal" | "project";
    interface ActionItem {
      id: string;
      type: ActionItemType;
      title: string;
      user: string | null;
      at: string; // ISO string
      color: string;
    }

    const dateToIso = (v: ISODateish): string | null => {
      if (!v) return null;
      return v instanceof Date ? v.toISOString() : v;
    };

    // ====== TASKS (ta BD n’a pas project_id ; owner = created_by) ======
    // On expose des alias pour rester compatible avec l’UI :
    // - assignee_id / assignee_name / assignee_dept
    // - project_id / project_name => NULL (l’UI affichera "Sans projet")
    const [taskRows] = await pool.query<(TaskRow & RowDataPacket)[]>(
      `
      SELECT
        t.id,
        t.title,
        t.description,
        t.priority,
        t.status,
        t.progress,
        t.due_date,
        t.due_time,
        t.created_by                AS assignee_id,
        u.name                      AS assignee_name,
        d.name                      AS assignee_dept,
        NULL                        AS project_id,
        NULL                        AS project_name,
        t.created_at,
        t.updated_at
      FROM tasks t
      LEFT JOIN users u        ON u.id = t.created_by
      LEFT JOIN departments d  ON d.id = u.department_id
      WHERE ${whereUsers}
      ORDER BY COALESCE(t.due_date, '9999-12-31') ASC, t.id DESC
      `,
      whereParamUsers
    );

    // ====== MEETINGS (depuis calendar_events, type = 'meeting') ======
    // On map 'ongoing' -> 'in_progress' pour la compat UI.
    const [meetRows] = await pool.query<(MeetingRow & RowDataPacket)[]>(
      `
      SELECT
        ce.id,
        ce.title,
        ce.description,
        ce.start_at,
        ce.end_at,
        CASE
          WHEN ce.status = 'ongoing' THEN 'in_progress'
          WHEN ce.status = 'scheduled' THEN 'scheduled'
          WHEN ce.status = 'missed' THEN 'missed'
          WHEN ce.status = 'done' THEN 'done'
          ELSE 'scheduled'
        END AS status,
        NULL AS location
      FROM calendar_events ce
      LEFT JOIN users u ON u.id = ce.created_by
      WHERE ce.type = 'meeting'
        AND ${whereUsers}
      ORDER BY ce.start_at DESC
      `,
      whereParamUsers
    );

    // ====== GOALS (objectives) ======
    const [goalRows] = await pool.query<(GoalRow & RowDataPacket)[]>(
      `
      SELECT
        g.id,
        g.title,
        g.current,
        g.target,
        g.start_date,
        g.end_date,
        g.status,
        g.user_id        AS owner_id,
        u.name           AS owner_name,
        d.name           AS owner_dept
      FROM objectives g
      LEFT JOIN users u       ON u.id = g.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${whereUsers}
      ORDER BY g.end_date ASC
      `,
      whereParamUsers
    );

    // ====== PROJECTS (filtrés par département du manager pour scope=department) ======
    // - global     → tous
    // - department → projets dont le manager est dans un département managé par l'utilisateur courant
    // - self       → projets dont le manager est l'utilisateur courant
    const whereProjects =
      scope === "global"
        ? "1=1"
        : scope === "department"
        ? "um.department_id IN (SELECT id FROM departments WHERE manager_id = ?)"
        : "um.id = ?";
    const whereParamProjects: [] | [number] = scope === "global" ? [] : [user.id];

    const [projRows] = await pool.query<(ProjectRow & RowDataPacket)[]>(
      `
      SELECT
        p.id,
        p.name,
        p.code,
        p.status,
        p.progress,
        p.end_date,
        p.manager_id,
        um.name AS manager_name,
        dm.name AS manager_dept,
        p.created_at,
        p.updated_at
      FROM projects p
      LEFT JOIN users um       ON um.id = p.manager_id
      LEFT JOIN departments dm ON dm.id = um.department_id
      WHERE ${whereProjects}
      ORDER BY p.end_date ASC
      `,
      whereParamProjects
    );

    // ====== ACTIONS (synthèse simple) ======
    const taskActions: ActionItem[] = taskRows
      .map<ActionItem | null>((r) => {
        const at = dateToIso(r.updated_at ?? r.created_at);
        if (!at) return null;
        return {
          id: `task-${r.id}`,
          type: "task",
          title: `Tâche: ${r.title}`,
          user: r.assignee_name || null,
          at,
          color: "#c7d2fe",
        };
      })
      .filter((a): a is ActionItem => a !== null);

    const meetingActions: ActionItem[] = meetRows
      .map<ActionItem | null>((r) => {
        const at = dateToIso(r.start_at);
        if (!at) return null;
        return {
          id: `meeting-${r.id}`,
          type: "meeting",
          title: `Réunion: ${r.title}`,
          user: null,
          at,
          color: "#fbcfe8",
        };
      })
      .filter((a): a is ActionItem => a !== null);

    const goalActions: ActionItem[] = goalRows
      .map<ActionItem | null>((r) => {
        const at = r.end_date ?? null;
        if (!at) return null;
        return {
          id: `goal-${r.id}`,
          type: "goal",
          title: `Objectif: ${r.title}`,
          user: r.owner_name || null,
          at,
          color: "#e9d5ff",
        };
      })
      .filter((a): a is ActionItem => a !== null);

    const projectActions: ActionItem[] = projRows
      .map<ActionItem | null>((r) => {
        const at = dateToIso(r.updated_at ?? r.created_at);
        if (!at) return null;
        return {
          id: `project-${r.id}`,
          type: "project",
          title: `Projet: ${r.name}`,
          user: r.manager_name || null,
          at,
          color: "#fee2e2",
        };
      })
      .filter((a): a is ActionItem => a !== null);

    const actions: ActionItem[] = [...taskActions, ...meetingActions, ...goalActions, ...projectActions]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 60);

    // Réponse unique
    return NextResponse.json({
      scope, // utile côté client pour affichage
      tasks: taskRows,
      meetings: meetRows,
      goals: goalRows,
      projects: projRows,
      actions,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
