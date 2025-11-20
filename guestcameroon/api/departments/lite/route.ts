export const runtime = "nodejs";

import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../../../lib/db";
import { ok, err, getMe } from "../../_utils";

type Department = {
  id: number;
  name: string;
};

type Me = {
  id: number | string;
  role?: string | null;
  is_admin?: boolean | null;
  is_manager?: boolean | null;
};

export async function GET() {
  try {
    const me = (await getMe()) as Me;

    const role = String(me.role ?? "").toLowerCase();
    const isPriv =
      Boolean(me.is_admin) ||
      Boolean(me.is_manager) ||
      role === "superadmin" ||
      role === "admin";

    let rows: Department[] = [];

    if (isPriv) {
      const [r] = await pool.execute<RowDataPacket[]>(
        `SELECT id, name
           FROM departments
          ORDER BY name ASC`
      );

      // Cast contrôlé vers notre type métier
      rows = r as unknown as Department[];
    } else {
      const [r] = await pool.execute<RowDataPacket[]>(
        `SELECT d.id, d.name
           FROM departments d
           JOIN users u ON u.department_id = d.id
          WHERE u.id = ?
          LIMIT 1`,
        [me.id]
      );

      rows = r as unknown as Department[];
    }

    return ok({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return err(message, 500);
  }
}
