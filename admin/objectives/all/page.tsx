// app/objectives/all/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Shell from "@/app/components/Shell";
import Modal from "@/app/components/ui/Modal";
import {
  AlertCircle, Search, Plus, Trash2, CheckCircle2, StickyNote,
  Calendar as CalendarIcon, Clock, TrendingUp, UserPlus, type LucideIcon
} from "lucide-react";

/* =================== Types =================== */
type ObjStatus = "todo" | "in_progress" | "done";
type Priority = "low" | "medium" | "high";

type SubObj = {
  id: number;
  objective_id: number;
  title: string;
  weight: number;
  dueDate: string | null;
  done: 0 | 1;
};

type Objective = {
  id: number;
  userId: number;
  owner: string;
  title: string;
  description: string | null;
  unit: string;
  target: number;
  current: number;
  startDate: string;
  endDate: string;
  status: ObjStatus;
  priority: Priority;
  created_at: string;
  updated_at: string;
  subtasks: SubObj[];
  calendar_event_id?: string | null;
};

type UserLite = { id: number; name: string; email: string };

type Paginated<T> = { items: T[]; total?: number };

/** Raw types venant de l'API pour la normalisation */
type RawSubObj = {
  id?: number;
  objective_id?: number;
  title?: string;
  weight?: number | string;
  dueDate?: string | null;
  due_date?: string | null;
  done?: number | boolean;
};

type RawObjective = {
  id?: number | string;
  userId?: number | string;
  user_id?: number | string;
  owner_id?: number | string;
  owner?: string;
  owner_name?: string;
  user_name?: string;
  title?: string;
  description?: string | null;
  unit?: string;
  target?: number | string;
  current?: number | string;
  startDate?: string;
  start_date?: string;
  endDate?: string;
  end_date?: string;
  status?: ObjStatus;
  priority?: Priority;
  created_at?: string;
  updated_at?: string;
  subtasks?: RawSubObj[];
  calendar_event_id?: string | null;
};

type AssignMap = Record<number, number>;

/* =================== Helpers =================== */
const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");
const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};
function safeDate(d: string) { return new Date(`${d}T00:00:00`); }
function human(d: string) { try { return new Date(d).toLocaleDateString(); } catch { return d; } }
function hoursBetween(aISO: string, bISO: string) {
  const ms = safeDate(bISO).getTime() - safeDate(aISO).getTime();
  return Math.max(0, Math.round(ms / 36e5));
}
function progressFromTimes(startDate: string, endDate: string, now = new Date()) {
  const totalH = Math.max(1, hoursBetween(startDate, endDate));
  const elapsedH = Math.max(0, Math.round((now.getTime() - safeDate(startDate).getTime()) / 36e5));
  const pct = Math.max(0, Math.min(100, (elapsedH / totalH) * 100));
  return { pct, totalH: totalH, elapsedH };
}
/** Escalade de priorité :
 * - À 50% : low→medium, medium→high
 * - À 70% : medium→high
 * Ne baisse jamais.
 */
function autoPriority(base: Priority, pctElapsed: number): Priority {
  if (pctElapsed >= 70) return base === "medium" ? "high" : base;
  if (pctElapsed >= 50) {
    if (base === "low") return "medium";
    if (base === "medium") return "high";
  }
  return base;
}

