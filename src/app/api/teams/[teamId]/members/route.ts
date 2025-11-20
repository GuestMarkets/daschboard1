// app/api/teams/[teamId]/members/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/* ---------- Helpers ---------- */
const getToken = async (req: NextRequest): Promise<string | null> => {
  const ck = await cookies(); // <-- async in your environment
  const auth = req.headers.get("authorization") || "";
  const headerToken = /^bearer\s+/i.test(auth)
    ? auth.replace(/^bearer\s+/i, "").trim()
    : null;
  const cookieToken = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
  return cookieToken ?? headerToken ?? null;
};

const toId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// garde de type réutilisable
const isFiniteNumber = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

type MemberRow = RowDataPacket & {
  user_id: number;
  name: string;
  email: string;
  role_in_team: "lead" | "member" | string;
};

async function listMembers(teamId: number) {
  const [rows] = await pool.execute<MemberRow[]>(
    `
    SELECT tm.user_id, u.name, u.email, tm.role_in_team
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY u.name ASC
    `,
    [teamId]
  );
  return rows;
}

/* ---------- GET: liste des membres ---------- */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId: teamIdParam } = await params;
    const teamId = toId(teamIdParam);
    if (!teamId) {
      return NextResponse.json(
        { error: "Identifiant d’équipe invalide." },
        { status: 400 }
      );
    }

    const items = await listMembers(teamId);
    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur inattendue.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ---------- POST: ajout de membres (batch) ---------- */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const token = await getToken(req); // <-- await here
    const payload = token ? await verifyJwt(token) : null;
    if (!payload)
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

    const { teamId: teamIdParam } = await params;
    const teamId = toId(teamIdParam);
    if (!teamId)
      return NextResponse.json(
        { error: "Identifiant d’équipe invalide." },
        { status: 400 }
      );

    const body = await req.json().catch(() => ({} as unknown));
    const userIds: unknown = (body as Record<string, unknown>)?.["userIds"];
    const role: unknown = (body as Record<string, unknown>)?.["role"];
    const r: "lead" | "member" =
      role === "lead" || role === "member" ? (role as "lead" | "member") : "member";

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: "Aucun utilisateur fourni." },
        { status: 400 }
      );
    }

    const ids = userIds.map(toId).filter(isFiniteNumber);
    if (!ids.length) {
      return NextResponse.json(
        { error: "Liste d’utilisateurs invalide." },
        { status: 400 }
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // INSERT IGNORE pour éviter les doublons
      for (const uid of ids) {
        await conn.execute<ResultSetHeader>(
          `INSERT IGNORE INTO team_members (team_id, user_id, role_in_team) VALUES (?, ?, ?)`,
          [teamId, uid, r]
        );
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const items = await listMembers(teamId);
    return NextResponse.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur inattendue.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ---------- PATCH: changer le rôle d’un membre ---------- */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const token = await getToken(req); // <-- await here
    const payload = token ? await verifyJwt(token) : null;
    if (!payload)
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

    const { teamId: teamIdParam } = await params;
    const teamId = toId(teamIdParam);
    if (!teamId)
      return NextResponse.json(
        { error: "Identifiant d’équipe invalide." },
        { status: 400 }
      );

    const body = await req.json().catch(() => ({} as unknown));
    const userId = toId((body as Record<string, unknown>)?.["userId"]);
    const role = (body as Record<string, unknown>)?.["role"];
    const r: "lead" | "member" =
      role === "lead" || role === "member" ? (role as "lead" | "member") : "member";

    if (!userId) {
      return NextResponse.json(
        { error: "Identifiant d’utilisateur invalide." },
        { status: 400 }
      );
    }

    await pool.execute<ResultSetHeader>(
      `UPDATE team_members SET role_in_team = ? WHERE team_id = ? AND user_id = ?`,
      [r, teamId, userId]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur inattendue.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ---------- DELETE: retirer un ou plusieurs membres ---------- */
/* Body accepté : { userId: number } ou { userIds: number[] } */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const token = await getToken(req); // <-- await here
    const payload = token ? await verifyJwt(token) : null;
    if (!payload)
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

    const { teamId: teamIdParam } = await params;
    const teamId = toId(teamIdParam);
    if (!teamId)
      return NextResponse.json(
        { error: "Identifiant d’équipe invalide." },
        { status: 400 }
      );

    const body = await req.json().catch(() => ({} as unknown));
    const single = toId((body as Record<string, unknown>)?.["userId"]);
    let ids: number[] = [];

    const maybeMany: unknown = (body as Record<string, unknown>)?.["userIds"];
    if (Array.isArray(maybeMany)) {
      ids = maybeMany.map(toId).filter(isFiniteNumber);
    } else if (single) {
      ids = [single];
    }

    if (!ids.length) {
      return NextResponse.json(
        { error: "Aucun utilisateur à retirer." },
        { status: 400 }
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const uid of ids) {
        await conn.execute<ResultSetHeader>(
          `DELETE FROM team_members WHERE team_id = ? AND user_id = ?`,
          [teamId, uid]
        );
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const items = await listMembers(teamId);
    return NextResponse.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur inattendue.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
