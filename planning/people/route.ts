// app/api/planning/people/route.ts
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../../../../../lib/auth";
import { getUserRow, isTeamLead, getLeadTeamMemberIds } from "../../../../../lib/rbac";

type Lite = { id:number; name:string; email:string; department_id:number|null };

export async function GET() {
  const { user } = await requireUser();
  const me = await getUserRow(user.id);
  if (!me) return NextResponse.json({ error:"Unauthorized" }, { status:401 });

  const res: { items:Lite[]; canInviteSuperAdmin:boolean; scope:"org"|"department"|"team" } = {
    items: [],
    canInviteSuperAdmin: false,
    scope: "department",
  };

  if (me.is_admin || me.role === "superAdmin") {
    // Super admin → tous les actifs
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id,name,email,department_id FROM users WHERE status='active'`
    );
    res.items = rows.map(r=>({ id:Number(r.id), name:r.name, email:r.email, department_id:r.department_id ?? null }));
    res.canInviteSuperAdmin = false;
    res.scope = "org";
    return NextResponse.json(res);
  }

  // Manager (responsable) → membres de son département
  if (me.is_manager && me.department_id) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id,name,email,department_id
         FROM users
        WHERE status='active' AND department_id=?`, [me.department_id]
    );
    res.items = rows.map(r=>({ id:Number(r.id), name:r.name, email:r.email, department_id:r.department_id ?? null }));
    res.canInviteSuperAdmin = true; // il peut inviter super admin (RSVP)
    res.scope = "department";
    return NextResponse.json(res);
  }

  // Chef d'équipe → membres de ses équipes
  if (await isTeamLead(me.id)) {
    const ids = await getLeadTeamMemberIds(me.id);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id,name,email,department_id
         FROM users
        WHERE status='active' AND id IN (${ids.length? ids.map(()=>"?").join(","):"NULL"})`,
      ids
    );
    res.items = rows.map(r=>({ id:Number(r.id), name:r.name, email:r.email, department_id:r.department_id ?? null }));
    res.canInviteSuperAdmin = true;
    res.scope = "team";
    return NextResponse.json(res);
  }

  // Utilisateur simple → lui-même
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id,name,email,department_id FROM users WHERE id=?`, [me.id]
  );
  res.items = rows.map(r=>({ id:Number(r.id), name:r.name, email:r.email, department_id:r.department_id ?? null }));
  res.canInviteSuperAdmin = false;
  res.scope = "team";
  return NextResponse.json(res);
}
