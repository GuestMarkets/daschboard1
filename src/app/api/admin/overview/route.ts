// app/api/admin/overview/route.ts
import type { NextRequest } from "next/server";
import { num, ok, err, exec } from "../_utils";

/** Types utilitaires */
type SQLParam = string | number | Date | null;

/** 
 * Fournit une index signature pour satisfaire la contrainte de exec<T extends DbRow>.
 * On reste conservateur avec `unknown` pour ne pas affaiblir le typage spécifique des champs.
 */
interface BaseRow {
  [key: string]: unknown;
}

/** Lignes retournées par les requêtes */
interface TaskRow extends BaseRow {
  id: number;
  title: string;
  description: string | null;
  due_date: string | Date | null;
  status: string | null;
  progress: number | null;
  priority: number | null;
  created_at: string | Date;
  updated_at: string | Date | null;
  assignee_id: number | null;
  assignee_name: string | null;
  assignee_dept: string | null;
  project_id: number | null;
  project_name: string | null;
}

interface MeetingRow extends BaseRow {
  id: number;
  title: string;
  start_at: string | Date;
  end_at: string | Date | null;
  location: string | null;
  notes: string | null;
  status: string | null;
  owner_id: number;
  owner_name: string | null;
}

interface GoalRow extends BaseRow {
  id: number;
  title: string;
  description: string | null;
  unit: string | null;
  target: number | null;
  current: number | null;
  start_date: string | Date | null;
  end_date: string | Date | null;
  status: string | null;
  priority: number | null;
  owner_id: number;
  owner_name: string | null;
  owner_dept: string | null;
}

interface ProjectRow extends BaseRow {
  id: number;
  name: string;
  code: string | null;
  status: string | null;
  progress: number | null;
  end_date: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date | null;
  manager_id: number | null;
  manager_name: string | null;
  manager_dept: string | null;
}

type ActivityType = "task" | "project" | "goal" | "meeting" | "report" | "note";

interface ActivityRow extends BaseRow {
  id: string;                // ex: 'task:123:u' ou 'meeting:45'
  title: string;             // libellé déjà construit par SQL
  type: ActivityType;        // 'task' | 'project' | ...
  user: string;              // nom utilisateur (ou '—')
  at: string | Date;         // date de l’événement
  color: string;             // hex
}

