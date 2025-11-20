import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import type { RowDataPacket } from "mysql2/promise";

/** Corps attendu pour la requête PATCH */
type PatchBody = {
  name?: string;
  code?: string;
  color?: string;
  description?: string | null;
  manager_id?: number | null;
};

/** Lignes typées pour les requêtes SQL */
interface UserNameRow extends RowDataPacket {
  name: string;
}

interface CountRow extends RowDataPacket {
  c: number;
}

interface DepartmentRow extends RowDataPacket {
  id: number;
  name: string | null;
  code: string | null;
  color: string | null;
  description: string | null;
  manager_id: number | null;
  manager_name: string | null;
  member_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * PATCH /api/departments/[taskId]
 * Note: depuis Next.js 15, context.params est un Promise -> il faut l'await.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const depId = Number(id);

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { name, code, color, description, manager_id } = body || {};

  // Récup manager_name si manager_id fourni
  let manager_name: string | null | undefined = undefined;
  if (manager_id !== undefined) {
    if (manager_id === null) {
      manager_name = null;
    } else {
      const [rows] = await pool.query<UserNameRow[]>(
        "SELECT name FROM users WHERE id = ? LIMIT 1",
        [Number(manager_id)]
      );
      manager_name = rows[0]?.name ?? null;
    }
  }

  // Construction dynamique du SET …
  const fields: string[] = [];
  const values: Array<string | number | null> = [];

  if (name !== undefined) {
    fields.push("name = ?");
    values.push(String(name));
  }
  if (code !== undefined) {
    fields.push("code = ?");
    values.push(String(code));
  }
  if (color !== undefined) {
    fields.push("color = ?");
    values.push(String(color));
  }
  if (description !== undefined) {
    fields.push("description = ?");
    values.push(description ?? null);
  }
  if (manager_id !== undefined) {
    fields.push("manager_id = ?");
    values.push(manager_id !== null ? Number(manager_id) : null);
  }
  if (manager_name !== undefined) {
    fields.push("manager_name = ?");
    values.push(manager_name);
  }

  // Si aucun champ (hors updated_at), on renvoie une 400
  if (fields.length === 0) {
    return NextResponse.json(
      { error: "Aucun champ à mettre à jour" },
      { status: 400 }
    );
  }

  // Toujours maj updated_at
  fields.push("updated_at = NOW()");

  await pool.query(
    `UPDATE departments SET ${fields.join(", ")} WHERE id = ?`,
    [...values, depId]
  );

  // Recalcul member_count
  const [cnt] = await pool.query<CountRow[]>(
    "SELECT COUNT(*) AS c FROM users WHERE department_id = ?",
    [depId]
  );
  const member_count = cnt[0]?.c ?? 0;

  await pool.query("UPDATE departments SET member_count = ? WHERE id = ?", [
    member_count,
    depId,
  ]);

  const [depRows] = await pool.query<DepartmentRow[]>(
    "SELECT * FROM departments WHERE id = ?",
    [depId]
  );

  if (!depRows[0]) {
    return NextResponse.json(
      { error: "Département introuvable après mise à jour" },
      { status: 404 }
    );
  }

  return NextResponse.json({ item: depRows[0] });
}

/**
 * DELETE /api/departments/[taskId]
 * Note: idem -> params est un Promise.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const depId = Number(id);

  await pool.query("DELETE FROM departments WHERE id = ?", [depId]);
  return NextResponse.json({ ok: true });
}
