// lib/store.tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useCallback } from "react";
import { AppState, Task, Meeting, Objective, iso, type Role } from "./types";
import { RealTimeProvider, useRealTime, type RTAction } from "./realtime";

/* =========================
   Persistance locale
   ========================= */
const STORAGE_KEY = "dashboard-state-v3";
const OLD_STORAGE_KEYS = ["dashboard-state-v2"];

/* =========================
   Actions & reducer
   ========================= */
export const ACTIONS = {
  HYDRATE: "HYDRATE",
  USER_SWITCH: "USER_SWITCH",

  TASK_ADD: "TASK_ADD",
  TASK_UPDATE: "TASK_UPDATE",
  TASK_RATE: "TASK_RATE",
  TASK_PROGRESS: "TASK_PROGRESS",
  TASK_STATUS: "TASK_STATUS",

  MEETING_ADD: "MEETING_ADD",
  MEETING_RESCHEDULE: "MEETING_RESCHEDULE",

  OBJ_ADD: "OBJ_ADD",
  OBJ_UPDATE: "OBJ_UPDATE",
  OBJ_DELETE: "OBJ_DELETE",
} as const;

type Action =
  | { type: typeof ACTIONS.HYDRATE; payload: Partial<AppState> }
  | { type: typeof ACTIONS.USER_SWITCH; user: AppState["currentUser"] }
  | { type: typeof ACTIONS.TASK_ADD; task: Task }
  | { type: typeof ACTIONS.TASK_UPDATE; id: string; patch: Partial<Task> }
  | { type: typeof ACTIONS.TASK_RATE; id: string; performance: number }
  | { type: typeof ACTIONS.TASK_PROGRESS; id: string; progress: number }
  | { type: typeof ACTIONS.TASK_STATUS; id: string; status: Task["status"] }
  | { type: typeof ACTIONS.MEETING_ADD; meeting: Meeting }
  | { type: typeof ACTIONS.MEETING_RESCHEDULE; id: string; newStartAt: string }
  | { type: typeof ACTIONS.OBJ_ADD; objective: Objective }
  | { type: typeof ACTIONS.OBJ_UPDATE; id: string; patch: Partial<Objective> }
  | { type: typeof ACTIONS.OBJ_DELETE; id: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case ACTIONS.HYDRATE:
      return { ...state, ...action.payload };

    case ACTIONS.USER_SWITCH:
      return { ...state, currentUser: action.user };

    case ACTIONS.TASK_ADD:
      return { ...state, tasks: [action.task, ...state.tasks] };

    case ACTIONS.TASK_UPDATE:
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, ...action.patch, updatedAt: iso(new Date()) } : t
        ),
      };

    case ACTIONS.TASK_RATE:
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                performance: Math.max(0, Math.min(100, action.performance)),
                updatedAt: iso(new Date()),
              }
            : t
        ),
      };

    case ACTIONS.TASK_PROGRESS:
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                progress: Math.max(0, Math.min(100, action.progress)),
                status: action.progress >= 100 ? "done" : t.status === "done" ? "in_progress" : t.status,
                updatedAt: iso(new Date()),
              }
            : t
        ),
      };

    case ACTIONS.TASK_STATUS:
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, status: action.status, updatedAt: iso(new Date()) } : t
        ),
      };

    case ACTIONS.MEETING_ADD:
      return { ...state, meetings: [action.meeting, ...state.meetings] };

    case ACTIONS.MEETING_RESCHEDULE:
      return {
        ...state,
        meetings: state.meetings.map((m) =>
          m.id === action.id
            ? {
                ...m,
                startAt: action.newStartAt,
                rescheduledCount: (m.rescheduledCount || 0) + 1,
                status: "scheduled",
              }
            : m
        ),
      };

    case ACTIONS.OBJ_ADD:
      return { ...state, objectives: [action.objective, ...state.objectives] };

    case ACTIONS.OBJ_UPDATE:
      return {
        ...state,
        objectives: state.objectives.map((o) =>
          o.id === action.id ? { ...o, ...action.patch, updatedAt: iso(new Date()) } : o
        ),
      };

    case ACTIONS.OBJ_DELETE:
      return { ...state, objectives: state.objectives.filter((o) => o.id !== action.id) };

    default:
      return state;
  }
}

/* =========================
   Type guard RT
   ========================= */
function isKnownAction(a: RTAction): a is Action {
  const allowed = Object.values(ACTIONS) as readonly string[];
  return typeof a === "object" && a !== null && allowed.includes((a as { type?: unknown }).type as string);
}

/* =========================
   Helpers
   ========================= */
