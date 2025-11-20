// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser, getAuthTokenFromRequest, verifyJwt } from "../../../../lib/auth";
import { pool } from "../../../../lib/db";
import type { RowDataPacket } from "mysql2/promise";

type IdRow = RowDataPacket & { id: number };
type JwtPayload = { sub?: string | number } | null;

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (user.status !== "VALIDATED") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Compléments attendus par l’UI : is_team_lead, is_department_lead, managed_project_ids, lead_team_ids
    const token = await getAuthTokenFromRequest();
    const payload = (token ? await verifyJwt(token) : null) as JwtPayload;

    const uid =
      typeof payload?.sub !== "undefined" ? Number(payload.sub) : Number(user.id);

    const [teamsLed] = await pool.execute<IdRow[]>(
      "SELECT id FROM teams WHERE leader_user_id = ?",
      [uid]
    );
    const [depsLed] = await pool.execute<IdRow[]>(
      "SELECT id FROM departments WHERE manager_id = ?",
      [uid]
    );
    const [managedProjects] = await pool.execute<IdRow[]>(
      "SELECT id FROM projects WHERE manager_id = ?",
      [uid]
    );

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role, // "superAdmin" | "user"
        email: user.email,
        status: user.status,
        is_admin: user.is_admin,
        // compléments
        is_team_lead: teamsLed.length > 0,
        is_department_lead: depsLed.length > 0,
        managed_project_ids: managedProjects.map((r) => r.id),
        lead_team_ids: teamsLed.map((r) => r.id),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
