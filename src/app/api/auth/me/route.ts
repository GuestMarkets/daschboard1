// app/api/auth/me/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../../lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}
