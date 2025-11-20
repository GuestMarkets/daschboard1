// app/api/chat/_utils.ts
import { cookies } from "next/headers";
import { pool } from "../../../../lib/db";
import { verifyJwt, SESSION_COOKIE_NAME } from "../../../../lib/auth";
import type { RowDataPacket } from "mysql2";

export type Authed = { userId: number; isSuper: boolean };

function toValidId(raw: any): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.trunc(n);
}

export async function requireUser(): Promise<Authed> {
  const ck = await cookies();
  const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  const payload: any = await verifyJwt(token);
  if (!payload) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  // essaie plusieurs clés possibles (selon ton JWT)
  const uid = toValidId(payload.id ?? payload.user_id ?? payload.userId ?? payload.sub);
  if (!Number.isFinite(uid)) {
    throw Object.assign(new Error("Invalid user in token"), { status: 401 });
  }

  const isSuper =
    !!(payload.is_admin ?? payload.isAdmin) ||
    (payload.role === "superAdmin" || payload.role === "admin");

  return { userId: uid, isSuper };
}

export async function userCanReadChannel(userId: number, channelId: number, isSuper: boolean) {
  if (!Number.isFinite(userId) || !Number.isFinite(channelId)) return false;

  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM chat_channels WHERE id=?", [channelId]);
  if (!rows.length) return false;
  const c = rows[0] as any;

  if (c.type === "broadcast") return isSuper;

  if (c.type === "dm") {
    return c.dm_user_a === userId || c.dm_user_b === userId;
  }

  if (c.type === "department") {
    const [u] = await pool.query<RowDataPacket[]>(
      "SELECT department_id FROM users WHERE id=? LIMIT 1",
      [userId]
    );
    const depId = u[0]?.department_id ?? null;
    return depId && Number(depId) === Number(c.ref_id);
  }

  if (c.type === "team") {
    const [tm] = await pool.query<RowDataPacket[]>(
      "SELECT 1 FROM team_members WHERE team_id=? AND user_id=? LIMIT 1",
      [c.ref_id, userId]
    );
    return tm.length > 0;
  }

  if (c.type === "project") {
    const [pa] = await pool.query<RowDataPacket[]>(
      "SELECT 1 FROM project_assignments WHERE project_id=? AND user_id=? LIMIT 1",
      [c.ref_id, userId]
    );
    return pa.length > 0;
  }

  return false;
}

export async function userCanWriteChannel(userId: number, channelId: number, isSuper: boolean) {
  // “Tous” uniquement super admin ; sinon mêmes règles que lecture
  const [rows] = await pool.query<RowDataPacket[]>("SELECT type FROM chat_channels WHERE id=?", [channelId]);
  if (!rows.length) return false;
  if ((rows[0] as any).type === "broadcast") return isSuper;
  return userCanReadChannel(userId, channelId, isSuper);
}
