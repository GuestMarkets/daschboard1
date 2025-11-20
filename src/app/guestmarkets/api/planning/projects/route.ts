// app/guestmarkets/api/planning/projects/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { requireUser } from "../../../../../../lib/auth";

interface ProjectRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  manager_id: number | null;
  department_id: number | null;
  is_deleted: number | null;
}

type AuthUser = {
  id: number;
  is_admin?: boolean;
};

export async function GET() {
  try {
    const { user } = (await requireUser()) as { user: AuthUser };

    let rows: ProjectRow[];

    if (user.is_admin) {
      const [r] = await pool.query<ProjectRow[]>(
        `SELECT id, name, description, manager_id, department_id, is_deleted
           FROM projects
          WHERE is_deleted IS NULL OR is_deleted = 0
          ORDER BY name ASC`
      );
      rows = r;
    } else {
      const [r] = await pool.query<ProjectRow[]>(
        `SELECT id, name, description, manager_id, department_id, is_deleted
           FROM projects
          WHERE (is_deleted IS NULL OR is_deleted = 0)
            AND manager_id = ?
          ORDER BY name ASC`,
        [user.id]
      );
      rows = r;
    }

    return NextResponse.json({
      items: rows.map((p) => ({
        id: Number(p.id),
        name: String(p.name),
        description: p.description ? String(p.description) : null,
        department_id: p.department_id != null ? Number(p.department_id) : null,
        manager_id: p.manager_id != null ? Number(p.manager_id) : null,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
