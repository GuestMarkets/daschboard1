// app/api/me/profile/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/auth";
import type { RowDataPacket } from "mysql2/promise";

// Types de lignes retournées par MySQL, conformes à RowDataPacket
interface DeptRow extends RowDataPacket {
  department_id: number | null;
}

interface CountRow extends RowDataPacket {
  c: number | string; // COUNT(*) peut revenir en string selon la config
}

interface IdRow extends RowDataPacket {
  id: number | string; // id peut être string si BIGINT, on cast ensuite
}

export async function GET() {
  try {
    const { user } = await requireUser();

    // département de l’utilisateur
    const [urows] = await pool.execute<DeptRow[]>(
      "SELECT department_id FROM users WHERE id = ? LIMIT 1",
      [user.id]
    );
    const department_id: number | null = urows[0]?.department_id ?? null;

    // est-ce qu’il est chef d’un département ?
    const [drows] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS c FROM departments WHERE manager_id = ?",
      [user.id]
    );
    const is_department_lead = Number(drows[0]?.c ?? 0) > 0;

    // est-ce qu’il est chef d’équipe ?
    const [trows] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS c FROM teams WHERE leader_user_id = ?",
      [user.id]
    );
    const is_team_lead = Number(trows[0]?.c ?? 0) > 0;

    // projets dont il est manager
    const [prows] = await pool.execute<IdRow[]>(
      "SELECT id FROM projects WHERE manager_id = ? ORDER BY id DESC",
      [user.id]
    );
    const managed_project_ids = prows.map((r) => Number(r.id));

    // équipes dont il est leader
    const [lrows] = await pool.execute<IdRow[]>(
      "SELECT id FROM teams WHERE leader_user_id = ? ORDER BY id DESC",
      [user.id]
    );
    const lead_team_ids = lrows.map((r) => Number(r.id));

    return NextResponse.json({
      department_id,
      is_department_lead,
      is_team_lead,
      managed_project_ids,
      lead_team_ids,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
