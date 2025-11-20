export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

/* ---------- Types ---------- */
interface TeamRow extends RowDataPacket {
  id: number;
  name: string | null;
  description: string | null;
  leader_user_id: number | null;
  created_at: string;
  updated_at: string;
  leader_name: string | null;
  leader_email: string | null;
}

/* ---------- Utils ---------- */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return "Erreur";
  }
}

async function requireAuth(req: NextRequest | Request): Promise<void> {
  const ck = await cookies(); // ✅ cookies() renvoie une Promise dans Next 15
  const authHeader = req.headers.get("authorization");
  const bearer =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;

  const token = ck.get(SESSION_COOKIE_NAME)?.value || bearer;
  const payload = token ? await verifyJwt(token) : null;
  if (!payload) throw new Error("Non authentifié");
}

/* ---------- Handlers ---------- */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  try {
    await requireAuth(req);

    const { teamId: teamIdStr } = await context.params;
    const teamId = Number(teamIdStr);

    const body = (await req.json().catch(() => ({}))) as Partial<{
      name: string | null;
      description: string | null;
      leaderUserId: number | null;
      leader_user_id: number | null;
    }>;

    const name = body?.name ?? undefined;
    const description = body?.description ?? undefined;
    const leaderField = body?.leaderUserId ?? body?.leader_user_id;

    const conn: PoolConnection = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // MAJ infos de base
      if (
        typeof name !== "undefined" ||
        typeof description !== "undefined" ||
        typeof leaderField !== "undefined"
      ) {
        const [upd] = await conn.query<ResultSetHeader>(
          `UPDATE teams
              SET name = COALESCE(?, name),
                  description = ?,
                  leader_user_id = ${
                    typeof leaderField !== "undefined" ? "?" : "leader_user_id"
                  },
                  updated_at = NOW()
            WHERE id = ?`,
          typeof leaderField !== "undefined"
            ? [
                name ?? null,
                description ?? null,
                leaderField === null ? null : Number(leaderField),
                teamId,
              ]
            : [name ?? null, description ?? null, teamId]
        );

        if (upd.affectedRows === 0) {
          await conn.rollback();
          return NextResponse.json(
            { error: "Équipe introuvable" },
            { status: 404 }
          );
        }
      }

      // Gestion unique du chef d’équipe dans team_members
      if (typeof leaderField !== "undefined") {
        const leaderId = leaderField === null ? null : Number(leaderField);

        // rétrograde tout lead actuel
        await conn.query<ResultSetHeader>(
          `UPDATE team_members SET role_in_team='member' WHERE team_id=? AND role_in_team='lead'`,
          [teamId]
        );

        if (leaderId !== null) {
          // upsert le leader
          await conn.query<ResultSetHeader>(
            `INSERT INTO team_members (team_id, user_id, role_in_team)
               VALUES (?, ?, 'lead')
             ON DUPLICATE KEY UPDATE role_in_team='lead'`,
            [teamId, leaderId]
          );
        }
      }

      await conn.commit();

      // Renvoie l’objet équipe enrichi
      const [rows] = await pool.query<TeamRow[]>(
        `SELECT t.id, t.name, t.description, t.leader_user_id,
                DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
                u.name AS leader_name, u.email AS leader_email
           FROM teams t
           LEFT JOIN users u ON u.id = t.leader_user_id
          WHERE t.id=?`,
        [teamId]
      );

      const item: TeamRow | null = rows.length > 0 ? rows[0] : null;
      return NextResponse.json({ item });
    } catch (e: unknown) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    const msg = getErrorMessage(e);
    const code = msg === "Non authentifié" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ teamId: string }> }
) {
  try {
    await requireAuth(req);

    const { teamId: teamIdStr } = await context.params;
    const teamId = Number(teamIdStr);

    const conn: PoolConnection = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Supprime les liens projets/équipes (si table project_team_roles)
      await conn.query<ResultSetHeader>(
        `DELETE FROM project_team_roles WHERE team_id=?`,
        [teamId]
      );

      // Supprime les membres
      await conn.query<ResultSetHeader>(
        `DELETE FROM team_members WHERE team_id=?`,
        [teamId]
      );

      // Supprime l’équipe
      const [del] = await conn.query<ResultSetHeader>(
        `DELETE FROM teams WHERE id=?`,
        [teamId]
      );

      await conn.commit();

      if (del.affectedRows === 0) {
        return NextResponse.json(
          { error: "Équipe introuvable" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    const msg = getErrorMessage(e);
    const code = msg === "Non authentifié" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
