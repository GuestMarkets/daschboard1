// app/api/auth/forgot/route.ts
import 'server-only';
import { NextRequest } from 'next/server';
import { getPool } from '../../../../../lib/db';
import { hashPassword, isValidEmail, isStrongPassword } from '../../../../../lib/auth';
import { jsonError, jsonOk } from '@/app/api/_utils/responses';
import type { RowDataPacket } from 'mysql2/promise';

export const runtime = 'nodejs';

type Body = { email?: string; newPassword?: string };

// ✅ Les lignes retournées étendent RowDataPacket (mysql2)
interface UserRow extends RowDataPacket {
  id: number;
  status: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const email = (body.email || '').trim().toLowerCase();
    const newPassword = body.newPassword || '';

    if (!isValidEmail(email)) return jsonError('Email invalide');
    if (!isStrongPassword(newPassword)) return jsonError('Nouveau mot de passe trop court (>= 8)');

    const pool = getPool();

    // ✅ T est (UserRow & RowDataPacket)[] => satisfait la contrainte RowDataPacket[]
    const [rows] = await pool.query<(UserRow & RowDataPacket)[]>(
      'SELECT id, status FROM users WHERE email = :email LIMIT 1',
      { email }
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      // Réponse neutre (ne pas révéler l’existence de l’e-mail)
      return jsonOk({ message: 'Si un compte existe, une demande a été enregistrée.' });
    }

    const user: UserRow = rows[0];

    const newHash = await hashPassword(newPassword);

    // Crée une demande en attente
    await pool.query(
      'INSERT INTO password_resets (user_id, new_password_hash, status) VALUES (:uid, :hash, "pending")',
      { uid: user.id, hash: newHash }
    );

    // Suspend le compte jusqu’à approbation
    await pool.query('UPDATE users SET status = "suspended" WHERE id = :uid', { uid: user.id });

    return jsonOk({
      message:
        "Demande enregistrée. Votre compte est suspendu jusqu'à validation par un administrateur.",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return jsonError('Erreur serveur (forgot)', 500, { detail: message });
  }
}