export async function GET(req: NextRequest) {
  try {
    const userId = num(req.nextUrl.searchParams.get("user_id"));

    // ===================== TASKS =====================
    let whereT = "WHERE 1=1";
    const paramsT: SQLParam[] = [];
    if (userId) {
      whereT += " AND (ta.user_id = ? OR t.created_by = ?)";
      paramsT.push(userId, userId);
    }

    const tasks = await exec<TaskRow>(
      `
      SELECT
        t.id, t.title, t.description, t.due_date, t.status, t.progress, t.priority,
        t.created_at, t.updated_at,
        ta.user_id AS assignee_id, u.name AS assignee_name, d.name AS assignee_dept,
        NULL AS project_id, NULL AS project_name
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      LEFT JOIN users u ON u.id = ta.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      ${whereT}
      ORDER BY COALESCE(t.due_date, '9999-12-31') ASC, t.id DESC
    `,
      paramsT
    );

    // ===================== MEETINGS =====================
    let whereM = "WHERE 1=1";
    const paramsM: SQLParam[] = [];
    if (userId) {
      whereM += " AND m.user_id = ?";
      paramsM.push(userId);
    }

    const meetings = await exec<MeetingRow>(
      `
      SELECT m.id, m.title, m.start_at, m.end_at, m.location, m.notes, m.status, m.user_id AS owner_id, u.name AS owner_name
      FROM planning_meetings m
      LEFT JOIN users u ON u.id = m.user_id
      ${whereM}
      ORDER BY m.start_at ASC
    `,
      paramsM
    );

    // ===================== GOALS =====================
    let whereG = "WHERE 1=1";
    const paramsG: SQLParam[] = [];
    if (userId) {
      whereG += " AND o.user_id = ?";
      paramsG.push(userId);
    }

    const goals = await exec<GoalRow>(
      `
      SELECT
        o.id, o.title, o.description, o.unit, o.target, o.current,
        o.start_date, o.end_date, o.status, o.priority,
        o.user_id AS owner_id, u.name AS owner_name, d.name AS owner_dept
      FROM objectives o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      ${whereG}
      ORDER BY o.end_date ASC
    `,
      paramsG
    );

    // ===================== PROJECTS =====================
    let extraP = "";
    const paramsP: SQLParam[] = [];
    if (userId) {
      extraP = `
        AND (
          p.manager_id = ?
          OR EXISTS (SELECT 1 FROM project_assignees pa WHERE pa.project_id = p.id AND pa.user_id = ?)
          OR EXISTS (SELECT 1 FROM project_assignments pax WHERE pax.project_id = p.id AND pax.user_id = ?)
        )
      `;
      paramsP.push(userId, userId, userId);
    }

    const projects = await exec<ProjectRow>(
      `
      SELECT
        p.id, p.name, p.code, p.status, p.progress, p.end_date, p.created_at, p.updated_at,
        p.manager_id, u.name AS manager_name, d.name AS manager_dept
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE 1=1
      ${extraP}
      ORDER BY p.end_date ASC, p.id DESC
    `,
      paramsP
    );

    // ===================== ACTIVITIES =====================
    const paramsA: SQLParam[] = [];

    const taskUpdWhere = userId
      ? " AND (t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id AND ta.user_id=?))"
      : "";
    if (userId) paramsA.push(userId, userId);

    const projUpdWhere = userId
      ? " AND (p.manager_id = ? OR EXISTS (SELECT 1 FROM project_assignees pa WHERE pa.project_id=p.id AND pa.user_id=?))"
      : "";
    if (userId) paramsA.push(userId, userId);

    const goalUpdWhere = userId ? " AND o.user_id = ?" : "";
    if (userId) paramsA.push(userId);

    const meetingWhere = userId ? " WHERE m.user_id = ?" : "";
    if (userId) paramsA.push(userId);

    const reportUpdWhere = userId ? " AND r.author_id = ?" : "";
    if (userId) paramsA.push(userId);

    const projNoteWhere = userId
      ? " WHERE (n.user_id = ? OR EXISTS (SELECT 1 FROM project_assignees pa WHERE pa.project_id=n.project_id AND pa.user_id=?))"
      : "";
    if (userId) paramsA.push(userId, userId);

    const deptNoteWhere = userId ? " WHERE n.user_id = ?" : "";
    if (userId) paramsA.push(userId);

    const activities = await exec<ActivityRow>(
      `
      (
        SELECT CONVERT(CONCAT('task:', t.id, ':u') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
               CONVERT(CONCAT('Tâche "', t.title, '" mise à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
               CONVERT('task' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS type,
               CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS user,
               t.updated_at AS at,
               CONVERT('#a5b4fc' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS color
        FROM tasks t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.updated_at IS NOT NULL
        ${taskUpdWhere}
      )
      UNION ALL
      (
        SELECT CONVERT(CONCAT('project:', p.id, ':u') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(CONCAT('Projet \"', p.name, '\" mis à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT('project' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               p.updated_at,
               CONVERT('#fdba74' USING utf8mb4) COLLATE utf8mb4_unicode_ci
        FROM projects p
        LEFT JOIN users u ON u.id = p.manager_id
        WHERE p.updated_at IS NOT NULL
        ${projUpdWhere}
      )
      UNION ALL
      (
        SELECT CONVERT(CONCAT('objective:', o.id, ':u') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(CONCAT('Objectif \"', o.title, '\" mis à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT('goal' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               o.updated_at,
               CONVERT('#a78bfa' USING utf8mb4) COLLATE utf8mb4_unicode_ci
        FROM objectives o
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.updated_at IS NOT NULL
        ${goalUpdWhere}
      )
      UNION ALL
      (
        SELECT CONVERT(CONCAT('meeting:', m.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(CONCAT('Réunion \"', m.title, '\" planifiée/mise à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT('meeting' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               COALESCE(m.end_at, m.start_at),
               CONVERT('#38bdf8' USING utf8mb4) COLLATE utf8mb4_unicode_ci
        FROM planning_meetings m
        LEFT JOIN users u ON u.id = m.user_id
        ${meetingWhere}
      )
      UNION ALL
      (
        SELECT CONVERT(CONCAT('report:', r.id, ':u') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(CONCAT('Rapport ', r.type, ' mis à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT('report' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               r.updated_at,
               CONVERT('#60a5fa' USING utf8mb4) COLLATE utf8mb4_unicode_ci
        FROM reports r
        LEFT JOIN users u ON u.id = r.author_id
        WHERE r.updated_at IS NOT NULL
        ${reportUpdWhere}
      )
      UNION ALL
      (
        SELECT CONVERT(CONCAT('project_note:', n.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT('Note projet ajoutée' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT('note' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               n.created_at,
               CONVERT('#f472b6' USING utf8mb4) COLLATE utf8mb4_unicode_ci
        FROM project_notes n
        LEFT JOIN users u ON u.id = n.user_id
        ${projNoteWhere}
      )
      UNION ALL
      (
        SELECT CONVERT(CONCAT('dept_note:', n.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT('Note département ajoutée' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT('note' USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci,
               n.created_at,
               CONVERT('#34d399' USING utf8mb4) COLLATE utf8mb4_unicode_ci
        FROM department_notes n
        LEFT JOIN users u ON u.id = n.user_id
        ${deptNoteWhere}
      )
      ORDER BY at DESC
      LIMIT 200
    `,
      paramsA
    );

    return ok({
      tasks,
      meetings,
      goals,
      projects,
      activities,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur interne";
    return err(message);
  }
}
