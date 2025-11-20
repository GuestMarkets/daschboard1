// app/api/notifications/unread-count/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "../../../../../lib/auth";
import { getUnreadCount } from "../../../../../lib/queries/notifications";

export async function GET() {
  try {
    const { user } = await requireUser(); // 401/403 si non autorisé ou non validé
    const count = await getUnreadCount(user.id);
    return NextResponse.json({ ok: true, count });
  } catch (error: unknown) {
    let message = "";

    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === "string") {
      message = error;
    }

    switch (message) {
      case "Unauthorized":
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      case "Account suspended":
      case "Account pending approval":
        return NextResponse.json({ ok: false, error: message }, { status: 403 });
      case "Forbidden":
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      default:
        return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
    }
  }
}
