// lib/queries/notifications.ts
import "server-only";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db";

/** Compte les notifications non lues pour l'utilisateur donné. */
export async function getUnreadCount(userId: number): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(
    `
      SELECT COUNT(*) AS c
      FROM notifications
      WHERE user_id = :user_id AND is_read = 0
    `,
    { user_id: userId }
  );
  return Number(rows?.[0]?.c ?? 0);
}
