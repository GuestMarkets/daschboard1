export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "../_utils";

export async function GET() {
  try {
    const { userId, isSuper } = await requireUser();
    return NextResponse.json({ userId, isSuper });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unauthorized" }, { status: e?.status || 401 });
  }
}
