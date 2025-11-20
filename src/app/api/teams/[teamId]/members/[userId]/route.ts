export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../../lib/auth";
import type { ResultSetHeader } from "mysql2";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ teamId: string; userId: string }> }
) {
  try {
    // ✅ Next 15: params est un Promise
    const { teamId: teamIdParam, userId: userIdParam } = await context.params;

    // ✅ Dans ton env, cookies() est asynchrone : on l'attend
    const ck = await cookies();

    const authHeader = req.headers.get("authorization");
    const bearerToken =
      authHeader && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : null;

    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? bearerToken ?? null;
    const payload = token ? await verifyJwt(token) : null;

    if (!payload) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const teamId = Number(teamIdParam);
    const userId = Number(userIdParam);

    if (Number.isNaN(teamId) || Number.isNaN(userId)) {
      return NextResponse.json(
        { error: "Paramètres invalides" },
        { status: 400 }
      );
    }

    const [res] = await pool.query<ResultSetHeader>(
      "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
      [teamId, userId]
    );

    if (res.affectedRows === 0) {
      return NextResponse.json(
        { error: "Membre introuvable" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: "Erreur inconnue" }, { status: 500 });
  }
}
