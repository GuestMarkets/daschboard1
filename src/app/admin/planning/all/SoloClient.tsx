// app/planning/PlanningClient.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Shell from "@/app/components/Shell";
import Modal from "@/app/components/ui/Modal";
import {
  CalendarIcon, Plus, Users, Search, TrendingUp,
  AlertTriangle, CheckCircle2, Clock, XCircle, CheckSquare
} from "lucide-react";
import { RealTimeProvider, useRealTime } from "../../../../../lib/realtime";

/* ========= Types ========= */
type Priority = "low" | "medium" | "high";
type RSVP = "yes" | "no" | "maybe" | "pending";
type StatusFilter = "all" | "urgent" | "missed" | "done" | "upcoming" | "ongoing";

type LiteUser = { id: number; name: string; email: string; department_id: number | null };
type EventLite = {
  id: number; title: string; description: string | null;
  start_at: string; end_at: string | null; timezone: string;
  created_by: number; owner_name: string;
  attendees?: Array<{ user_id: number; name: string; email: string; role: "host" | "required" | "optional"; rsvp: RSVP }>;
};

type MeetingsResponse = { items: EventLite[] };
type PeopleResponse = { items: LiteUser[]; canInviteSuperAdmin: boolean; scope?: string };

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;

/* ========= Helpers ========= */
const cls = (...a: Array<string | false | undefined | null>) => a.filter(Boolean).join(" ");
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const toDateValue = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const toTimeValue = (d: Date) => d.toTimeString().slice(0, 5);
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Sécurise le parsing des DATETIME MySQL "YYYY-MM-DD HH:MM:SS" */
function safeSQLDate(sqlLike: string): Date {
  return new Date(sqlLike.replace(" ", "T"));
}
function composeSQLDatetime(dateYMD: string, timeHM: string) {
  const [y, m, d] = dateYMD.split("-").map(Number);
  const [hh, mm] = timeHM.split(":").map(Number);
  const loc = new Date(y, (m - 1), d, hh, mm, 0);
  return `${loc.getFullYear()}-${pad2(loc.getMonth() + 1)}-${pad2(loc.getDate())} ${pad2(loc.getHours())}:${pad2(loc.getMinutes())}:00`;
}

/** % de délai consommé avant le début (utilisé pour l’escalade de priorité) */
function percentToStart(startSQL: string) {
  const start = safeSQLDate(startSQL).getTime();
  const now = Date.now();
  if (!isFinite(start)) return 0;
  if (start <= now) return 100;
  const hoursLeft = (start - now) / 36e5;
  const windowH = Math.max(1, hoursLeft);
  const pct = 100 - Math.round((hoursLeft / windowH) * 100);
  return Math.max(0, Math.min(100, pct));
}
function autoPriority(base: Priority, pct: number): Priority {
  if (pct >= 70) return base === "medium" ? "high" : base;
  if (pct >= 50) {
    if (base === "low") return "medium";
    if (base === "medium") return "high";
  }
  return base;
}

/** Statut de réunion par horloge */
type MeetingStatus = "upcoming" | "ongoing" | "done";
function meetingStatus(ev: EventLite, now: Date = new Date()): MeetingStatus {
  const s = safeSQLDate(ev.start_at).getTime();
  const e = safeSQLDate(ev.end_at ?? ev.start_at).getTime();
  const t = now.getTime();
  if (!isFinite(s) || !isFinite(e)) return "upcoming";
  if (t < s) return "upcoming";
  if (t >= s && t < e) return "ongoing";
  return "done";
}

/** “Manquée” = terminée et aucun RSVP "yes" */
function isMissed(ev: EventLite): boolean {
  if (meetingStatus(ev) !== "done") return false;
  if (!ev.attendees || !ev.attendees.length) return true;
  return !ev.attendees.some(a => a.rsvp === "yes");
}

async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch {
    // ignore storage errors
  }
  const res = await fetch(url, { ...init, headers, credentials: "include" });
  const txt = await res.text();
  let data: unknown = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { error: txt?.slice(0, 200) || "non-JSON" }; }
  if (!res.ok) {
    const errMsg =
      (typeof data === "object" && data && "error" in data)
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return data as T;
}