// IMPORTANT : ne renvoie que des valeurs compatibles avec ton type Role
function normalizeRole(input: unknown): Role {
  const v = String(input ?? "").toLowerCase().replace(/\s|_/g, "");
  // si ton union Role est "user" | "superAdmin", on mappe tout le reste sur "user"
  if (v === "superadmin") return "superAdmin";
  return "user";
}

/* État initial strict : conforme au type { name: string; role: Role } */
function emptyState(): AppState {
  return {
    tasks: [],
    meetings: [],
    objectives: [],
    currentUser: { name: "", role: "user" },
  };
}

/* =========================
   Store context
   ========================= */
const StoreCtx = createContext<{
  state: AppState;
  dispatchRT: (a: Action) => void;
  setCurrentUser: (user: AppState["currentUser"]) => void;
  ACTIONS: typeof ACTIONS;
} | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // INIT : lecture storage v3 sinon état vide ; nettoyage anciens keys
  const init = useMemo<AppState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);

        const obj = (parsed as Record<string, unknown>) ?? {};
        const cu = (obj["currentUser"] as Record<string, unknown> | undefined) ?? {};

        const safe: AppState = {
          tasks: Array.isArray(obj["tasks"]) ? (obj["tasks"] as Task[]) : [],
          meetings: Array.isArray(obj["meetings"]) ? (obj["meetings"] as Meeting[]) : [],
          objectives: Array.isArray(obj["objectives"]) ? (obj["objectives"] as Objective[]) : [],
          currentUser: {
            name: typeof cu["name"] === "string" ? (cu["name"] as string) : "",
            role: normalizeRole(cu["role"]),
          },
        };
        return safe;
      }
    } catch {
      /* ignore */
    }
    try {
      for (const k of OLD_STORAGE_KEYS) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    return emptyState();
  }, []);

  const [state, dispatch] = useReducer(reducer, init);
  const { publish, subscribe } = useRealTime();

  const dispatchRT = useCallback(
    (action: Action) => {
      dispatch(action);
      publish(action);
    },
    [publish]
  );

  const setCurrentUser = (user: AppState["currentUser"]) => {
    const safeUser: AppState["currentUser"] = {
      name: user?.name ?? "",
      role: normalizeRole(user?.role),
    };
    dispatchRT({ type: ACTIONS.USER_SWITCH, user: safeUser });
  };

  /* ====== Temps réel : consomme les actions reçues ====== */
  useEffect(() => {
    const unsub = subscribe((a: RTAction) => {
      if (isKnownAction(a) && a.type !== ACTIONS.HYDRATE) {
        dispatch(a);
      }
    });
    return unsub;
  }, [subscribe]);

  /* ====== Persistance locale ====== */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [state]);

  /* ====== Hydratation DB via API ====== */
  useEffect(() => {
    let stop = false;

    (async () => {
      try {
        const [meRes, tasksRes, meetingsRes, objectivesRes] = await Promise.allSettled([
          fetch("/api/users/me", { credentials: "include" }),
          fetch("/api/tasks", { credentials: "include" }),
          fetch("/api/meetings", { credentials: "include" }),
          fetch("/api/objectives", { credentials: "include" }),
        ]);

        const payload: Partial<AppState> = {};

        // /api/users/me
        if (meRes.status === "fulfilled" && meRes.value.ok) {
          const me = await meRes.value.json();
          const name = typeof me?.name === "string" ? me.name : "";
          const role = normalizeRole((me as { role?: unknown })?.role);
          payload.currentUser = { name, role };
        }

        // /api/tasks
        if (tasksRes.status === "fulfilled" && tasksRes.value.ok) {
          const list: unknown = await tasksRes.value.json();
          if (Array.isArray(list)) payload.tasks = list as Task[];
        }

        // /api/meetings
        if (meetingsRes.status === "fulfilled" && meetingsRes.value.ok) {
          const list: unknown = await meetingsRes.value.json();
          if (Array.isArray(list)) payload.meetings = list as Meeting[];
        }

        // /api/objectives
        if (objectivesRes.status === "fulfilled" && objectivesRes.value.ok) {
          const list: unknown = await objectivesRes.value.json();
          if (Array.isArray(list)) payload.objectives = list as Objective[];
        }

        if (!stop && Object.keys(payload).length > 0) {
          dispatchRT({ type: ACTIONS.HYDRATE, payload });
        }
      } catch {
        // silencieux
      }
    })();

    return () => {
      stop = true;
    };
  }, [dispatchRT]);

  return (
    <StoreCtx.Provider value={{ state, dispatchRT, setCurrentUser, ACTIONS }}>
      {children}
    </StoreCtx.Provider>
  );
}

/* Fournit tous les providers (RealTime + Store) */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <RealTimeProvider>
      <StoreProvider>{children}</StoreProvider>
    </RealTimeProvider>
  );
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("StoreProvider manquant");
  return ctx;
}
