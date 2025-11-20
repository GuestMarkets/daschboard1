// app/api/teams/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { pool } from "../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import type { RowDataPacket, ResultSetHeader, PoolConnection } from "mysql2/promise";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

/** Résout cookies() qu’il soit sync ou async, sans any */
async function getCookies(): Promise<ReadonlyRequestCookies> {
  // TS: couvre Promise<ReadonlyRequestCookies> ou ReadonlyRequestCookies
  const maybe = cookies() as unknown as
    | PromiseLike<ReadonlyRequestCookies>
    | ReadonlyRequestCookies;
  return await Promise.resolve(maybe);
}

async function okAuth(req: Request): Promise<boolean> {
  const ck = await getCookies();

  const authHeader = req.headers.get("authorization");
  const bearer =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;

  const token = ck.get(SESSION_COOKIE_NAME)?.value || bearer;
  const payload = token ? await verifyJwt(token) : null;
  return !!payload;
}

export async function GET() {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.name, t.description, t.leader_user_id,
              DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
              DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
              u.name AS leader_name, u.email AS leader_email
         FROM teams t
         LEFT JOIN users u ON u.id = t.leader_user_id
        ORDER BY t.id DESC`
    );
    return NextResponse.json({ items: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await okAuth(req))) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    // Typage sûr du body sans any
    const bodyUnknown = await req.json().catch(() => ({} as unknown));
    const body = bodyUnknown as Record<string, unknown>;

    const name = String(body?.name ?? "").trim();
    const description = (body?.description as string | null | undefined) ?? null;

    const leaderIdRaw =
      body?.leaderUserId ?? body?.leader_user_id ?? null;
    const leaderId =
      leaderIdRaw !== null && leaderIdRaw !== undefined
        ? Number(leaderIdRaw)
        : null;

    if (!name) {
      return NextResponse.json({ error: "Nom requis" }, { status: 400 });
    }

    const conn: PoolConnection = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [ins] = await conn.query<ResultSetHeader>(
        `INSERT INTO teams (name, description, leader_user_id, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [name, description, leaderId]
      );
      const teamId = ins.insertId;

      if (leaderId) {
        await conn.query<ResultSetHeader>(
          `INSERT INTO team_members (team_id, user_id, role_in_team)
             VALUES (?, ?, 'lead')
           ON DUPLICATE KEY UPDATE role_in_team='lead'`,
          [teamId, leaderId]
        );

        await conn.query<ResultSetHeader>(
          `UPDATE team_members
              SET role_in_team='member'
            WHERE team_id=? AND user_id<>? AND role_in_team='lead'`,
          [teamId, leaderId]
        );
      }

      await conn.commit();

      const [row] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.name, t.description, t.leader_user_id,
                DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
                u.name AS leader_name, u.email AS leader_email
           FROM teams t
           LEFT JOIN users u ON u.id = t.leader_user_id
          WHERE t.id=?`,
        [teamId]
      );

      return NextResponse.json({ item: row[0] ?? null });
    } catch (e: unknown) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
