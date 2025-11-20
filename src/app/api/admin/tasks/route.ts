// app/api/admin/tasks/route.ts
import { NextRequest } from "next/server";
import { num, ok, err, exec } from "../_utils";

type Nullable<T> = T | null;

/** Types locaux compatibles avec _utils.ts */
type SqlPrimitive = string | number | boolean | null | Date | Buffer;
type SqlParam = SqlPrimitive | ReadonlyArray<SqlPrimitive>;
type SqlParams = ReadonlyArray<SqlParam>;

interface TaskRow {
  [key: string]: unknown; // compat Record<string, unknown> de exec<T>

  id: number;
  title: string;
  description: Nullable<string>;
  due_date: Nullable<string>; // ISO string ou null
  status: string;
  progress: Nullable<number>;
  priority: Nullable<number>;
  created_at: string; // ISO string
  updated_at: string; // ISO string
  assignee_id: Nullable<number>;
  assignee_name: Nullable<string>;
  assignee_dept: Nullable<string>;
  project_id: Nullable<number>;
  project_name: Nullable<string>;
}

export async function GET(req: NextRequest) {
  try {
    const userId = num(req.nextUrl.searchParams.get("user_id"));

    let where = "WHERE 1=1";
    const params: SqlParam[] = []; // <-- plus de unknown[]

    if (userId != null) {
      where += " AND (ta.user_id = ? OR t.created_by = ?)";
      params.push(userId, userId);
    }

    // Array<SqlParam> est assignable à ReadonlyArray<SqlParam> attendu par exec
    const rows = await exec<TaskRow>(
      `
      SELECT
        t.id, t.title, t.description, t.due_date, t.status, t.progress, t.priority,
        t.created_at, t.updated_at,
        ta.user_id AS assignee_id,
        u.name     AS assignee_name,
        d.name     AS assignee_dept,
        NULL       AS project_id,
        NULL       AS project_name
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id
      LEFT JOIN users u ON u.id = ta.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      ${where}
      ORDER BY COALESCE(t.due_date, '9999-12-31') ASC, t.id DESC
      `,
      params as SqlParams
    );

    return ok({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur interne";
    return err(message);
  }
}
