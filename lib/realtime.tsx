"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/** Action générique sérialisable (style Redux) */
export type RTAction = {
  type: string;
  // Données complémentaires, toujours sérialisables
  [key: string]: unknown;
};

type RTListener = (a: RTAction) => void;

type RTApi = {
  publish: (action: RTAction) => void;
  subscribe: (fn: RTListener) => () => void;
};

const CHANNEL_KEY = "dashboard-rt";
const STORAGE_KEY = `${CHANNEL_KEY}-action`;

const RealTimeContext = createContext<RTApi | null>(null);

/** Type guard pour sécuriser le parse */
function isRTAction(value: unknown): value is RTAction {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string";
}

export function RealTimeProvider({ children }: { children: ReactNode }) {
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const bc =
      typeof window !== "undefined" && "BroadcastChannel" in window
        ? new BroadcastChannel(CHANNEL_KEY)
        : null;
    channelRef.current = bc;
    return () => {
      if (bc) bc.close();
    };
  }, []);

  const api = useMemo<RTApi>(
    () => ({
      publish: (action: RTAction) => {
        // Post sur BroadcastChannel (autres onglets)
        if (channelRef.current) channelRef.current.postMessage(action);
        // Fallback via localStorage (déclenche l'event "storage")
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(action));
          // Nettoyage immédiat pour ne pas laisser de trace
          setTimeout(() => localStorage.removeItem(STORAGE_KEY), 0);
        } catch {
          // ignore quota/serialization errors
        }
      },

      subscribe: (fn: RTListener) => {
        const bc = channelRef.current;

        const onMsg = (ev: MessageEvent<RTAction>) => {
          // TS lib DOM permet MessageEvent<T>; on sécurise quand même
          const data = ev.data;
          if (isRTAction(data)) fn(data);
        };

        const onStorage = (e: StorageEvent) => {
          if (e.key !== STORAGE_KEY || e.newValue == null) return;
          try {
            const parsed = JSON.parse(e.newValue) as unknown;
            if (isRTAction(parsed)) fn(parsed);
          } catch {
            // ignore JSON errors
          }
        };

        if (bc) bc.addEventListener("message", onMsg);
        window.addEventListener("storage", onStorage);

        return () => {
          if (bc) bc.removeEventListener("message", onMsg);
          window.removeEventListener("storage", onStorage);
        };
      },
    }),
    []
  );

  return (
    <RealTimeContext.Provider value={api}>{children}</RealTimeContext.Provider>
  );
}

export function useRealTime(): RTApi {
  const ctx = useContext(RealTimeContext);
  if (!ctx) throw new Error("RealTimeProvider manquant");
  return ctx;
}
