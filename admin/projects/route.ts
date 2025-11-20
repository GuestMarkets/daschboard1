// app/api/admin/projects/route.ts
import { NextRequest } from "next/server";
import { num, ok, err, exec } from "../_utils";

type ProjectRow = {
  id: number;
  name: string;
  code: string;
  status: string;
  progress: number | null;
  end_date: string | null;
  created_at: string;   // ou Date si votre driver renvoie des Date
  updated_at: string;   // idem
  manager_id: number | null;
  manager_name: string | null;
  manager_dept: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const userIdParam = req.nextUrl.searchParams.get("user_id");
    const userId = num(userIdParam); // supposé retourner number | null | undefined

    let extra = "";
    const params: number[] = [];

    if (typeof userId === "number" && !Number.isNaN(userId)) {
      extra = `
        AND (
          p.manager_id = ?
          OR EXISTS (SELECT 1 FROM project_assignees pa WHERE pa.project_id = p.id AND pa.user_id = ?)
          OR EXISTS (SELECT 1 FROM project_assignments pax WHERE pax.project_id = p.id AND pax.user_id = ?)
        )
      `;
      params.push(userId, userId, userId);
    }

    // Si exec est générique: exec<ProjectRow>(...) renvoie Promise<ProjectRow[]>
    const rows = await exec<ProjectRow>(
      `
      SELECT
        p.id, p.name, p.code, p.status, p.progress, p.end_date, p.created_at, p.updated_at,
        p.manager_id,
        u.name AS manager_name,
        d.name AS manager_dept
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE 1=1
      ${extra}
      ORDER BY p.end_date ASC, p.id DESC
    `,
      params
    );

    return ok({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur interne";
    return err(message);
  }
}
