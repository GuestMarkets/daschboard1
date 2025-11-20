// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { RowDataPacket } from "mysql2";

// ✅ Définition du type pour les utilisateurs
interface UserRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    // ✅ Typage explicite pour le tableau d’arguments SQL
    const args: string[] = [];
    let where = "";

    if (q) {
      where = "WHERE (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)";
      args.push(`%${q}%`, `%${q}%`);
    }

    // ✅ Typage explicite du résultat de la requête
    const [rows] = await pool.query<UserRow[]>(
      `
      SELECT id, name, email
      FROM users
      ${where}
      ORDER BY name ASC
      LIMIT 500
      `,
      args
    );

    return NextResponse.json({ items: rows });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Erreur inconnue lors de la requête.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
