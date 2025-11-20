export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../../../lib/db";
import { requireUser } from "../../../../lib/auth";

/** Profil minimal utilisé dans tout /guestmarkets/api */
export type Me = {
  id: number;
  name: string;
  email: string | null;
  is_admin: boolean;
  is_manager: boolean;
  role: string; // 'user' | 'Admin' | 'superAdmin' | autres
  department_id: number | null;
};

/** Type minimal attendu côté auth */
type MinimalUser = { id: number | string };

/** Type guard pour vérifier la présence de user.id sans utiliser `any` */
function hasId(u: unknown): u is MinimalUser {
  if (typeof u !== "object" || u === null) return false;
  const rec = u as Record<string, unknown>;
  return (
    "id" in rec &&
    (typeof rec.id === "number" || typeof rec.id === "string")
  );
}

/** Renvoie l’utilisateur courant (et éclaire les flags à partir de la DB) */
export async function getMe(): Promise<Me> {
  const { user } = await requireUser(); // doit contenir au moins user.id
  if (!hasId(user)) throw new Error("Non authentifié");

  const uid = Number(user.id);
  if (!Number.isFinite(uid) || uid <= 0) throw new Error("Non authentifié");

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, email, is_admin, is_manager, role, department_id
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [uid]
  );

  const u = rows[0];
  if (!u) throw new Error("Utilisateur introuvable");

  return {
    id: Number(u.id),
    name: String((u as Record<string, unknown>).name ?? ""),
    email: (u as Record<string, unknown>).email as string | null,
    is_admin: Boolean((u as Record<string, unknown>).is_admin),
    is_manager: Boolean((u as Record<string, unknown>).is_manager),
    role: String((u as Record<string, unknown>).role ?? "user"),
    department_id:
      (u as Record<string, unknown>).department_id == null
        ? null
        : Number((u as Record<string, unknown>).department_id),
  };
}

/** utilitaire format yyyy-mm-dd */
export function sqlDate(d?: string | Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** force un entier positif ou null */
export function toId(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** helpers de réponses uniformes (typage générique, plus de `any`) */
export const ok = <T>(data: T, init: ResponseInit = {}) =>
  NextResponse.json<T>(data, init);

export const err = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });
