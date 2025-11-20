// app/api/users/stream/route.ts
import { NextRequest } from "next/server";
import { usersBus } from "../../../../../lib/eventBus";

export const runtime = "nodejs";

export async function GET() {
  const encoder = new TextEncoder();

  // Typage sûr : on accepte n'importe quelle donnée sérialisable
  function toSSEChunk(eventName: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  let ping: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Helper d’envoi
      const send = (data: unknown) => {
        controller.enqueue(toSSEChunk("users", data));
      };

      const onUsers = (payload: string) => {
        try {
          send(JSON.parse(payload));
        } catch {
          send({ kind: "reload", raw: payload, at: Date.now() });
        }
      };

      // Ping keep-alive
      ping = setInterval(() => send({ kind: "ping", at: Date.now() }), 15000);

      usersBus.on("users", onUsers);
      send({ kind: "hello", at: Date.now() });

      // Sauvegarde du handler pour cancel()
      // @ts-expect-error - on stocke sur l'instance pour y accéder dans cancel()
      this.__onUsers = onUsers;
    },

    cancel() {
      if (ping) {
        clearInterval(ping);
        ping = null;
      }
      // @ts-expect-error - récup du handler sauvegardé dans start()
      const onUsers: ((payload: string) => void) | undefined = this.__onUsers;
      if (onUsers) {
        usersBus.off("users", onUsers);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
