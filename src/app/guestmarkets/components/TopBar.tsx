// app/components/TopBar.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Bell, CalendarDays, Clock, User, LogOut } from "lucide-react";

import GoogleTranslate from "./i18n/GoogleTranslate";
import LanguageSwitch from "./i18n/LanguageSwitch";

type Role = "RESP" | "user" | "superAdmin";
type UnreadPayload = { kind: "alert" | "unread"; unread: number };

type StreamPayload =
  | { kind: "hello" }
  | { kind: "ping" }
  | { kind: "alert" | "unread"; unread: number };

type MeOk = {
  ok: true;
  user: {
    id: number;
    name: string;
    email: string;
    status: string;
    is_admin: boolean;
    role?: "superAdmin" | "user" | "RESP";
    is_department_lead?: boolean;
    is_team_lead?: boolean;
    is_project_lead?: boolean;
    department_ids?: number[];
    lead_team_ids?: number[];
    managed_project_ids?: number[];
  };
};
type MeFail = { ok: false; error?: string };
type MeResponse = MeOk | MeFail;

export default function TopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const router = useRouter();

  /* ---------------- Mount + Auth ---------------- */
  const [mounted, setMounted] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    let ok = false;
    try {
      ok = !!localStorage.getItem("auth_token");
    } catch {
      ok = false;
    }
    setAuthed(ok);
    if (!ok) router.replace("/");
  }, [mounted, router]);

  /* ---------------- Données utilisateur via /guestmarkets/api/me ---------------- */
  const [currentUserName, setCurrentUserName] = useState<string>("Utilisateur");
  const [currentUserRole, setCurrentUserRole] = useState<Role>("user");

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const headers: HeadersInit = {};
        const token = localStorage.getItem("auth_token");
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch("/guestmarkets/api/me", {
          credentials: "include",
          headers,
        });
        if (!res.ok) return;
        const data: MeResponse = await res.json();

        if (!stop && data?.ok && data?.user) {
          const u = data.user;
          setCurrentUserName(u.name ?? "Utilisateur");

          if (u.role === "superAdmin" || u.role === "RESP" || u.role === "user") {
            setCurrentUserRole(u.role);
          } else {
            const derived: Role =
              u.is_admin
                ? "superAdmin"
                : u.is_department_lead || u.is_team_lead || u.is_project_lead
                ? "RESP"
                : "user";
            setCurrentUserRole(derived);
          }
        }
      } catch {
        /* noop */
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  /* ---------------- Horloge ---------------- */
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const dateStr = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(now),
    [now]
  );
  const timeStr = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(now),
    [now]
  );

  /* ---------------- Temps réel + Unread ---------------- */
  const [live, setLive] = useState<"on" | "off">("off");
  const [unread, setUnread] = useState<number>(0);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const headers: HeadersInit = {};
        const token = localStorage.getItem("auth_token");
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch("/api/notifications/unread-count", {
          credentials: "include",
          headers,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!stop && typeof data?.count === "number") setUnread(data.count);
      } catch {}
    })();
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      const init: EventSourceInit = { withCredentials: true };
      es = new EventSource("/api/users/stream", init);

      const onUsers: EventListener = (e) => {
        try {
          const msg = e as MessageEvent<string>;
          const payload = JSON.parse(msg.data || "{}") as StreamPayload;

          if (payload.kind === "hello" || payload.kind === "ping") {
            setLive("on");
          }

          if (
            (payload.kind === "alert" || payload.kind === "unread") &&
            "unread" in payload &&
            typeof payload.unread === "number"
          ) {
            setUnread(payload.unread);
          }
        } catch {
          /* ignore parse errors */
        }
      };

      es.addEventListener("users", onUsers);
      es.onerror = () => setLive("off");
    } catch {
      setLive("off");
    }
    return () => {
      es?.close();
    };
  }, []);

  /* ---------------- Logout ---------------- */
  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    try {
      localStorage.removeItem("auth_token");
    } catch {}
    router.replace("/");
    router.refresh();
  }

  /* ---------------- Garde d'affichage ---------------- */
  if (authed !== true) return null;

  /* ---------------- UI (thème clair) ---------------- */
  return (
    <div
      className="
        relative flex items-center justify-between
        h-13 md:h-16
        px-2.5 md:px-3
        text-slate-900
        overflow-visible
      "
      style={{
        background:
          "linear-gradient(135deg, rgba(249,250,251,0.98) 0%, rgba(241,245,249,0.98) 50%, rgba(226,232,240,0.98) 100%)",
        border: "1px solid rgba(148,163,184,0.35)",
        boxShadow:
          "0 8px 20px -8px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.8)",
      }}
    >
      {/* Glow décoratifs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -left-14 w-40 h-40 rounded-full blur-3xl opacity-50"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, rgba(59,130,246,0.35) 0%, rgba(59,130,246,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -right-16 w-48 h-48 rounded-full blur-3xl opacity-40"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, rgba(56,189,248,0.35) 0%, rgba(56,189,248,0) 70%)",
        }}
      />

      {/* LEFT */}
      <div className="flex items-center gap-2 md:gap-3 z-10">
        <button
          className="md:hidden p-2 rounded-lg bg-white hover:bg-slate-100 ring-1 ring-slate-200"
          onClick={onOpenSidebar}
          aria-label="Ouvrir la barre latérale"
          title="Menu"
        >
          <Menu className="w-5 h-5 text-slate-700" />
        </button>

        <div className="h-8 w-8 md:h-10 md:w-10 rounded-xl bg-gradient-to-br from-indigo-100 to-blue-100 grid place-items-center ring-1 ring-slate-200 shadow-inner">
          <span className="font-semibold text-xs md:text-sm text-indigo-700">
            {(() => {
              const n = (currentUserName || "").trim();
              const ini = n
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase())
                .join("");
              return ini || <User className="w-4 h-4 text-slate-600" />;
            })()}
          </span>
        </div>

        <div className="flex flex-col items-start leading-tight">
          <span className="text-sm md:text-[15px] font-semibold text-slate-900">
            {currentUserName}
          </span>

          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] md:text-[12px] px-2 py-0.5 rounded-md bg-slate-100 ring-1 ring-slate-200 text-slate-600">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                live === "on" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              }`}
              title={live === "on" ? "Temps réel actif" : "Hors ligne"}
            />
            {currentUserRole === "superAdmin"
              ? "Super Admin"
              : currentUserRole === "RESP"
              ? "Chef de département"
              : "Utilisateur"}
          </span>
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex items-center gap-2 md:gap-2.5 z-20">
        {mounted && (
          <div
            className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg bg-white ring-1 ring-slate-200 backdrop-blur-sm"
            title="Date & heure"
          >
            <CalendarDays className="w-4 h-4 opacity-80 text-slate-600" />
            <span className="tabular-nums text-xs md:text-sm text-slate-800">
              {dateStr}
            </span>
            <span className="opacity-40 text-slate-400">•</span>
            <Clock className="w-4 h-4 opacity-80 text-slate-600" />
            <span className="tabular-nums text-xs md:text-sm text-slate-800">
              {timeStr}
            </span>
          </div>
        )}

        {/* Google Translate + Switch langue */}
        {mounted && (
          <>
            {/* GoogleTranslate monté mais invisible, pour créer .goog-te-combo */}
            <div className="fixed -z-10 opacity-0 pointer-events-none">
              <GoogleTranslate />
            </div>

            {/* Sélecteur de langue toujours visible */}
            <LanguageSwitch className="ml-1" />
          </>
        )}

        <button
          className="relative p-2 rounded-lg bg-white hover:bg-slate-100 ring-1 ring-slate-200 transition"
          aria-label="Notifications"
          title="Notifications"
          onClick={() => {
            // ouvre ton panneau de notifications
          }}
        >
          <Bell className="w-5 h-5 text-slate-700" />
          {unread > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] rounded-full grid place-items-center ring-2 ring-slate-50"
              aria-label={`${unread} notifications non lues`}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        <button
          onClick={handleLogout}
          className="inline-flex items-center gap-1.5 h-9 md:h-10 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-50 ring-1 ring-slate-900/20 text-sm"
          title="Se déconnecter"
        >
          <LogOut className="w-4 h-4" />
          Déconnexion
        </button>
      </div>
    </div>
  );
}