async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch { /* ignore */ }
  const res = await fetch(url, { credentials: "include", ...init, headers });
  const raw = await res.text();

  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { error: raw?.slice(0, 200) || "Réponse non-JSON" };
  }

  if (!res.ok) {
    const maybeObj = (data ?? {}) as Record<string, unknown>;
    const message = typeof maybeObj.error === "string" ? maybeObj.error : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

/* =================== Pure helpers déplacés hors composant =================== */
function computeProgress(o: Objective): number {
  if (Array.isArray(o.subtasks) && o.subtasks.length) {
    const total = o.subtasks.reduce((s, t) => s + Math.max(0, t.weight || 0), 0) || 100;
    const done = o.subtasks.filter(t => t.done).reduce((s, t) => s + Math.max(0, t.weight || 0), 0);
    return Math.round((done / total) * 100);
  }
  const { pct } = progressFromTimes(o.startDate, o.endDate);
  return Math.round(pct);
}

function displayPriority(o: Objective): Priority {
  return autoPriority(o.priority, computeProgress(o));
}

function normalize(raw: RawObjective): Objective {
  const id = Number(raw.id ?? 0);
  const userId = Number(raw.userId ?? raw.user_id ?? raw.owner_id ?? 0);
  const owner = String(raw.owner ?? raw.owner_name ?? raw.user_name ?? "");
  const title = String(raw.title ?? "");
  const description = raw.description ?? null;
  const unit = String(raw.unit ?? "%");
  const target = Number(raw.target ?? 100);
  const current = Number(raw.current ?? 0);
  const startDate = String(raw.startDate ?? raw.start_date ?? todayStr());
  const endDate = String(raw.endDate ?? raw.end_date ?? todayStr());
  const status: ObjStatus = (raw.status as ObjStatus) ?? "todo";
  const priority: Priority = (raw.priority as Priority) ?? "low";
  const created_at = String(raw.created_at ?? new Date().toISOString());
  const updated_at = String(raw.updated_at ?? new Date().toISOString());
  const calendar_event_id = raw.calendar_event_id ?? null;
  const subtasks: SubObj[] = Array.isArray(raw.subtasks)
    ? raw.subtasks.map((s) => ({
        id: Number(s.id ?? 0),
        objective_id: Number(s.objective_id ?? id),
        title: String(s.title ?? ""),
        weight: Number(s.weight ?? 0),
        dueDate: s.dueDate ?? s.due_date ?? null,
        done: s.done ? 1 : 0,
      }))
    : [];

  return {
    id,
    userId,
    owner,
    title,
    description,
    unit,
    target,
    current,
    startDate,
    endDate,
    status,
    priority,
    created_at,
    updated_at,
    subtasks,
    calendar_event_id,
  };
}

function normalizeList(arr: RawObjective[]): Objective[] {
  return arr.map(normalize);
}

/* =================== UI small =================== */
const Bar: React.FC<{ value: number }> = ({ value }) => (
  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
    <div
      className="h-full bg-gradient-to-r from-indigo-600 to-fuchsia-600"
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
);

/* =================== Page =================== */
export default function ObjectivesAllPage() {
  // data
  const [users, setUsers] = useState<UserLite[]>([]);
  const [items, setItems] = useState<Objective[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | number>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ObjStatus>("all");
  const [sort, setSort] = useState<"priority" | "end" | "progress">("priority");

  // create form (assigner)
  const [assigneeId, setAssigneeId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [unit, setUnit] = useState("%");
  const [target, setTarget] = useState(100);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [subs, setSubs] = useState<Array<{ title: string; weight: number; dueDate: string }>>([
    { title: "", weight: 50, dueDate: "" }, { title: "", weight: 50, dueDate: "" }
  ]);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  // modals
  const [editSubsOf, setEditSubsOf] = useState<Objective | null>(null);
  const [noteFor, setNoteFor] = useState<Objective | null>(null);
  const [completeOf, setCompleteOf] = useState<Objective | null>(null);

  // charge users + objectifs (scope=all)
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [u, o] = await Promise.all([
          fetchJSON<Paginated<UserLite>>("/api/users?lite=1&pageSize=500"),
          fetchJSON<{ items: RawObjective[] }>("/api/objectives?scope=all"),
        ]);
        setUsers(u.items || []);
        setItems(normalizeList(o.items || []));
        setErr(null);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Erreur chargement");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // si on change la date de début → caler la fin si nécessaire
  useEffect(() => {
    setEndDate(prev => {
      const prevMs = safeDate(prev).getTime();
      const startMs = safeDate(startDate).getTime();
      return prevMs < startMs ? startDate : prev;
    });
  }, [startDate]);

  const list = useMemo(() => {
    let arr = items.slice();
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter(o =>
        o.title.toLowerCase().includes(s) ||
        (o.description ?? "").toLowerCase().includes(s) ||
        (o.owner ?? "").toLowerCase().includes(s)
      );
    }
    if (userFilter !== "all") arr = arr.filter(o => o.userId === userFilter);
    if (statusFilter !== "all") arr = arr.filter(o => o.status === statusFilter);

    arr.sort((a, b) => {
      if (sort === "end") return safeDate(a.endDate).getTime() - safeDate(b.endDate).getTime();
      if (sort === "progress") return computeProgress(b) - computeProgress(a);
      const ord: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
      const pa = ord[displayPriority(a)], pb = ord[displayPriority(b)];
      if (pa !== pb) return pb - pa;
      return safeDate(a.endDate).getTime() - safeDate(b.endDate).getTime();
    });
    return arr;
  }, [items, q, userFilter, statusFilter, sort]);

  /* ======= Création/Assignation ======= */
  function validateCreate(): string | null {
    if (!assigneeId) return "Veuillez sélectionner un utilisateur.";
    if (!title.trim()) return "Le titre est requis.";
    const startMs = safeDate(startDate).getTime();
    const endMs = safeDate(endDate).getTime();
    if (endMs < startMs) return "La date de fin ne peut pas être antérieure à la date de début.";
    const kept = subs.filter(s => s.title.trim());
    const sum = kept.reduce((s, t) => s + (Number(t.weight) || 0), 0);
    if (kept.length && Math.abs(sum - 100) > 0.001) return "La somme des poids des sous-objectifs doit faire 100%.";
    return null;
  }

  async function createObjective(e: React.FormEvent) {
    e.preventDefault(); setFormErr(null);
    const v = validateCreate(); if (v) { setFormErr(v); return; }
    setSaving(true);
    try {
      const payload = {
        userId: Number(assigneeId),
        title: title.trim(),
        description: desc.trim() || null,
        unit: unit.trim() || "%",
        target: Number(target || 0),
        startDate,
        endDate,
        subtasks: subs.filter(s => s.title.trim()).map(s => ({ ...s, weight: Number(s.weight || 0) })),
      };
      const out = await fetchJSON<{ item: RawObjective }>("/api/objectives", { method: "POST", body: JSON.stringify(payload) });
      const obj = normalize(out.item);
      setItems(prev => [obj, ...prev]);
      // reset
      setAssigneeId(""); setTitle(""); setDesc(""); setUnit("%"); setTarget(100);
      const d = todayStr(); setStartDate(d); setEndDate(d);
      setSubs([{ title: "", weight: 50, dueDate: "" }, { title: "", weight: 50, dueDate: "" }]);
    } catch (e: unknown) {
      setFormErr(e instanceof Error ? e.message : "Erreur de création");
    } finally { setSaving(false); }
  }

  /* ======= Actions ======= */
  async function toggleSub(o: Objective, s: SubObj) {
    const r = await fetchJSON<{ item: RawObjective }>(`/api/objectives/${o.id}/subtasks/${s.id}`, {
      method: "PATCH", body: JSON.stringify({ done: !s.done })
    });
    const updated = normalize(r.item);
    setItems(prev => prev.map(x => x.id === o.id ? updated : x));
  }
  async function completeObjective(o: Objective) {
    const r = await fetchJSON<{ item: RawObjective }>(`/api/objectives/${o.id}`, {
      method: "PATCH", body: JSON.stringify({ complete: true })
    });
    const updated = normalize(r.item);
    setItems(prev => prev.map(x => x.id === o.id ? updated : x));
  }

  // *** Réassignation ***
  const [assignBusy, setAssignBusy] = useState<number | null>(null);
  const [assignMap, setAssignMap] = useState<AssignMap>({}); // objectiveId -> userId (sélection)

  function setAssignValue(objId: number, newUserId: number) {
    setAssignMap(m => ({ ...m, [objId]: newUserId }));
  }
  async function applyAssign(obj: Objective) {
    const newUserId = assignMap[obj.id];
    if (!newUserId || newUserId === obj.userId) return;
    setAssignBusy(obj.id);
    try {
      const r = await fetchJSON<{ item: RawObjective }>(`/api/objectives/${obj.id}`, {
        method: "PATCH",
        body: JSON.stringify({ userId: newUserId })
      });
      const updated = normalize(r.item);
      setItems(prev => prev.map(x => x.id === obj.id ? updated : x));
    } finally {
      setAssignBusy(null);
    }
  }

  async function saveSubsOnly(
    id: number,
    subsPayload: Array<{ id?: number; title: string; weight?: number; dueDate?: string | null; _action?: "delete" | "upsert" }>
  ) {
    const kept = subsPayload.filter(s => s._action !== "delete");
    if (kept.length && kept.some(s => !s.title.trim())) throw new Error("Chaque sous-objectif doit avoir un titre.");
    const sum = kept.reduce((s, t) => s + (Number(t.weight) || 0), 0);
    if (kept.length && sum > 0 && Math.abs(sum - 100) > 0.001) throw new Error("La somme des poids doit faire 100%.");
    const r = await fetchJSON<{ item: RawObjective }>(`/api/objectives/${id}`, {
      method: "PATCH", body: JSON.stringify({ subtasks: subsPayload })
    });
    const updated = normalize(r.item);
    setItems(prev => prev.map(x => x.id === id ? updated : x));
  }

  async function addNote(id: number, text: string) {
    await fetchJSON<unknown>(`/api/objectives/${id}/notes`, { method: "POST", body: JSON.stringify({ text }) });
  }

  /* =================== UI =================== */
  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Objectifs — Tous">
      {/* Fond doux */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -left-16 w-80 h-80 rounded-full blur-3xl opacity-40" style={{ backgroundColor: "#c7d2fe" }} />
        <div className="absolute top-64 -right-10 w-96 h-96 rounded-full blur-3xl opacity-40" style={{ backgroundColor: "#fbcfe8" }} />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {err && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          <AlertCircle className="w-4 h-4" />{err}
        </div>}

        {/* KPIs */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { key: "tot", title: "Objectifs", value: items.length, tone: "violet", icon: TrendingUp },
            { key: "todo", title: "À faire", value: items.filter(o => o.status === "todo").length, tone: "blue", icon: CalendarIcon },
            { key: "prog", title: "En cours", value: items.filter(o => o.status === "in_progress").length, tone: "amber", icon: Clock },
            { key: "done", title: "Terminés", value: items.filter(o => o.status === "done").length, tone: "green", icon: CheckCircle2 },
          ].map(k => {
            const Icon = k.icon as LucideIcon;
            return (
              <div key={k.key} className="rounded-2xl overflow-hidden">
                <div className={cls("p-4 text-white bg-gradient-to-br",
                  k.tone === "violet" ? "from-violet-500 to-fuchsia-500" :
                    k.tone === "blue" ? "from-sky-500 to-blue-600" :
                      k.tone === "amber" ? "from-amber-500 to-orange-500" : "from-emerald-500 to-teal-500")}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[12px] text-white/90">{k.title}</div>
                      <div className="text-3xl font-bold leading-tight">{k.value}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-white/20"><Icon className="w-5 h-5" /></div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {/* Création & Assignation */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Créer & assigner un objectif</h2>
          {formErr && <div className="mb-3 flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4" /> {formErr}
          </div>}
          <form onSubmit={createObjective} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
            <div className="xl:col-span-2">
              <div className="text-[12px] text-slate-600 mb-1">Utilisateur</div>
              <select
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400 outline-none"
                value={assigneeId === "" ? "" : String(assigneeId)}
                onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">— Sélectionner —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
              </select>
            </div>
            <div className="xl:col-span-2">
              <div className="text-[12px] text-slate-600 mb-1">Titre</div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Atteindre 95% de conformité"
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Unité</div>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%"
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Cible</div>
              <input type="number" min={0} value={target} onChange={(e) => setTarget(Number(e.target.value) || 0)} placeholder="100"
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Date de début</div>
              <input type="date" value={startDate} min={todayStr()}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Date de fin</div>
              <input type="date" value={endDate} min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div className="md:col-span-2 xl:col-span-6">
              <div className="text-[12px] text-slate-600 mb-1">Description</div>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Détails, jalons, contraintes…"
                className="w-full h-24 px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none resize-y" />
            </div>

            {/* Sous-objectifs */}
            <div className="md:col-span-2 xl:col-span-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[12px] text-slate-600">Sous-objectifs (total = 100%)</div>
                <button type="button" onClick={() => setSubs(s => [...s, { title: "", weight: 0, dueDate: "" }])}
                  className="inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
                  <Plus className="w-4 h-4" /> Ajouter
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                {subs.map((s, i) => (
                  <div key={i} className="col-span-12 grid grid-cols-12 gap-2">
                    <input className="col-span-6 h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                      placeholder={`Sous-objectif #${i + 1}`} value={s.title}
                      onChange={(e) => setSubs(p => p.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                    <input type="number" min={0} max={100} className="col-span-2 h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                      placeholder="Poids %" value={s.weight}
                      onChange={(e) => setSubs(p => p.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) || 0 } : x))} />
                    <input type="date" className="col-span-3 h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                      value={s.dueDate} onChange={(e) => setSubs(p => p.map((x, j) => j === i ? { ...x, dueDate: e.target.value } : x))} />
                    <button type="button" className="col-span-1 inline-flex items-center justify-center rounded-xl ring-1 ring-slate-200 hover:bg-slate-50"
                      onClick={() => setSubs(p => p.filter((_, j) => j !== i))} aria-label="Supprimer">
                      <Trash2 className="w-4 h-4 text-slate-600" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-2 xl:col-span-6 flex justify-end">
              <button disabled={saving} className={cls("px-4 h-10 rounded-xl text-white font-semibold",
                saving ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700")}>
                {saving ? "Création…" : "Créer l’objectif"}
              </button>
            </div>
          </form>
        </section>

        {/* Filtres / tri */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="text-sm text-slate-600">Filtrer et trier</div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…"
                  className="h-10 pl-7 pr-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm" />
              </div>
              <select value={userFilter} onChange={(e) => setUserFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                className="h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400 outline-none text-sm">
                <option value="all">Tous les utilisateurs</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ObjStatus | "all")}
                className="h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400 outline-none text-sm">
                <option value="all">Tous statuts</option>
                <option value="todo">À faire</option>
                <option value="in_progress">En cours</option>
                <option value="done">Terminé</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as "priority" | "end" | "progress")}
                className="h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400 outline-none text-sm">
                <option value="priority">Tri par priorité</option>
                <option value="end">Tri par date de fin</option>
                <option value="progress">Tri par progression</option>
              </select>
            </div>
          </div>
        </section>

        {/* Liste + réassignation inline */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {loading && <div className="col-span-full text-slate-500">Chargement…</div>}
          {!loading && list.map(o => {
            const progress = computeProgress(o);
            const pr = displayPriority(o);
            const prBadge =
              pr === "high" ? "bg-red-100 text-red-700 ring-red-200"
                : pr === "medium" ? "bg-amber-100 text-amber-700 ring-amber-200"
                  : "bg-emerald-100 text-emerald-700 ring-emerald-200";
            const statusLabel = o.status === "todo" ? "À faire" : o.status === "in_progress" ? "En cours" : "Terminé";
            const stBadge = o.status === "done" ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
              : o.status === "in_progress" ? "bg-blue-100 text-blue-700 ring-blue-200"
                : "bg-slate-100 text-slate-700 ring-slate-200";

            return (
              <div key={o.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{o.title}</div>
                    <div className="text-[12px] text-slate-600">Assigné à : <b>{o.owner || `#${o.userId}`}</b></div>
                    {o.description && <div className="text-[12px] text-slate-500 line-clamp-2">{o.description}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={cls("px-2 py-1 rounded-lg text-xs ring-1", prBadge)}>
                      {pr === "high" ? "Priorité Haute" : pr === "medium" ? "Priorité Moyenne" : "Priorité Basse"}
                    </span>
                    <span className={cls("px-2 py-1 rounded-lg text-xs ring-1", stBadge)}>{statusLabel}</span>
                  </div>
                </div>

                {/* Réassignation inline */}
                <div className="rounded-lg ring-1 ring-slate-200 p-2 bg-slate-50/50">
                  <div className="text-[11px] text-slate-600 mb-1 flex items-center gap-1">
                    <UserPlus className="w-3.5 h-3.5" /> Réassigner à un autre utilisateur
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={String(assignMap[o.id] ?? o.userId)}
                      onChange={(e) => setAssignValue(o.id, Number(e.target.value))}
                      className="w-30 h-9 px-2 rounded-lg bg-white ring-1 ring-slate-200 text-sm"
                    >
                      {users.map(u => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
                    </select>
                    <button
                      onClick={() => applyAssign(o)}
                      disabled={assignBusy === o.id}
                      className={cls("h-9 px-3 rounded-lg text-white text-sm",
                        assignBusy === o.id ? "bg-slate-400" : "bg-sky-600 hover:bg-sky-700")}
                    >
                      {assignBusy === o.id ? "Assignation…" : "Assigner"}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[12px] text-slate-600">
                  <span>Du {human(o.startDate)}</span>
                  <span>Au {human(o.endDate)}</span>
                </div>

                <div className="space-y-1">
                  <Bar value={progress} />
                  <div className="text-[12px] text-slate-600">{progress}%</div>
                </div>

                <div className="space-y-2">
                  {o.subtasks.length ? o.subtasks.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!s.done}
                        onChange={() => toggleSub(o, s)}
                        className="accent-blue-600"
                      />
                      <span className={cls(Boolean(s.done) && "line-through text-slate-400")}>
                        {s.title} <span className="text-[11px] text-slate-500">({s.weight}%)</span>
                        {s.dueDate && <span className="ml-1 text-[11px] text-slate-500">• {human(s.dueDate)}</span>}
                      </span>
                    </label>
                  )) : <div className="text-[12px] text-slate-500">Aucun sous-objectif</div>}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button onClick={() => setEditSubsOf(o)}
                          className="inline-flex items-center gap-2 px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm">
                    Modifier SO
                  </button>
                  <button onClick={() => setNoteFor(o)}
                          className="inline-flex items-center gap-2 px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm">
                    <StickyNote className="w-4 h-4" /> Ajouter note
                  </button>
                  <button onClick={() => setCompleteOf(o)}
                          disabled={o.status === "done"}
                          className={cls("inline-flex items-center gap-2 px-3 h-9 rounded-lg text-sm",
                            o.status === "done" ? "bg-slate-400 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white")}>
                    <CheckCircle2 className="w-4 h-4" /> Atteint
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && list.length === 0 && <div className="col-span-full text-slate-500">Aucun objectif.</div>}
        </section>
      </main>

      {/* Modale compléter */}
      <Modal open={!!completeOf} onClose={() => setCompleteOf(null)} title="Marquer l’objectif comme atteint" size="md">
        <div className="space-y-3 text-sm">
          <p>Confirmez-vous que l’objectif <b>{completeOf?.title}</b> est entièrement atteint ?</p>
          <ul className="list-disc pl-5 text-slate-600">
            <li>Statut → <b>Terminé</b>, progression à <b>100%</b>, toutes les sous-tâches cochées.</li>
          </ul>
          <div className="flex justify-end gap-2 pt-3">
            <button onClick={() => setCompleteOf(null)} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50">Annuler</button>
            <button
              onClick={async () => { if (!completeOf) return; await completeObjective(completeOf); setCompleteOf(null); }}
              className="px-4 h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >Marquer atteint</button>
          </div>
        </div>
      </Modal>

      {/* Modale éditer SO */}
      <EditSubsModal
        open={!!editSubsOf}
        onClose={() => setEditSubsOf(null)}
        objective={editSubsOf}
        onSave={async (payload) => { await saveSubsOnly(payload.id, payload.subs); setEditSubsOf(null); }}
      />

      {/* Modale note */}
      <NoteModal
        open={!!noteFor}
        onClose={() => setNoteFor(null)}
        objective={noteFor}
        onSave={async (text) => { if (!noteFor) return; await addNote(noteFor.id, text); setNoteFor(null); }}
      />
    </Shell>
  );
}

/* ======= Modale Édition Sous-objectifs ======= */
function EditSubsModal({
  open, onClose, objective, onSave,
}: {
  open: boolean; onClose: () => void; objective: Objective | null;
  onSave: (p: { id: number; subs: Array<{ id?: number; title: string; weight?: number; dueDate?: string | null; _action?: "delete" | "upsert" }> }) => Promise<void>;
}) {
  const [rows, setRows] = useState<Array<{ id?: number; title: string; weight?: number; dueDate?: string | null; _action?: "delete" | "upsert" }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!objective) return;
    setRows(objective.subtasks.map(s => ({ id: s.id, title: s.title, weight: s.weight, dueDate: s.dueDate, _action: "upsert" })));
    setError(null); setSaving(false);
  }, [objective]);

  function add() { setRows(p => [...p, { title: "", weight: 0, dueDate: null, _action: "upsert" }]); }
  function del(i: number) { setRows(p => p.map((x, idx) => idx === i ? { ...x, _action: "delete" } : x)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const kept = rows.filter(s => s._action !== "delete");
    if (kept.length && kept.some(s => !s.title.trim())) { setError("Chaque sous-objectif doit avoir un titre."); return; }
    const sum = kept.reduce((s, t) => s + (Number(t.weight) || 0), 0);
    if (kept.length && sum > 0 && Math.abs(sum - 100) > 0.001) { setError("La somme des poids doit faire 100%."); return; }
    if (!objective) return;
    setSaving(true);
    try { await onSave({ id: objective.id, subs: rows }); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Erreur inconnue"); setSaving(false); return; }
  }

  return (
    <Modal open={open} onClose={onClose} title="Modifier les sous-objectifs" size="lg">
      {!objective ? null : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Objectif</div>
              <div className="px-3 h-9 grid items-center rounded-lg ring-1 ring-slate-200 bg-slate-50">{objective.title}</div>
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Période</div>
              <div className="px-3 h-9 grid items-center rounded-lg ring-1 ring-slate-200 bg-slate-50">
                {objective.startDate} → {objective.endDate}
              </div>
            </div>
          </div>

          {error && <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            {rows.map((r, i) => (
              <div key={i} className={cls("col-span-12 grid grid-cols-12 gap-2", r._action === "delete" && "opacity-50")}>
                <input className="col-span-6 h-9 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  placeholder={`Sous-objectif #${i + 1}`} value={r.title}
                  onChange={(e) => setRows(p => p.map((x, j) => j === i ? { ...x, title: e.target.value, _action: "upsert" } : x))} />
                <input type="number" min={0} max={100} className="col-span-2 h-9 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  placeholder="Poids %" value={r.weight ?? 0}
                  onChange={(e) => setRows(p => p.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) || 0, _action: "upsert" } : x))} />
                <input type="date" className="col-span-3 h-9 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  value={r.dueDate || ""} onChange={(e) => setRows(p => p.map((x, j) => j === i ? { ...x, dueDate: e.target.value, _action: "upsert" } : x))} />
                <button type="button" onClick={() => del(i)}
                  className="col-span-1 inline-flex items-center justify-center rounded-lg ring-1 ring-slate-200 hover:bg-slate-50">
                  <Trash2 className="w-4 h-4 text-slate-600" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button type="button" onClick={add} className="px-3 h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-sm">
              <Plus className="w-4 h-4 inline-block mr-1" /> Ajouter
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm">Annuler</button>
              <button disabled={saving} className={cls("px-4 h-9 rounded-lg text-white text-sm",
                saving ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700")}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ======= Modale Note ======= */
function NoteModal({
  open, onClose, objective, onSave,
}: {
  open: boolean; onClose: () => void; objective: Objective | null; onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setText(""); setError(null); setSaving(false); } }, [open]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!text.trim()) { setError("Veuillez saisir une note."); return; }
    setSaving(true);
    try { if (objective) await onSave(text.trim()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Erreur inconnue"); setSaving(false); return; }
  }
  return (
    <Modal open={open} onClose={onClose} title={objective ? `Note — ${objective.title}` : "Ajouter une note"} size="md">
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>}
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Écrire une note…"
          className="w-full min-h-[120px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none resize-y text-sm" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm">Annuler</button>
          <button disabled={saving} className={cls("px-4 h-9 rounded-lg text-white text-sm", saving ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700")}>
            {saving ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
