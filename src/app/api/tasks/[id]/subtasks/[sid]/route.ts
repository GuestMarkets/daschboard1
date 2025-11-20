// app/api/tasks/[taskId]/subtasks/[sid]/route.ts
export const runtime = 'nodejs';

import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getPool } from '../../../../../../../lib/db';
import { verifyJwt, SESSION_COOKIE_NAME } from '../../../../../../../lib/auth';
import type { ResultSetHeader } from 'mysql2';

/** Type attendu pour le body du PATCH */
type PatchBody = {
  done?: boolean;
  title?: string;
  description?: string | null;
};

function getErrorMessage(err: unknown, fallback = 'Erreur serveur'): string {
  return err instanceof Error ? err.message : fallback;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    // Dans certaines versions, cookies() peut être synchrone ; l'await reste sûr.
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    }

    const { id, sid } = await context.params;
    const taskId = Number(id);
    const subId = Number(sid);
    if (!(taskId > 0) || !(subId > 0)) {
      return NextResponse.json({ error: 'id invalide' }, { status: 400 });
    }

    const rawBody = await req.json().catch(() => null);
    if (!isRecord(rawBody)) {
      return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
    }

    // Affinage des champs
    let descriptionField: string | null | undefined;
    if (typeof rawBody.description === 'string') {
      descriptionField = rawBody.description;
    } else if (rawBody.description === null) {
      descriptionField = null;
    }

    const body: PatchBody = {
      done: typeof rawBody.done === 'boolean' ? rawBody.done : undefined,
      title:
        typeof rawBody.title === 'string'
          ? rawBody.title.trim()
          : undefined,
      description: descriptionField,
    };

    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (body.done !== undefined) {
      fields.push('done=?');
      values.push(body.done ? 1 : 0);
    }
    if (body.title !== undefined) {
      fields.push('title=?');
      values.push(body.title);
    }
    if (body.description !== undefined) {
      fields.push('description=?');
      values.push(body.description === null ? null : body.description);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'Rien à mettre à jour' }, { status: 400 });
    }

    const pool = getPool();
    await pool.query<ResultSetHeader>(
      `UPDATE task_subtasks SET ${fields.join(', ')} WHERE id=? AND task_id=?`,
      [...values, subId, taskId]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    // Dans certaines versions, cookies() peut être synchrone ; l'await reste sûr.
    const ck = await cookies();
    const token = ck.get(SESSION_COOKIE_NAME)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const payload = await verifyJwt(token);
    if (!payload) {
      return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
    }

    const { id, sid } = await context.params;
    const taskId = Number(id);
    const subId = Number(sid);
    if (!(taskId > 0) || !(subId > 0)) {
      return NextResponse.json({ error: 'id invalide' }, { status: 400 });
    }

    const pool = getPool();
    await pool.query<ResultSetHeader>(
      'DELETE FROM task_subtasks WHERE id=? AND task_id=?',
      [subId, taskId]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
