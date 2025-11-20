// lib/auth_user.ts
import { cookies } from "next/headers";
import { verifyJwt, SESSION_COOKIE_NAME } from "./auth";

/** Représente le payload JWT attendu (tous champs optionnels car sources variées). */
export interface AuthPayload {
  // identifiants possibles
  id?: number | string;
  user_id?: number | string;
  userId?: number | string;
  uid?: number | string;
  sub?: number | string;
  user?: {
    id?: number | string;
    role?: string;
    is_super_admin?: boolean;
    is_admin?: boolean;
    [k: string]: unknown;
  };

  // rôles / permissions
  role?: string;
  roles?: Array<string>;
  permissions?: Array<string>;
  scope?: string;

  // flags divers
  is_super_admin?: boolean;
  isSuperAdmin?: boolean;
  is_admin?: boolean;

  // autres métadonnées usuelles
  name?: string;
  email?: string;
  [k: string]: unknown;
}

/** Extrait un Bearer token depuis un objet Request si présent. */
function extractBearerFromRequest(req?: Request): string | null {
  if (!req) return null;
  // certains proxys normalisent en minuscule, on checke les deux
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (h && h.startsWith("Bearer ")) return h.slice("Bearer ".length).trim();
  return null;
}

/** Récupère le token depuis Authorization ou le cookie de session. */
async function getToken(req?: Request): Promise<string | null> {
  const fromHeader = extractBearerFromRequest(req);
  if (fromHeader) return fromHeader;

  const ck = await cookies();
  return ck.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/** Vérifie le JWT et retourne le payload typé. Lance une erreur si invalide. */
export async function getAuthPayload(req?: Request): Promise<AuthPayload> {
  const token = await getToken(req);
  if (!token) throw new Error("Non authentifié");

  const payload = (await verifyJwt(token)) as AuthPayload | null | undefined;
  if (!payload) throw new Error("Token invalide");

  return payload;
}

/**
 * Récupère l'ID utilisateur depuis Authorization: Bearer ... (si présent)
 * sinon depuis le cookie SESSION_COOKIE_NAME. Accepte plusieurs noms de claims.
 */
export async function getAuthUserId(req?: Request): Promise<number> {
  const payload = await getAuthPayload(req);

  // 1) on liste plusieurs champs candidats (ordre de préférence)
  const candidates: Array<unknown> = [
    payload.user_id,
    payload.id,
    payload.userId,
    payload.uid,
    payload.sub,
    payload.user?.id,
  ];

  // 2) on prend le premier candidat convertible en entier > 0
  for (const cand of candidates) {
    const n = Number(cand);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 3) aide au debug (non prod)
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn("[getAuthUserId] payload sans id exploitable:", payload);
  }
  throw new Error("Utilisateur invalide");
}

/**
 * Détermine si l'utilisateur est super administrateur.
 * On agrège plusieurs conventions possibles côté token.
 */
export async function isSuperAdmin(req?: Request): Promise<boolean> {
  const payload = await getAuthPayload(req);

  // flags explicites vrais
  if (payload.is_super_admin === true) return true;
  if (payload.isSuperAdmin === true) return true;
  if (payload.user?.is_super_admin === true) return true;

  // rôle unique
  const roleCandidates: string[] = [];
  if (typeof payload.role === "string") roleCandidates.push(payload.role);
  if (typeof payload.user?.role === "string") roleCandidates.push(payload.user.role);

  // tableaux de rôles / permissions
  if (Array.isArray(payload.roles)) roleCandidates.push(...payload.roles);
  if (Array.isArray(payload.permissions)) roleCandidates.push(...payload.permissions);

  // scopes en chaîne (ex: "read write super_admin")
  if (typeof payload.scope === "string") {
    roleCandidates.push(...payload.scope.split(/\s+/g));
  }

  const set = new Set(roleCandidates.map((r) => String(r).toLowerCase()));

  // on accepte plusieurs alias "super admin"
  if (
    set.has("super_admin") ||
    set.has("superadmin") ||
    set.has("super-admin") ||
    set.has("root")
  ) {
    return true;
  }

  // NOTE: on NE considère pas is_admin comme super admin par défaut.
  // Si tu veux l’autoriser, décommente la ligne ci-dessous :
  // if (payload.is_admin === true || payload.user?.is_admin === true) return true;

  return false;
}
