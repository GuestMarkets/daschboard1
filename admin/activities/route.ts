// app/api/admin/activities/route.ts
import { NextRequest } from "next/server";
import { num, ok, err, exec } from "../_utils";

type ActivityType = "task" | "project" | "note" | "goal" | "meeting" | "report";

interface ActivityItem {
  id: string;
  title: string;
  type: ActivityType;
  user: string;
  at: string | Date; // selon votre driver SQL, cela peut être Date
  color: string;
  // IMPORTANT: pour satisfaire la contrainte 'DbRow' de exec<T>
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const userId = num(req.nextUrl.searchParams.get("user_id"));
    // Tous les placeholders utilisés dans la requête sont des IDs numériques
    const params: number[] = [];

    const taskUpdWhere = userId
      ? " AND (t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id AND ta.user_id=?))"
      : "";
    if (userId) params.push(userId, userId);

    const taskCreateWhere = userId
      ? " WHERE (t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=t.id AND ta.user_id=?))"
      : "";
    if (userId) params.push(userId, userId);

    const projUpdWhere = userId
      ? " AND (p.manager_id = ? OR EXISTS (SELECT 1 FROM project_assignees pa WHERE pa.project_id=p.id AND pa.user_id=?))"
      : "";
    if (userId) params.push(userId, userId);

    const projNoteWhere = userId
      ? " WHERE (n.user_id = ? OR EXISTS (SELECT 1 FROM project_assignees pa WHERE pa.project_id=n.project_id AND pa.user_id=?))"
      : "";
    if (userId) params.push(userId, userId);

    const deptNoteWhere = userId ? " WHERE n.user_id = ?" : "";
    if (userId) params.push(userId);

    const goalUpdWhere = userId ? " AND o.user_id = ?" : "";
    if (userId) params.push(userId);

    const meetingWhere = userId ? " WHERE m.user_id = ?" : "";
    if (userId) params.push(userId);

    const reportUpdWhere = userId ? " AND r.author_id = ?" : "";
    if (userId) params.push(userId);

    const rows = await exec<ActivityItem>(
      `
      (
        SELECT
          CONVERT(CONCAT('task:', t.id, ':u') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
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
        SELECT
          CONVERT(CONCAT('task:', t.id, ':c') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
          CONVERT(CONCAT('Tâche "', t.title, '" créée') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
          CONVERT('task' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS type,
          CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS user,
          t.created_at AS at,
          CONVERT('#93c5fd' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS color
        FROM tasks t
        LEFT JOIN users u ON u.id = t.created_by
        ${taskCreateWhere}
      )
      UNION ALL
      (
        SELECT
          CONVERT(CONCAT('project:', p.id, ':u') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
          CONVERT(CONCAT('Projet "', p.name, '" mis à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
          CONVERT('project' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS type,
          CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS user,
          p.updated_at AS at,
          CONVERT('#fdba74' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS color
        FROM projects p
        LEFT JOIN users u ON u.id = p.manager_id
        WHERE p.updated_at IS NOT NULL
        ${projUpdWhere}
      )
      UNION ALL
      (
        SELECT
          CONVERT(CONCAT('project_note:', n.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
          CONVERT('Note projet ajoutée' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
          CONVERT('note' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS type,
          CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS user,
          n.created_at AS at,
          CONVERT('#f472b6' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS color
        FROM project_notes n
        LEFT JOIN users u ON u.id = n.user_id
        ${projNoteWhere}
      )
      UNION ALL
      (
        SELECT
          CONVERT(CONCAT('dept_note:', n.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
          CONVERT('Note département ajoutée' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
          CONVERT('note' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS type,
          CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS user,
          n.created_at AS at,
          CONVERT('#34d399' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS color
        FROM department_notes n
        LEFT JOIN users u ON u.id = n.user_id
        ${deptNoteWhere}
      )
      UNION ALL
      (
        SELECT
          CONVERT(CONCAT('objective:', o.id, ':u') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
          CONVERT(CONCAT('Objectif "', o.title, '" mis à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
          CONVERT('goal' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS type,
          CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS user,
          o.updated_at AS at,
          CONVERT('#a78bfa' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS color
        FROM objectives o
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.updated_at IS NOT NULL
        ${goalUpdWhere}
      )
      UNION ALL
      (
        SELECT
          CONVERT(CONCAT('meeting:', m.id) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
          CONVERT(CONCAT('Réunion "', m.title, '" planifiée/mise à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
          CONVERT('meeting' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS type,
          CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS user,
          COALESCE(m.end_at, m.start_at) AS at,
          CONVERT('#38bdf8' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS color
        FROM planning_meetings m
        LEFT JOIN users u ON u.id = m.user_id
        ${meetingWhere}
      )
      UNION ALL
      (
        SELECT
          CONVERT(CONCAT('report:', r.id, ':u') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS id,
          CONVERT(CONCAT('Rapport ', r.type, ' mis à jour') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS title,
          CONVERT('report' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS type,
          CONVERT(COALESCE(u.name, '—') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS user,
          r.updated_at AS at,
          CONVERT('#60a5fa' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS color
        FROM reports r
        LEFT JOIN users u ON u.id = r.author_id
        WHERE r.updated_at IS NOT NULL
        ${reportUpdWhere}
      )
      ORDER BY at DESC
      LIMIT 200
    `,
      params
    );

    return ok({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur interne";
    return err(message);
  }
}