/* ========= Composant interne (branché au RealTimeProvider) ========= */
function PlanningUI() {
  const rt = useRealTime();

  const [people, setPeople] = useState<LiteUser[]>([]);
  const [items, setItems] = useState<EventLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filtres
  const [q, setQ] = useState("");
  const [dateMin, setDateMin] = useState(toDateValue(new Date()));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Création (date unique + heures)
  const defaultStart = new Date(Date.now() + 45 * 60 * 1000);
  const [dateStr, setDateStr] = useState(toDateValue(defaultStart));
  const [startTime, setStartTime] = useState(toTimeValue(defaultStart));
  const [endTime, setEndTime] = useState(toTimeValue(new Date(defaultStart.getTime() + 60 * 60 * 1000)));
  const [openCreate, setOpenCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [basePriority, setBasePriority] = useState<Priority>("low");

  // Participants
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectAll, setSelectAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const ev = await fetchJSON<MeetingsResponse>("/api/planning/meetings");
      setItems(ev.items || []);
      setErr(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur rafraîchissement");
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [p, ev] = await Promise.all([
          fetchJSON<PeopleResponse>("/api/planning/people"),
          fetchJSON<MeetingsResponse>("/api/planning/meetings"),
        ]);
        setPeople(p.items || []);
        setItems(ev.items || []);
        setErr(null);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    })();

    // 🔔 Abonnement temps réel (intra navigateur / onglets)
    const unsubscribe = rt.subscribe((a) => {
      if (a.type === "meetings_changed") {
        void refresh();
      }
    });
    return unsubscribe;
  }, [rt, refresh]);

  // Select all toggle
  useEffect(() => {
    if (selectAll) setSelectedIds(people.map(p => p.id));
    else setSelectedIds([]);
  }, [selectAll, people]);

  function validStart(startSQL: string) {
    const t = safeSQLDate(startSQL).getTime();
    return isFinite(t) && t >= Date.now() + 30 * 60 * 1000;
  }
  function validEnd(startSQL: string, endSQL: string) {
    const s = safeSQLDate(startSQL).getTime();
    const e = safeSQLDate(endSQL).getTime();
    return isFinite(s) && isFinite(e) && e > s;
  }

  async function createMeeting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const start_at = composeSQLDatetime(dateStr, startTime);
    const end_at = composeSQLDatetime(dateStr, endTime);

    if (!title.trim()) { alert("Titre requis"); return; }
    if (!validStart(start_at)) { alert("La réunion doit commencer dans ≥ 30 min"); return; }
    if (!validEnd(start_at, end_at)) { alert("Heure de fin invalide"); return; }

    const payload = {
      title: title.trim(),
      description: desc.trim() || null,
      start_at, end_at,
      timezone: tz || "UTC",
      attendee_ids: selectedIds,
      invite_super_admin: false,
    };

    await fetchJSON<{ ok: boolean; id: number }>("/api/planning/meetings", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    // Rafraîchir local + notifier autres onglets/fenêtres
    await refresh();
    rt.publish({ type: "meetings_changed" });

    // reset UI
    setOpenCreate(false);
    setTitle(""); setDesc(""); setBasePriority("low");
    const n = new Date(Date.now() + 45 * 60 * 1000);
    setDateStr(toDateValue(n)); setStartTime(toTimeValue(n)); setEndTime(toTimeValue(new Date(n.getTime() + 60 * 60 * 1000)));
    setSelectedIds([]); setSelectAll(false);
  }

  // Décoration & KPI
  const decorated = useMemo(() => {
    return items.map(ev => {
      const pct = percentToStart(ev.start_at);
      const pr = autoPriority("low", pct);
      const st = meetingStatus(ev);
      const missed = isMissed(ev);
      const urgent = pr === "high" || pct >= 70;
      return { ev, pct: isFinite(pct) ? pct : 0, pr, st, missed, urgent };
    });
  }, [items]);

  const kpis = useMemo(() => {
    const total = decorated.length;
    const urgent = decorated.filter(x => x.urgent).length;
    const missed = decorated.filter(x => x.missed).length;
    const done = decorated.filter(x => x.st === "done").length;
    const upcoming = decorated.filter(x => x.st === "upcoming").length;
    const ongoing = decorated.filter(x => x.st === "ongoing").length;
    return { total, urgent, missed, done, upcoming, ongoing };
  }, [decorated]);

  // Liste filtrée
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return decorated
      .filter(({ ev }) => !dateMin || ev.start_at.slice(0, 10) >= dateMin)
      .filter(({ ev }) => !s || ev.title.toLowerCase().includes(s) || (ev.description || "").toLowerCase().includes(s))
      .filter(x => {
        switch (statusFilter) {
          case "urgent": return x.urgent;
          case "missed": return x.missed;
          case "done": return x.st === "done";
          case "upcoming": return x.st === "upcoming";
          case "ongoing": return x.st === "ongoing";
          default: return true;
        }
      })
      .sort((a, b) => safeSQLDate(a.ev.start_at).getTime() - safeSQLDate(b.ev.start_at).getTime());
  }, [decorated, q, dateMin, statusFilter]);

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Planning — Réunions">
      {/* BG */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -left-16 w-80 h-80 rounded-full blur-3xl opacity-40 bg-indigo-200" />
        <div className="absolute top-64 -right-10 w-96 h-96 rounded-full blur-3xl opacity-40 bg-fuchsia-200" />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</div>}

        {/* KPI */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
          {[
            { key: "total", label: "Réunions", val: kpis.total, grad: "from-violet-500 to-fuchsia-500", icon: TrendingUp },
            { key: "urgent", label: "Urgentes", val: kpis.urgent, grad: "from-rose-500 to-orange-500", icon: AlertTriangle },
            { key: "missed", label: "Manquées", val: kpis.missed, grad: "from-red-500 to-rose-600", icon: XCircle },
            { key: "ongoing", label: "En cours", val: kpis.ongoing, grad: "from-sky-500 to-blue-600", icon: Clock },
            { key: "upcoming", label: "À venir", val: kpis.upcoming, grad: "from-teal-500 to-emerald-600", icon: CalendarIcon },
            { key: "done", label: "Terminées", val: kpis.done, grad: "from-slate-600 to-slate-800", icon: CheckCircle2 },
          ].map(k => {
            const Icon = k.icon as IconType;
            return (
              <div key={k.key} className="rounded-2xl overflow-hidden ring-1 ring-black/5">
                <div className={cls("p-4 text-white bg-gradient-to-br", k.grad)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[12px] text-white/90">{k.label}</div>
                      <div className="text-3xl font-extrabold leading-tight drop-shadow-sm">{k.val}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-white/20"><Icon className="w-5 h-5" /></div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {/* Actions */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="text-slate-700">Planifier et gérer vos réunions</div>
          <button onClick={() => setOpenCreate(true)}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-xl bg-slate-900 text-white hover:bg-slate-800">
            <Plus className="w-4 h-4" /> Nouvelle réunion
          </button>
        </section>

        {/* Filtres */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…"
                className="w-full h-10 pl-7 pr-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">À partir du</span>
              <input type="date" value={dateMin} onChange={(e) => setDateMin(e.target.value)}
                className="h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm" />
            </div>
            <div className="lg:col-span-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400 outline-none text-sm">
                <option value="all">Tous les statuts</option>
                <option value="urgent">Urgentes</option>
                <option value="missed">Manquées</option>
                <option value="ongoing">En cours</option>
                <option value="upcoming">À venir</option>
                <option value="done">Terminées</option>
              </select>
            </div>
          </div>
        </section>

        {/* Liste */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {loading && <div className="col-span-full text-slate-500">Chargement…</div>}
          {!loading && list.map(({ ev, pct, pr, st, missed, urgent }) => {
            const prBadge =
              pr === "high" ? "bg-red-100 text-red-700 ring-red-200" :
                pr === "medium" ? "bg-amber-100 text-amber-700 ring-amber-200" :
                  "bg-emerald-100 text-emerald-700 ring-emerald-200";
            const stBadge =
              missed ? "bg-rose-100 text-rose-700 ring-rose-200" :
                st === "done" ? "bg-slate-100 text-slate-700 ring-slate-200" :
                  st === "ongoing" ? "bg-blue-100 text-blue-700 ring-blue-200" :
                    "bg-indigo-100 text-indigo-700 ring-indigo-200";
            const grad =
              urgent ? "from-rose-50 to-orange-50" :
                st === "ongoing" ? "from-sky-50 to-blue-50" :
                  st === "done" ? "from-slate-50 to-zinc-50" :
                    "from-indigo-50 to-fuchsia-50";

            const startD = safeSQLDate(ev.start_at);
            const endD = safeSQLDate(ev.end_at ?? ev.start_at);

            return (
              <div key={ev.id} className={cls("rounded-2xl border border-slate-200 bg-gradient-to-br p-4 space-y-3", grad)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{ev.title}</div>
                    <div className="text-[12px] text-slate-600">Créée par <b>{ev.owner_name}</b></div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cls("px-2 py-1 rounded-lg text-xs ring-1", prBadge)}>
                      {pr === "high" ? "Priorité Haute" : pr === "medium" ? "Priorité Moyenne" : "Priorité Basse"}
                    </span>
                    <span className={cls("px-2 py-1 rounded-lg text-xs ring-1", stBadge)}>
                      {missed ? "Manquée" : st === "done" ? "Terminée" : st === "ongoing" ? "En cours" : "À venir"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[12px] text-slate-600">
                  <CalendarIcon className="w-4 h-4" />
                  <span>
                    {isFinite(startD.getTime()) ? startD.toLocaleString() : ev.start_at}
                    {" — "}
                    {isFinite(endD.getTime())
                      ? endD.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : (ev.end_at ?? ev.start_at).slice(11, 16)}
                  </span>
                </div>

                {ev.description && <div className="text-[12px] text-slate-600">{ev.description}</div>}

                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={cls("h-full transition-all",
                      urgent ? "bg-gradient-to-r from-rose-500 to-orange-500"
                        : "bg-gradient-to-r from-indigo-600 to-fuchsia-600")}
                    style={{ width: `${Number.isFinite(pct) ? pct : 0}%` }}
                  />
                </div>
                <div className="text-[12px] text-slate-600">{Number.isFinite(pct) ? pct : 0}% vers l’échéance</div>

                <div className="flex items-center gap-2 text-[12px] text-slate-600">
                  <Users className="w-4 h-4" />
                  <span>Participants : {ev.attendees?.length ?? "—"}</span>
                </div>
              </div>
            );
          })}
          {!loading && list.length === 0 && <div className="col-span-full text-slate-500">Aucune réunion.</div>}
        </section>
      </main>

      {/* Modale création */}
      <Modal open={openCreate} onClose={() => setOpenCreate(false)} title="Programmer une réunion" size="lg">
        <form onSubmit={createMeeting} className="space-y-4 text-sm">
          {/* Titre + priorité de base */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Titre</div>
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Priorité (base)</div>
              <select value={basePriority} onChange={e => setBasePriority(e.target.value as Priority)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400">
                <option value="low">Basse</option>
                <option value="medium">Moyenne</option>
                <option value="high">Haute</option>
              </select>
              <div className="text-[11px] text-slate-500 mt-1">Elle s’ajustera automatiquement à 50% / 70% de l’échéance.</div>
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="text-[12px] text-slate-600 mb-1">Description</div>
            <textarea value={desc} onChange={e => setDesc(e.target.value)}
              className="w-full h-24 px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none resize-y" />
          </div>

          {/* Date unique + heures */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Date (début = fin même jour)</div>
              <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)}
                min={toDateValue(new Date())}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Heure de début</div>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Heure de fin</div>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
          </div>

          {/* Participants */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[12px] text-slate-600">Participants (dans votre périmètre)</div>
              <label className="inline-flex items-center gap-2 text-[12px] text-slate-700">
                <input type="checkbox" checked={selectAll} onChange={e => setSelectAll(e.target.checked)} />
                <CheckSquare className="w-4 h-4" /> Tout sélectionner
              </label>
            </div>
            <div className="max-h-56 overflow-auto rounded-xl ring-1 ring-slate-200 divide-y bg-white">
              {people.map(u => {
                const checked = selectedIds.includes(u.id);
                return (
                  <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        setSelectedIds(prev => e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id));
                      }}
                    />
                    <span className="text-sm">{u.name} <span className="text-[11px] text-slate-500">({u.email})</span></span>
                  </label>
                );
              })}
              {people.length === 0 && <div className="px-3 py-2 text-[12px] text-slate-500">Aucun utilisateur disponible.</div>}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenCreate(false)} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50">Annuler</button>
            <button className="px-4 h-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Créer</button>
          </div>
        </form>
      </Modal>
    </Shell>
  );
}

/* ========= Export par défaut : on wrappe l’UI dans le RealTimeProvider ========= */
export default function PlanningClient() {
  return (
    <RealTimeProvider>
      <PlanningUI />
    </RealTimeProvider>
  );
}
