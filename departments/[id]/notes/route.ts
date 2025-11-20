import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../../lib/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

// (optionnel) si tu veux forcer le runtime Node.js en App Router
export const runtime = "nodejs";
// (optionnel) si tu veux éviter tout cache sur cette route
export const dynamic = "force-dynamic";

// ✅ Interface pour typer les notes renvoyées par MySQL
interface DepartmentNote extends RowDataPacket {
  id: number;
  department_id: number;
  user_id: number | null;
  text: string;
  created_at: string | Date;
}

// ✅ Schéma minimal du corps de requête
interface CreateDepartmentNoteBody {
  text: string;
  user_id?: number | null;
}

// ✅ Type guard pour sécuriser le corps reçu
function isCreateDepartmentNoteBody(value: unknown): value is CreateDepartmentNoteBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const hasText = typeof v.text === "string" && v.text.trim().length > 0;
  const hasUserId =
    v.user_id === undefined ||
    v.user_id === null ||
    (typeof v.user_id === "number" && Number.isFinite(v.user_id));
  return hasText && hasUserId;
}

// ✅ IMPORTANT: avec Next.js 15 + typed routes, params est un Promise
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // 👈 on attend params
    const department_id = Number(id);

    if (!Number.isFinite(department_id) || department_id <= 0) {
      return NextResponse.json({ error: "ID de département invalide" }, { status: 400 });
    }

    // ✅ Lecture et validation du corps JSON
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Corps de requête invalide (JSON attendu)" },
        { status: 400 }
      );
    }

    if (!isCreateDepartmentNoteBody(parsed)) {
      return NextResponse.json(
        { error: "Corps de requête invalide (champs attendus: text, user_id?)" },
        { status: 400 }
      );
    }

    const text = parsed.text.trim();
    const user_id: number | null = parsed.user_id ?? null;

    // ✅ Insertion
    const [insertRes] = await pool.query<ResultSetHeader>(
      "INSERT INTO department_notes (department_id, user_id, text, created_at) VALUES (?, ?, ?, NOW())",
      [department_id, user_id, text]
    );

    const newId = insertRes.insertId;
    if (!newId) {
      return NextResponse.json({ error: "Insertion échouée" }, { status: 500 });
    }

    // ✅ Récupération sécurisée de la ligne insérée
    const [rows] = await pool.query<DepartmentNote[]>(
      `SELECT id, department_id, user_id, text, created_at
         FROM department_notes
        WHERE id = ?`,
      [newId]
    );

    const note = rows?.[0];
    if (!note) {
      return NextResponse.json({ error: "Note introuvable après insertion" }, { status: 500 });
    }

    return NextResponse.json({ note }, { status: 201 });
  } catch (err: unknown) {
    console.error("POST /api/departments/[taskId]/notes error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
