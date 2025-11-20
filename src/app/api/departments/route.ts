import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import { companyFromEmail } from "../../../../lib/company";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

/* ================== Types ================== */
type DepartmentRow = RowDataPacket & {
  id: number;
  name: string;
  code: string;
  manager_name: string | null;
  member_count: number;
  status: string;
  color: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  manager_id: number | null;
};

type UserRow = RowDataPacket & {
  id: number;
  name: string;
  email: string;
  department_id: number;
};

type ManagerRow = RowDataPacket & {
  id: number;
  name: string;
  email: string;
};

type DepartmentWithComputed = DepartmentRow & {
  company: string;
  // on garde member_count mais on le recalcule; si tu veux distinguer, crée un autre champ
  member_count: number;
};

/* Utilitaire pour fabriquer une clause IN en placeholders positionnels */
function makeInPlaceholders<T extends string | number>(arr: T[]) {
  const clause = arr.map(() => "?").join(", ");
  const params = [...arr] as (string | number)[];
  return { clause, params };
}

/* Récupère départements + company dérivée + member_count recalculé */
async function getDeptWithComputedFields(company?: string | null): Promise<DepartmentWithComputed[]> {
  const [deps] = await pool.query<DepartmentRow[]>(
    "SELECT * FROM departments ORDER BY created_at DESC"
  );
  const list = deps;
  if (!list.length) return [];

  // Users par dept (pour compter + trouver un email pour company)
  const ids = list.map((d) => d.id);
  const inDept = makeInPlaceholders(ids);

  const [users] = await pool.query<UserRow[]>(
    `SELECT id, name, email, department_id
       FROM users
      WHERE department_id IN (${inDept.clause})`,
    inDept.params
  );

  const byDept = new Map<number, UserRow[]>();
  users.forEach((u) => {
    const arr = byDept.get(u.department_id) ?? [];
    arr.push(u);
    byDept.set(u.department_id, arr);
  });

  // Managers prefetch
  const managerIds = Array.from(
    new Set(list.map((d) => d.manager_id).filter((v): v is number => typeof v === "number"))
  );

  const managers: Record<number, { email: string; name: string }> = {};
  if (managerIds.length) {
    const inMgr = makeInPlaceholders(managerIds);
    const [mgrRows] = await pool.query<ManagerRow[]>(
      `SELECT id, name, email
         FROM users
        WHERE id IN (${inMgr.clause})`,
      inMgr.params
    );
    mgrRows.forEach((m) => {
      managers[m.id] = { email: m.email, name: m.name };
    });
  }

  // Compose résultat
  const out: DepartmentWithComputed[] = list.map((d) => {
    const members = byDept.get(d.id) ?? [];
    let comp = "Other";
    if (d.manager_id && managers[d.manager_id]) {
      comp = companyFromEmail(managers[d.manager_id].email);
    } else if (members.length) {
      comp = companyFromEmail(members[0].email);
    }

    return {
      ...d,
      company: comp,
      member_count: members.length, // recalculé
    };
  });

  return company ? out.filter((x) => x.company === company) : out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const company = searchParams.get("company"); // optionnel
  const items = await getDeptWithComputedFields(company);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, code, color, description, manager_id } = (body ?? {}) as {
    name?: string;
    code?: string;
    color?: string;
    description?: string | null;
    manager_id?: number | string | null;
  };

  if (!name || !code) {
    return NextResponse.json({ error: "name et code sont requis" }, { status: 400 });
  }

  // manager_name (copie)
  let manager_name: string | null = null;
  if (manager_id) {
    const [rows] = await pool.query<Array<{ name: string } & RowDataPacket>>(
      "SELECT name FROM users WHERE id = ? LIMIT 1",
      [Number(manager_id)]
    );
    manager_name = rows[0]?.name ?? null;
  }

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO departments
      (name, code, manager_name, member_count, status, color, description, created_at, updated_at, manager_id)
     VALUES
      (?, ?, ?, 0, 'active', ?, ?, NOW(), NOW(), ?)`,
    [
      String(name),
      String(code),
      manager_name,
      color ?? "blue",
      description ?? null,
      manager_id ? Number(manager_id) : null,
    ]
  );

  const insertId = res.insertId;

  // Recalcul member_count
  const [cnt] = await pool.query<Array<{ c: number } & RowDataPacket>>(
    "SELECT COUNT(*) AS c FROM users WHERE department_id = ?",
    [insertId]
  );
  const member_count = cnt[0]?.c ?? 0;

  await pool.query<ResultSetHeader>(
    "UPDATE departments SET member_count = ? WHERE id = ?",
    [member_count, insertId]
  );

  const [depRows] = await pool.query<DepartmentRow[]>(
    "SELECT * FROM departments WHERE id = ?",
    [insertId]
  );
  const dep = depRows[0];

  // Enrichi (company)
  const allWithComputed = await getDeptWithComputedFields(null);
  const enriched = allWithComputed.find((x) => x.id === insertId);

  // Par sécurité, si enriched n'est pas trouvé (cas improbable), on reconstruit vite fait:
  const item: DepartmentWithComputed =
    enriched ??
    ({
      ...dep,
      company: "Other",
      member_count,
    } as DepartmentWithComputed);

  return NextResponse.json({ item });
}
