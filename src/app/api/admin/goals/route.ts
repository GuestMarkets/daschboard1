// app/api/admin/goals/route.ts
import { NextRequest } from "next/server";
import { num, ok, err, exec } from "../_utils";

type ObjectiveRow = {
  id: number;
  title: string;
  description: string | null;
  unit: string | null;
  target: number | null;
  current: number | null;
  start_date: string;   // ou Date si votre driver renvoie des Date
  end_date: string;     // idem
  status: string;
  priority: number | null;
  owner_id: number;
  owner_name: string | null;
  owner_dept: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const userId = num(req.nextUrl.searchParams.get("user_id")) as number | null;

    let where = "WHERE 1=1";
    const params: number[] = [];

    if (typeof userId === "number") {
      where += " AND o.user_id = ?";
      params.push(userId);
    }

    const rows = await exec<ObjectiveRow>(
      `
      SELECT
        o.id, o.title, o.description, o.unit, o.target, o.current,
        o.start_date, o.end_date, o.status, o.priority,
        o.user_id    AS owner_id,
        u.name       AS owner_name,
        d.name       AS owner_dept
      FROM objectives o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      ${where}
      ORDER BY o.end_date ASC
    `,
      params
    );

    return ok({ items: rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur interne";
    return err(message);
  }
}
