export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser, userCanReadChannel } from "../_utils";
import { subscribe } from "../../../../../lib/chatBus";

export async function GET(req: Request) {
  try {
    const { userId, isSuper } = await requireUser();
    const url = new URL(req.url);
    const channelId = Number(url.searchParams.get("channelId") || 0);
    if (!channelId) return new NextResponse("channelId requis", { status: 400 });

    const ok = await userCanReadChannel(userId, channelId, isSuper);
    if (!ok) return new NextResponse("Forbidden", { status: 403 });

    const stream = subscribe(channelId);
    return new NextResponse(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
}
