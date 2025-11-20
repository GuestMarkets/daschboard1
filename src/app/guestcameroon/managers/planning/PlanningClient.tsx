// app/planning/solo/SoloClient.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Shell from "../../components/Shell";
import Modal from "../../components/ui/Modal";
import {
  CalendarIcon, Plus, Search, TrendingUp,
  AlertTriangle, CheckCircle2, Clock, XCircle, PlayCircle, Pencil, RotateCcw, Trash2
} from "lucide-react";
import { RealTimeProvider, useRealTime } from "../../../../../lib/realtime";

type Priority = "low" | "medium" | "high";
type RSVP = "yes" | "no" | "maybe" | "pending";
type MeetingStatus = "scheduled" | "ongoing" | "missed" | "done";
type StatusFilter = "all" | "urgent" | "missed" | "done" | "upcoming" | "ongoing";

type EventLite = {
  id: number;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  timezone: string;
  created_by: number;
  owner_name: string;
  started_at?: string | null;
  status: MeetingStatus; // ✅ vient du serveur
  attendees?: Array<{ user_id: number; name: string; email: string; role: "host" | "required" | "optional"; rsvp: RSVP }>;
};

// ---- Typage temps-réel (adapter si lib fournit des types) ----
type RTAction = { type: "meetings_changed" };
type RealTimeAPI = {
  subscribe: (cb: (a: RTAction) => void) => () => void;
  publish: (a: RTAction) => void;
};

const cls = (...a: Array<string | false | undefined | null>) => a.filter(Boolean).join(" ");
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const toDateValue = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toTimeValue = (d: Date) => d.toTimeString().slice(0, 5);
const pad2 = (n: number) => String(n).padStart(2, "0");
const safeSQLDate = (sqlLike: string) => new Date(sqlLike.replace(" ", "T"));
const composeSQLDatetime = (ymd: string, hm: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const loc = new Date(y, (m - 1), d, hh, mm, 0);
  return `${loc.getFullYear()}-${pad2(loc.getMonth() + 1)}-${pad2(loc.getDate())} ${pad2(loc.getHours())}:${pad2(loc.getMinutes())}:00`;
};

// % vers l’échéance (pour l’indicateur “urgent”)
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
  if (pct >= 50) { if (base === "low") return "medium"; if (base === "medium") return "high"; }
  return base;
}

