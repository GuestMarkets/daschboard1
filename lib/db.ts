// lib/db.ts
import type { Pool, PoolOptions } from "mysql2/promise";
import mysql from "mysql2/promise";

function reqEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function getPoolOptions(): PoolOptions {
  return {
    host: reqEnv("MYSQL_HOST"),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: reqEnv("MYSQL_USER"),
    password: reqEnv("MYSQL_PASSWORD"),
    database: reqEnv("MYSQL_DATABASE"),
    connectionLimit: Number(process.env.MYSQL_CONN_LIMIT ?? 10),
    namedPlaceholders: false,          // ← on désactive, on passe en positionnel "?"
    timezone: "Z",
    dateStrings: true,
    charset: "utf8mb4",
  };
}

const globalForMysql = globalThis as unknown as { __MYSQL_POOL__?: Pool };

export function getPool(): Pool {
  if (!globalForMysql.__MYSQL_POOL__) {
    const p = mysql.createPool(getPoolOptions());
    // Harmonise la session (optionnel mais conseillé)
    p.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    p.query("SET SESSION collation_connection = 'utf8mb4_unicode_ci'");
    globalForMysql.__MYSQL_POOL__ = p;
  }
  return globalForMysql.__MYSQL_POOL__;
}

export const pool = getPool();