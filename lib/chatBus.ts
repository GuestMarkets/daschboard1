// lib/chatBus.ts
type SSEEvent = {
  type: string;
  data: string;
};

type Listener = {
  id: string;
  push: (payload: SSEEvent) => void;
  close: () => void;
};

type ChanMap = Map<number, Set<Listener>>;

interface GlobalWithChatBus {
  __CHAT_BUS__?: ChanMap;
}

const g = globalThis as GlobalWithChatBus;
if (!g.__CHAT_BUS__) g.__CHAT_BUS__ = new Map();
const chans = g.__CHAT_BUS__!;

/** Publier un événement à tous les abonnés d’un canal */
export function publish<T>(channelId: number, event: T): void {
  const set = chans.get(channelId);
  if (!set) return;
  const data = JSON.stringify(event);
  for (const l of set) {
    try {
      l.push({ type: "message", data });
    } catch {
      // ignorer les erreurs push individuelles
    }
  }
}

/** S’abonner à un canal : renvoie un ReadableStream pour SSE */
export function subscribe(channelId: number): ReadableStream<Uint8Array> {
  let listenerRef: Listener | null = null;
  let iv: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const id = Math.random().toString(36).slice(2);
      const enc = new TextEncoder();

      const listener: Listener = {
        id,
        push: (evt: SSEEvent) => {
          controller.enqueue(
            enc.encode(`event: ${evt.type}\ndata: ${evt.data}\n\n`)
          );
        },
        close: () => controller.close(),
      };

      if (!chans.get(channelId)) chans.set(channelId, new Set());
      chans.get(channelId)!.add(listener);
      listenerRef = listener;

      // ping keep-alive
      iv = setInterval(() => {
        try {
          controller.enqueue(
            enc.encode(`event: ping\ndata: ${Date.now().toString()}\n\n`)
          );
        } catch {
          // si l'enqueue échoue, l'annulation s'occupera du nettoyage
        }
      }, 15000);
    },

    cancel() {
      // Nettoyage intervalle
      if (iv !== null) {
        clearInterval(iv);
        iv = null;
      }

      // Retirer le listener et nettoyer la map si vide
      const set = chans.get(channelId);
      if (set && listenerRef) {
        set.delete(listenerRef);
        if (set.size === 0) {
          chans.delete(channelId);
        }
      }

      // Fermer explicitement le listener si besoin
      if (listenerRef) {
        try {
          listenerRef.close();
        } catch {
          // rien
        }
        listenerRef = null;
      }
    },
  });
}