// fetch JSON typé sans any
async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch { /* ignore */ }

  const res = await fetch(url, { ...init, headers, credentials: "include" });
  const txt = await res.text();

  let data: unknown = {};
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch {
    data = { error: txt?.slice(0, 200) || "non-JSON" };
  }

  if (!res.ok) {
    const maybeObj = (typeof data === "object" && data !== null) ? data as Record<string, unknown> : null;
    const msg = maybeObj && typeof maybeObj.error === "string" ? maybeObj.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

function SoloUI() {
  const rt = useRealTime() as unknown as RealTimeAPI;

  // Filtres
  const [q, setQ] = useState("");
  const [dateMin, setDateMin] = useState(toDateValue(new Date()));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Données
  const [items, setItems] = useState<EventLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Création
  const defaultStart = new Date(Date.now() + 45 * 60 * 1000);
  const [openCreate, setOpenCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [dateStr, setDateStr] = useState(toDateValue(defaultStart));
  const [startTime, setStartTime] = useState(toTimeValue(defaultStart));
  const [endTime, setEndTime] = useState(toTimeValue(new Date(defaultStart.getTime() + 60 * 60 * 1000)));
  const titleRef = useRef<HTMLInputElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (openCreate) titleRef.current?.focus(); }, [openCreate]);

  // Modales action (édition)
  const [editOf, setEditOf] = useState<EventLite | null>(null);

  // Form edit (stable)
  const [eTitle, setETitle] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eDate, setEDate] = useState(toDateValue(defaultStart));
  const [eStart, setEStart] = useState(toTimeValue(defaultStart));
  const [eEnd, setEEnd] = useState(toTimeValue(new Date(defaultStart.getTime() + 60 * 60 * 1000)));
  const eTitleRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const ev = await fetchJSON<{ items: EventLite[] }>("/api/planning/meetings?scope=mine");
      setItems(ev.items || []);
      setErr(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur rafraîchissement";
      setErr(msg);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const ev = await fetchJSON<{ items: EventLite[] }>("/api/planning/meetings?scope=mine");
        setItems(ev.items || []);
        setErr(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erreur de chargement";
        setErr(msg);
      } finally {
        setLoading(false);
      }
    })();

    const unsub = rt.subscribe((a) => { if (a.type === "meetings_changed") refresh(); });
    return unsub;
  }, [rt, refresh]);

  // validations
  function validStart(startSQL: string) {
    const t = safeSQLDate(startSQL).getTime();
    return isFinite(t) && t >= Date.now() + 30 * 60 * 1000;
  }
  function validEnd(startSQL: string, endSQL: string) {
    const s = safeSQLDate(startSQL).getTime();
    const e = safeSQLDate(endSQL).getTime();
    return isFinite(s) && isFinite(e) && e > s;
  }

  // Créer (solo)
  async function createMeeting(e: React.FormEvent) {
    e.preventDefault();
    const start_at = composeSQLDatetime(dateStr, startTime);
    const end_at = composeSQLDatetime(dateStr, endTime);

    if (!title.trim()) { alert("Titre requis"); titleRef.current?.focus(); return; }
    if (!validStart(start_at)) { alert("La réunion doit commencer dans ≥ 30 min"); return; }
    if (!validEnd(start_at, end_at)) { alert("Heure de fin invalide"); return; }

    await fetchJSON<{ ok: boolean; id: number }>("/api/planning/meetings", {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), description: desc.trim() || null, start_at, end_at, timezone: tz, solo: true })
    });

    await refresh(); rt.publish({ type: "meetings_changed" });
    setOpenCreate(false); setTitle(""); setDesc("");
    const n = new Date(Date.now() + 45 * 60 * 1000);
    setDateStr(toDateValue(n)); setStartTime(toTimeValue(n)); setEndTime(toTimeValue(new Date(n.getTime() + 60 * 60 * 1000)));
  }

  // Lancer
  async function startMeeting(ev: EventLite) {
    await fetchJSON(`/api/planning/meetings/${ev.id}`, { method: "PATCH", body: JSON.stringify({ action: "start" }) });
    await refresh(); rt.publish({ type: "meetings_changed" });
  }

  // Ouvrir Modifier (sert aussi pour "Reprogrammer")
  function openEdit(ev: EventLite) {
    setEditOf(ev);
    setETitle(ev.title || "");
    setEDesc(ev.description || "");
    const d = safeSQLDate(ev.start_at);
    const e = safeSQLDate(ev.end_at ?? ev.start_at);
    setEDate(toDateValue(d));
    setEStart(toTimeValue(d));
    setEEnd(toTimeValue(e));
    setTimeout(() => eTitleRef.current?.focus(), 0);
  }
  // Enregistrer edit/reprog
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editOf) return;
    const start_at = composeSQLDatetime(eDate, eStart);
    const end_at = composeSQLDatetime(eDate, eEnd);

    // si c’est une reprogrammation (missed), on autorise tant que ≥ 30 min et fin > début
    if (!validEnd(start_at, end_at)) { alert("Heure de fin invalide"); return; }
    if (!validStart(start_at)) { alert("La réunion doit commencer dans ≥ 30 min"); return; }

    await fetchJSON(`/api/planning/meetings/${editOf.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "edit", title: eTitle.trim(), description: eDesc.trim() || null, start_at, end_at })
    });
    setEditOf(null);
    await refresh(); rt.publish({ type: "meetings_changed" });
  }

  // Supprimer
  async function deleteMeeting(ev: EventLite) {
    if (!confirm("Supprimer cette réunion ?")) return;
    await fetchJSON(`/api/planning/meetings/${ev.id}`, { method: "DELETE" });
    await refresh(); rt.publish({ type: "meetings_changed" });
  }

  /* ====== Décoration & KPI ====== */
  const decorated = useMemo(() => {
    return items.map(ev => {
      const pct = percentToStart(ev.start_at);
      const pr = autoPriority("low", pct);
      const urgent = pr === "high" || pct >= 70;
      return { ev, pct: isFinite(pct) ? pct : 0, pr, urgent };
    });
  }, [items]);

  const kpis = useMemo(() => {
    const total = decorated.length;
    const urgent = decorated.filter(x => x.urgent).length;
    const missed = decorated.filter(x => x.ev.status === "missed").length;
    const done = decorated.filter(x => x.ev.status === "done").length;
    const upcoming = decorated.filter(x => x.ev.status === "scheduled").length;
    const ongoing = decorated.filter(x => x.ev.status === "ongoing").length;
    return { total, urgent, missed, done, upcoming, ongoing };
  }, [decorated]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return decorated
      .filter(({ ev }) => !dateMin || ev.start_at.slice(0, 10) >= dateMin)
      .filter(({ ev }) => !s || ev.title.toLowerCase().includes(s) || (ev.description || "").toLowerCase().includes(s))
      .filter(x => {
        switch (statusFilter) {
          case "urgent": return x.urgent;
          case "missed": return x.ev.status === "missed";
          case "done": return x.ev.status === "done";
          case "upcoming": return x.ev.status === "scheduled";
          case "ongoing": return x.ev.status === "ongoing";
          default: return true;
        }
      })
      .sort((a, b) => safeSQLDate(a.ev.start_at).getTime() - safeSQLDate(b.ev.start_at).getTime());
  }, [decorated, q, dateMin, statusFilter]);

  // Typage icône (lucide-react exporte des composants React SVG)
  type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Mes réunions (solo)">
      {/* … (fond et KPI identiques à la version précédente) … */}

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
          <div className="text-slate-700">Programmer une réunion (moi seul)</div>
          <button onClick={() => setOpenCreate(true)} className="inline-flex items-center gap-2 h-10 px-3 rounded-xl bg-slate-900 text-white hover:bg-slate-800">
            <Plus className="w-4 h-4" /> Nouvelle réunion
          </button>
        </section>

        {/* Filtres */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher…"
                autoCorrect="off"
                spellCheck={false}
                className="w-full h-10 pl-7 pr-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">À partir du</span>
              <input type="date" value={dateMin} onChange={(e) => setDateMin(e.target.value)}
                className="h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm" />
            </div>
            <div className="lg:col-span-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400 outline-none text-sm"
              >
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
          {!loading && list.map(({ ev, pct, pr, urgent }) => {
            const missed = ev.status === "missed";
            const stBadge =
              missed ? "bg-rose-100 text-rose-700 ring-rose-200" :
                ev.status === "done" ? "bg-slate-100 text-slate-700 ring-slate-200" :
                  ev.status === "ongoing" ? "bg-blue-100 text-blue-700 ring-blue-200" :
                    "bg-indigo-100 text-indigo-700 ring-indigo-200";
            const prBadge =
              pr === "high" ? "bg-red-100 text-red-700 ring-red-200" :
                pr === "medium" ? "bg-amber-100 text-amber-700 ring-amber-200" :
                  "bg-emerald-100 text-emerald-700 ring-emerald-200";
            const grad =
              urgent ? "from-rose-50 to-orange-50" :
                ev.status === "ongoing" ? "from-sky-50 to-blue-50" :
                  ev.status === "done" ? "from-slate-50 to-zinc-50" :
                    "from-indigo-50 to-fuchsia-50";

            const startD = safeSQLDate(ev.start_at);
            const endD = safeSQLDate(ev.end_at ?? ev.start_at);
            const now = new Date();
            const canStart = !ev.started_at && ev.status === "scheduled" && now >= startD && now < endD;
            const canEdit = ev.status === "scheduled"; // avant début
            const showReprog = ev.status === "missed";

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
                      {missed ? "Manquée" : ev.status === "done" ? "Terminée" : ev.status === "ongoing" ? (ev.started_at ? "En cours" : "À l'heure — non lancée") : "À venir"}
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

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => startMeeting(ev)}
                    disabled={!canStart}
                    className={cls("inline-flex items-center gap-2 px-3 h-9 rounded-lg text-white text-sm",
                      canStart ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-400 cursor-not-allowed")}
                  >
                    <PlayCircle className="w-4 h-4" /> Lancer
                  </button>

                  <button
                    onClick={() => openEdit(ev)}
                    disabled={!canEdit}
                    className={cls("inline-flex items-center gap-2 px-3 h-9 rounded-lg text-sm",
                      canEdit ? "bg-sky-600 text-white hover:bg-sky-700" : "bg-slate-100 text-slate-400 cursor-not-allowed")}
                  >
                    <Pencil className="w-4 h-4" /> Modifier
                  </button>

                  {showReprog && (
                    <button
                      onClick={() => openEdit(ev)} // 👉 Reprogrammer = Modifier
                      className="inline-flex items-center gap-2 px-3 h-9 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-sm"
                    >
                      <RotateCcw className="w-4 h-4" /> Reprogrammer
                    </button>
                  )}

                  <button
                    onClick={() => deleteMeeting(ev)}
                    className="inline-flex items-center gap-2 px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm"
                  >
                    <Trash2 className="w-4 h-4" /> Supprimer
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && list.length === 0 && <div className="col-span-full text-slate-500">Aucune réunion.</div>}
        </section>
      </main>

      {/* Modale création */}
      <Modal open={openCreate} onClose={() => setOpenCreate(false)} title="Programmer une réunion (solo)" size="lg">
        <form onSubmit={createMeeting} className="space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Titre</div>
              <input ref={titleRef} autoFocus value={title} onChange={e => setTitle(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Règle de priorité</div>
              <input value="Basse → Moyenne à 50% → Haute à 70%" readOnly
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-slate-50 text-slate-500" />
            </div>
          </div>

          <div>
            <div className="text-[12px] text-slate-600 mb-1">Description</div>
            <textarea ref={descRef} value={desc} onChange={e => setDesc(e.target.value)}
              className="w-full h-24 px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none resize-y" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Date</div>
              <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} min={toDateValue(new Date())}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Début</div>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Fin</div>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenCreate(false)} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50">Annuler</button>
            <button className="px-4 h-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Créer</button>
          </div>
        </form>
      </Modal>

      {/* Modale Modifier/Reprogrammer */}
      <Modal open={!!editOf} onClose={() => setEditOf(null)} title={editOf?.status === "missed" ? "Reprogrammer" : "Modifier la réunion"} size="lg">
        {!editOf ? null : (
          <form onSubmit={saveEdit} className="space-y-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-[12px] text-slate-600 mb-1">Titre</div>
                <input ref={eTitleRef} value={eTitle} onChange={(e) => setETitle(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
              </div>
              <div>
                <div className="text-[12px] text-slate-600 mb-1">Description</div>
                <input value={eDesc} onChange={(e) => setEDesc(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-[12px] text-slate-600 mb-1">Date</div>
                <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
              </div>
              <div>
                <div className="text-[12px] text-slate-600 mb-1">Début</div>
                <input type="time" value={eStart} onChange={(e) => setEStart(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
              </div>
              <div>
                <div className="text-[12px] text-slate-600 mb-1">Fin</div>
                <input type="time" value={eEnd} onChange={(e) => setEEnd(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
              </div>
            </div>
            <div className="text-[12px] text-slate-500">La réunion doit démarrer dans au moins 30 minutes (et fin &gt; début).</div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditOf(null)} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50">Annuler</button>
              <button className="px-4 h-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                {editOf.status === "missed" ? "Reprogrammer" : "Enregistrer"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </Shell>
  );
}

export default function SoloClient() {
  return (
    <RealTimeProvider>
      <SoloUI />
    </RealTimeProvider>
  );
}
