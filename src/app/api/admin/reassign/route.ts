// app/api/admin/reassign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { usersBus } from "../../../../../lib/eventBus";
import type {
  PoolConnection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";

type Payload = {
  fromUserId: number;
  toUserId: number;
  scopes: string[];
  dryRun?: boolean;
};

function sanitizeId(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("ID invalide");
  return n;
}

// Périmètres -> tables + colonnes (whitelist)
const SCOPE_MAP: Record<
  string,
  { table: string; columns: string[] }[]
> = {
  tasks: [{ table: "tasks", columns: ["assignee_id", "owner_id", "creator_id"] }],
  meetings: [{ table: "meetings", columns: ["organizer_id", "created_by"] }],
  objectives: [{ table: "objectives", columns: ["owner_id", "created_by"] }],
  schedules: [{ table: "schedules", columns: ["user_id"] }],
  departments: [{ table: "departments", columns: ["manager_user_id"] }],
  projects: [{ table: "projects", columns: ["owner_user_id", "manager_id"] }],
  teams: [{ table: "teams", columns: ["leader_user_id"] }],
  project_members: [{ table: "project_members", columns: ["user_id"] }],
  team_members: [{ table: "team_members", columns: ["user_id"] }],
  project_notes: [{ table: "project_notes", columns: ["user_id"] }],
  project_files: [{ table: "project_files", columns: ["user_id"] }],
};

type Target = { table: string; column: string };

interface CountRow extends RowDataPacket {
  cnt: number | string;
}

export async function POST(req: NextRequest) {
  let conn: PoolConnection | null = null;

  try {
    const body = (await req.json()) as Payload;
    const fromUserId = sanitizeId(body.fromUserId);
    const toUserId = sanitizeId(body.toUserId);
    if (fromUserId === toUserId) throw new Error("IDs identiques");

    const scopes = Array.isArray(body.scopes) ? body.scopes : [];
    if (scopes.length === 0) throw new Error("Aucun périmètre sélectionné");

    const dryRun = Boolean(body.dryRun);

    const targets: Target[] = [];
    for (const s of scopes) {
      const defs = SCOPE_MAP[s];
      if (!defs) continue;
      defs.forEach((d) =>
        d.columns.forEach((c) => targets.push({ table: d.table, column: c })),
      );
    }

    const counts: Record<string, number> = {};
    conn = await pool.getConnection();

    if (!dryRun) await conn.beginTransaction();

    for (const t of targets) {
      const key = `${t.table}.${t.column}`;
      try {
        if (dryRun) {
          const sql = `SELECT COUNT(*) AS cnt FROM \`${t.table}\` WHERE \`${t.column}\` = ?`;
          const [rows] = await conn.query<CountRow[]>(sql, [fromUserId]);
          const n = Number(rows?.[0]?.cnt ?? 0);
          counts[key] = n;
        } else {
          const sql = `UPDATE \`${t.table}\` SET \`${t.column}\` = ? WHERE \`${t.column}\` = ?`;
          const [res] = await conn.query<ResultSetHeader>(sql, [
            toUserId,
            fromUserId,
          ]);
          counts[key] = typeof res.affectedRows === "number" ? res.affectedRows : 0;
        }
      } catch {
        // Colonne ou table absente : on ignore (schémas variables)
        counts[key] = counts[key] ?? 0;
      }
    }

    if (!dryRun) await conn.commit();

    // ping SSE pour recharger la page côté client
    try {
      usersBus.emit(
        "users",
        JSON.stringify({ kind: "reload", reason: "reassign", at: Date.now() }),
      );
    } catch {
      // pas bloquant
    }

    return NextResponse.json({ ok: true, counts });
  } catch (err: unknown) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
    }
    const message =
      err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    try {
      conn?.release();
    } catch {
      // ignore
    }
  }
}
