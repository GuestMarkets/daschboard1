// app/api/users/[taskId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

type Role = "user" | "superAdmin";
type Status = "active" | "suspended" | "disabled";

interface PatchBody {
  role?: Role;
  isManager?: boolean;
  status?: Status;
}

interface UserRow extends RowDataPacket {
  id: number;
  name: string | null;
  email: string;
  role: Role;
  isManager: 0 | 1; // lu via alias is_manager AS isManager avant mapping
  status: Status;
  createdAt: string;
  updatedAt: string;
}

// (facultatif) Forcer runtime Node si tu utilises mysql2
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  // ⚠️ Next 15 peut typer params comme Promise<{ id: string }>
  // On se conforme donc à cette forme attendue par RouteHandlerConfig
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await context.params;
    const id = Number(idParam);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Body parsing sécurisé (JSON vide => objet vide)
    let body: PatchBody = {};
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      body = {};
    }

    const fields: string[] = [];
    const values: Array<string | number> = [];

    if (body.role && (["user", "superAdmin"] as const).includes(body.role)) {
      fields.push("role = ?");
      values.push(body.role);
    }

    if (typeof body.isManager === "boolean") {
      fields.push("is_manager = ?");
      values.push(body.isManager ? 1 : 0);
    }

    if (
      body.status &&
      (["active", "suspended", "disabled"] as const).includes(body.status)
    ) {
      fields.push("status = ?");
      values.push(body.status);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const sql = `UPDATE users SET ${fields.join(", ")}, updated_at = NOW() WHERE id = ?`;
    values.push(id);

    const [updateRes] = await pool.query<ResultSetHeader>(sql, values);

    // Si aucune ligne affectée, l'utilisateur n'existe probablement pas
    if (updateRes.affectedRows === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [rows] = await pool.query<UserRow[]>(
      `SELECT 
         id, 
         name, 
         email, 
         role, 
         is_manager AS isManager, 
         status, 
         created_at AS createdAt, 
         updated_at AS updatedAt
       FROM users 
       WHERE id = ?`,
      [id]
    );

    const item = rows?.[0];
    if (!item) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const normalized = {
      ...item,
      isManager: item.isManager === 1,
    };

    return NextResponse.json({ item: normalized });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "DB error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
