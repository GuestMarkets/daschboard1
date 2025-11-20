export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import type { RowDataPacket } from "mysql2";
import { requireUser } from "../_utils";

export async function GET() {
  try {
    const { userId, isSuper } = await requireUser();

    // 1) Département du user -> canal
    const [ud] = await pool.query<RowDataPacket[]>(
      "SELECT d.id, d.name FROM users u JOIN departments d ON d.id=u.department_id WHERE u.id=?",
      [userId]
    );
    if (ud.length) {
      const dep = ud[0];
      await pool.query(
        "INSERT IGNORE INTO chat_channels(type,name,ref_id) VALUES('department',?,?)",
        [dep.name, dep.id]
      );
    }

    // 2) Teams du user -> canaux
    const [teams] = await pool.query<RowDataPacket[]>(
      "SELECT t.id, t.name FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=?",
      [userId]
    );
    for (const t of teams) {
      await pool.query("INSERT IGNORE INTO chat_channels(type,name,ref_id) VALUES('team',?,?)", [t.name, t.id]);
    }

    // 3) Projets du user -> canaux
    const [prj] = await pool.query<RowDataPacket[]>(
      "SELECT p.id, p.name, p.code FROM project_assignments pa JOIN projects p ON p.id=pa.project_id WHERE pa.user_id=?",
      [userId]
    );
    for (const p of prj) {
      await pool.query(
        "INSERT IGNORE INTO chat_channels(type,name,ref_id) VALUES('project',?,?)",
        [`${p.code} — ${p.name}`, p.id]
      );
    }

    // 4) Broadcast "Tous" si super admin
    // déjà créé par migration SQL ; on l'inclut ou pas selon rôle

    // 5) Retour liste autorisée avec noms des DM
    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT
        c.id,
        c.type,
        CASE
          WHEN c.type = 'dm' THEN COALESCE(
            (SELECT u.name FROM users u WHERE u.id = IF(c.dm_user_a = ?, c.dm_user_b, c.dm_user_a) LIMIT 1),
            'Discussion privée'
          )
          ELSE c.name
        END AS name,
        c.ref_id
      FROM chat_channels c
      WHERE
        (c.type='broadcast' AND ?) OR
        (c.type='department' AND c.ref_id IN (SELECT department_id FROM users WHERE id=?)) OR
        (c.type='team' AND c.ref_id IN (SELECT team_id FROM team_members WHERE user_id=?)) OR
        (c.type='project' AND c.ref_id IN (SELECT project_id FROM project_assignments WHERE user_id=?)) OR
        (c.type='dm' AND (c.dm_user_a=? OR c.dm_user_b=?))
      ORDER BY FIELD(c.type,'broadcast','department','team','project','dm'), name ASC
      `,
      [userId, isSuper ? 1 : 0, userId, userId, userId, userId, userId]
    );

    return NextResponse.json({ items: rows });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: e?.status || 500 });
  }
}
