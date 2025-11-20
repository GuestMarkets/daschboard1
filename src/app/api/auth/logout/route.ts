// app/api/auth/logout/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getPool } from '../../../../../lib/db';
import { SESSION_COOKIE_NAME, verifyJwt } from '../../../../../lib/auth';

export async function POST() {
  try {
    // 1) Récupérer le token courant (si présent) pour invalider la session côté DB
    const ck = await cookies(); // Next 15+: async
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;

    if (token) {
      try {
        const payload = await verifyJwt(token);
        if (payload?.jti) {
          // Invalidation serveur (si tu as une table `sessions`)
          const pool = getPool();
          await pool.query('DELETE FROM sessions WHERE jwt_id = :jti', { jti: payload.jti });
        }
      } catch {
        // On ignore les erreurs d’analyse du token pour ne pas bloquer le logout
      }
    }

    // 2) Réponse + suppression des cookies (session + legacy "auth")
    const res = NextResponse.json({ ok: true });

    const common = {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      expires: new Date(0),
      maxAge: 0,
    };

    // Cookie principal (aligné avec le login)
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: '',
      ...common,
    });

    // (Optionnel) Ancien cookie "auth" si tu en as utilisé un avant
    res.cookies.set({
      name: 'auth',
      value: '',
      ...common,
    });

    return res;
  } catch {
    // En cas d’erreur, on essaie quand même de supprimer le cookie côté client
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: '',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      expires: new Date(0),
      maxAge: 0,
    });
    return res;
  }
}
