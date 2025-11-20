// app/api/admin/_utils.ts
import { NextResponse } from "next/server";
import { pool } from "../../../../lib/db";

/** Types sûrs pour les paramètres SQL */
export type SqlPrimitive = string | number | boolean | null | Date | Buffer;
export type SqlParam = SqlPrimitive | ReadonlyArray<SqlPrimitive>;
export type SqlParams = ReadonlyArray<SqlParam>;

/** Cast utilitaire pour le résultat de mysql2/promise */
export type DbRow = Record<string, unknown>;

/** Parse un nombre de façon sûre */
export function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Exécute une requête SQL et retourne les lignes typées.
 * @param sql Requête SQL
 * @param params Paramètres SQL (optionnels)
 */
export async function exec<T extends DbRow = DbRow>(
  sql: string,
  params: SqlParams = []
): Promise<T[]> {
  const [rows] = await pool.execute(sql, params as unknown[]);
  return rows as unknown as T[];
}

/** Réponse JSON OK, générique et typée */
export function ok<T>(data: T, init: number = 200) {
  return NextResponse.json<T>(data, { status: init });
}

/** Réponse JSON d'erreur, typée */
export function err(message: string, init = 500) {
  return NextResponse.json<{ error: string }>({ error: message }, { status: init });
}
