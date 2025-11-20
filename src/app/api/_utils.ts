import type { RowDataPacket } from "mysql2";
import { pool } from "../../../lib/db";
import { requireUser } from "../../../lib/auth";

export type ReportRow = RowDataPacket & {
  id: number;
  author_id: number;
  title: string;
  type: "daily" | "weekly" | "monthly" | "incident" | "meeting" | "other";
  summary: string | null;
  period_start: string;
  period_end: string;
  status:
    | "draft"
    | "submitted"
    | "under_review"
    | "approved"
    | "rejected"
    | "changes_requested";
  project_id: number | null;
  department_id: number | null;
  created_at: string;
  updated_at: string;
};

export async function getMe() {
  const { user } = await requireUser();
  return user;
}

export async function getMyDepartmentId(userId: number): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT department_id FROM users WHERE id = ?",
    [userId]
  );
  const r = rows[0];
  return r?.department_id != null ? Number(r.department_id) : null;
}

export async function getProjectManagerId(
  projectId: number | null
): Promise<number | null> {
  if (!projectId) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT manager_id FROM projects WHERE id = ?",
    [projectId]
  );
  const r = rows[0];
  return r?.manager_id != null ? Number(r.manager_id) : null;
}

export async function getDepartmentManagerId(
  deptId: number | null
): Promise<number | null> {
  if (!deptId) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT manager_id FROM departments WHERE id = ?",
    [deptId]
  );
  const r = rows[0];
  return r?.manager_id != null ? Number(r.manager_id) : null;
}

export async function getAllSuperAdmins(): Promise<Array<{ id: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'superAdmin' AND status = 'active'"
  );
  return rows.map((r) => ({ id: Number(r.id) }));
}

// Détermine la liste des destinataires selon le rôle
export async function computeRecipients(params: {
  authorId: number;
  userRole: "superAdmin" | "user";
  isManager: boolean;
  projectId: number | null;
  departmentIdExplicit: number | null; // du formulaire
}) {
  const { authorId, userRole, isManager, projectId, departmentIdExplicit } =
    params;

  // SuperAdmin -> (par simplicité) envoie aussi aux autres superAdmin (hors lui-même)
  // Manager/Admin (ici: isManager === true) -> seulement superAdmins
  // User -> chef de département (lié à son dept ou celui choisi) + chef de projet (si présent) + superAdmins
  const supers = await getAllSuperAdmins();
  const superIds = supers.map((s) => s.id).filter((id) => id !== authorId);

  const extra: number[] = [];
  if (userRole === "user" && !isManager) {
    const deptId = departmentIdExplicit ?? (await getMyDepartmentId(authorId));
    const pmId = await getProjectManagerId(projectId);
    const dmId = await getDepartmentManagerId(deptId);
    if (pmId) extra.push(pmId);
    if (dmId) extra.push(dmId);
  }

  const ids = Array.from(new Set([...superIds, ...extra])).filter(
    (id) => id !== authorId
  );
  return ids;
}
