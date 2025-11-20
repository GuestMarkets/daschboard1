// app/api/objectives/_util.ts
import { NextRequest } from "next/server";
import { verifyJwt } from "../../../../lib/auth";

const COOKIE = process.env.SESSION_COOKIE_NAME || "auth";

export async function requireUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const cookieToken = req.cookies.get(COOKIE)?.value || null;
  const token = bearer || cookieToken;
  if (!token) return { error: "Non authentifié", status: 401 as const };

  const payload = await verifyJwt(token);
  if (!payload) return { error: "Token invalide", status: 401 as const };

  return { userId: Number(payload.sub), isAdmin: !!payload.is_admin };
}
