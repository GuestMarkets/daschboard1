// app/api/_utils/auth.ts
import { NextRequest } from "next/server";
import { verifyJwt } from "../../../../lib/auth";

const COOKIE_NAME = "auth"; // doit correspondre au cookie défini dans /api/auth/login

export type AuthInfo = { userId: number; isAdmin: boolean };

export async function requireAuth(req: NextRequest): Promise<AuthInfo | null> {
  // 1) Authorization: Bearer <jwt>
  const auth = req.headers.get("authorization");
  let token: string | null = null;

  if (auth?.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  }

  // 2) Cookie httpOnly (depuis le NextRequest fourni au handler)
  if (!token) {
    token = req.cookies.get(COOKIE_NAME)?.value ?? null;
  }

  if (!token) return null;

  const payload = await verifyJwt(token);
  if (!payload) return null;

  return {
    userId: Number(payload.sub),
    isAdmin: !!payload.is_admin,
  };
}
