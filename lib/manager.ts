// lib/manager.ts
import "server-only";
import type { RowDataPacket } from "mysql2";
import { pool } from "./db";
import { getAuthTokenFromRequest, verifyJwt } from "./auth";

export type ManagerContext = {
  userId: number;
  departmentId: number;
};

type UserRow = RowDataPacket & {
  id: number;
  is_manager: 0 | 1;
  department_id: number | null;
  status: "active" | "suspended";
};

export async function requireManager(): Promise<ManagerContext> {
  const token = await getAuthTokenFromRequest();
  if (!token) throw new Error("Unauthorized");

  const payload = await verifyJwt(token);
  if (!payload) throw new Error("Unauthorized");

  const [rows] = await pool.query<UserRow[]>(
    `SELECT id, is_manager, department_id, status
     FROM users
     WHERE id = :id
     LIMIT 1`,
    { id: Number(payload.sub) }
  );

  const u = rows?.[0];
  if (!u) throw new Error("Unauthorized");
  if (u.status !== "active") throw new Error("Account not active");
  if (!u.is_manager) throw new Error("Forbidden");
  if (!u.department_id) throw new Error("Manager has no department");

  return { userId: u.id, departmentId: u.department_id };
}
