// app/api/auth/reset/approve/route.ts
import 'server-only';
import { NextRequest } from 'next/server';
import { getPool } from '../../../../../../lib/db';
import { jsonError, jsonOk } from '@/app/api/_utils/responses';

export const runtime = 'nodejs';

/**
 * Approve a pending reset.
 * Usage: POST with JSON { resetId: number }
 * Header required: X-ADMIN-KEY = process.env.ADMIN_API_KEY
 */
type Body = { resetId?: number };

type ResetStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'canceled' | string;

interface PasswordResetRow {
  id: number;
  user_id: number;
  new_password_hash: string;
  status: ResetStatus;
}

export async function POST(req: NextRequest) {
  try {
    const adminKey = req.headers.get('x-admin-key');
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      return jsonError('Non autorisé', 401);
    }

    const body = (await req.json()) as Body;
    const resetId = Number(body.resetId);
    if (!resetId) return jsonError('resetId manquant');

    const pool = getPool();

    // Récupération typée de la demande de réinitialisation
    const [rawRows] = await pool.query(
      'SELECT id, user_id, new_password_hash, status FROM password_resets WHERE id = :id LIMIT 1',
      { id: resetId },
    );

    const rows = rawRows as PasswordResetRow[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonError('Demande introuvable', 404);
    }

    const pr: PasswordResetRow = rows[0];
    if (pr.status !== 'pending') return jsonError('Demande déjà traitée');

    // Applique le nouveau mot de passe et réactive le compte
    await pool.query(
      'UPDATE users SET password_hash = :hash, status = "active" WHERE id = :uid',
      {
        hash: pr.new_password_hash,
        uid: pr.user_id,
      },
    );

    await pool.query(
      'UPDATE password_resets SET status = "approved", approved_at = NOW() WHERE id = :id',
      { id: resetId },
    );

    return jsonOk({ message: 'Réinitialisation approuvée et compte réactivé.' });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : 'Erreur inconnue';
    return jsonError('Erreur serveur (approve)', 500, { detail });
  }
}
