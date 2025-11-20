// app/api/companies/route.ts
import { NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import type { Company } from "../../../../lib/company";
import type { RowDataPacket } from "mysql2/promise";

// Garde de type : restreint à nos valeurs autorisées et informe TypeScript
function isCompany(x: unknown): x is Company {
  return x === "Guest Markets" || x === "Guest Cameroon";
}

// ✅ Type de la ligne SQL, conforme aux génériques mysql2
interface CompanyRow extends RowDataPacket {
  company: string | null;
}

export async function GET() {
  // ✅ Le générique <CompanyRow[]> satisfait la contrainte 'QueryResult'
  const [rows] = await pool.query<CompanyRow[]>(
    "SELECT DISTINCT company FROM v_users_overview"
  );

  // ✅ On élimine les null et on garde des string strictes
  const vals: string[] = rows
    .map((r) => r.company)
    .filter((c): c is string => c !== null);

  // ✅ Filtrage via le type guard => Company[]
  const items: Company[] = Array.from(new Set(vals.filter(isCompany)));

  return NextResponse.json({ items });
}
