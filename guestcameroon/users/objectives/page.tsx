"use client";

import React, { useEffect, useMemo, useState } from "react";
import Shell from "@/app/components/Shell";
import Modal from "@/app/components/ui/Modal";
import {
  AlertCircle, Search, Plus, Trash2, CheckCircle2,
  Calendar as CalendarIcon, Clock, TrendingUp, Pencil, type LucideIcon
} from "lucide-react";

/* =================== Types =================== */
type ObjStatus = "todo" | "in_progress" | "done";
type Priority = "low" | "medium" | "high";
type StatusFilter = "all" | ObjStatus;
type SortKey = "priority" | "end" | "progress";

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
};

/** Structure d'objets telle que renvoyée par l'API (camelCase et snake_case possibles) */
type ObjectiveAPI = {
  id?: number | string;
  userId?: number | string;
  user_id?: number | string;
  owner_id?: number | string;
  owner?: string;
  owner_name?: string;
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
  subtasks?: Array<{
    id?: number | string;
    objective_id?: number | string;
    title?: string;
    weight?: number | string;
    dueDate?: string | null;
    due_date?: string | null;
    done?: boolean | 0 | 1;
  }>;
};

/* =================== Helpers =================== */
const cls = (...a: Array<string | false | null | undefined>) =>
  a.filter(Boolean).join(" ");

const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};
const safeDate = (d: string) => new Date(`${d}T00:00:00`);
const human = (d: string) => {
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
};

function fetchAuthHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch {}
  return headers;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: fetchAuthHeaders(init) });
  const txt = await res.text();
  let data: unknown = {};
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch {
    data = { error: txt?.slice(0, 200) || "Réponse non-JSON" };
  }

  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error?: unknown }).error ?? `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

/* ---- Progression (heures entre dates) ---- */
function hoursBetween(aISO: string, bISO: string) {
  const ms = safeDate(bISO).getTime() - safeDate(aISO).getTime();
  return Math.max(0, Math.round(ms / 36e5));
}
function progressFromTimes(startDate: string, endDate: string, now = new Date()) {
  const totalH = Math.max(1, hoursBetween(startDate, endDate));
  const elapsedH = Math.max(0, Math.round((now.getTime() - safeDate(startDate).getTime()) / 36e5));
  const pct = Math.max(0, Math.min(100, (elapsedH / totalH) * 100));
  return { pct, totalH, elapsedH };
}

/** Escalade de priorité en fonction de la progression (jamais en baisse) :
 * - À 50% : low→medium, medium→high
 * - À 70% : medium→high
 */
function autoPriority(base: Priority, pctElapsed: number): Priority {
  if (pctElapsed >= 70) return base === "medium" ? "high" : base;
  if (pctElapsed >= 50) {
    if (base === "low") return "medium";
    if (base === "medium") return "high";
  }
  return base;
}

/** Conversions typées pour événements <select> (évite tout `any`) */
function toStatusFilter(v: string): StatusFilter {
  if (v === "all" || v === "todo" || v === "in_progress" || v === "done") return v;
  return "all";
}
function toSortKey(v: string): SortKey {
  if (v === "end" || v === "progress" || v === "priority") return v;
  return "priority";
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
export default function MyObjectivesPage() {
  // utilisateur connecté
  const [meId, setMeId] = useState<number | null>(null);
  const [meName, setMeName] = useState<string>("");

  // données
  const [items, setItems] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filtres
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("priority");

  // création (assignée automatiquement à meId)
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [unit, setUnit] = useState("%");
  const [target, setTarget] = useState(100);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [subs, setSubs] = useState<Array<{ title: string; weight: number; dueDate: string }>>([
    { title: "", weight: 50, dueDate: "" },
    { title: "", weight: 50, dueDate: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  // modale d’édition
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Objective | null>(null);

  /* --------- Normalisation --------- */
  function normalize(o: ObjectiveAPI): Objective {
    return {
      id: Number(o.id),
      userId: Number(o.userId ?? o.user_id ?? o.owner_id ?? 0),
      owner: String(o.owner ?? o.owner_name ?? ""),
      title: String(o.title ?? ""),
      description: o.description ?? null,
      unit: String(o.unit ?? "%"),
      target: Number(o.target ?? 100),
      current: Number(o.current ?? 0),
      startDate: String(o.startDate ?? o.start_date ?? todayStr()),
      endDate: String(o.endDate ?? o.end_date ?? todayStr()),
      status: (o.status as ObjStatus) ?? "todo",
      priority: (o.priority as Priority) ?? "low",
      created_at: String(o.created_at ?? new Date().toISOString()),
      updated_at: String(o.updated_at ?? new Date().toISOString()),
      subtasks: Array.isArray(o.subtasks)
        ? o.subtasks.map((s) => ({
            id: Number(s.id),
            objective_id: Number(s.objective_id ?? o.id ?? 0),
            title: String(s.title ?? ""),
            weight: Number(s.weight ?? 0),
            dueDate: s.dueDate ?? s.due_date ?? null,
            done: s.done ? 1 : 0,
          }))
        : [],
    };
  }

  /* --------- Progression --------- */
  function computeProgress(o: Objective) {
    if (o.subtasks?.length) {
      const total = o.subtasks.reduce((s, t) => s + Math.max(0, t.weight || 0), 0) || 100;
      const done = o.subtasks.filter((t) => t.done).reduce((s, t) => s + Math.max(0, t.weight || 0), 0);
      return Math.round((done / total) * 100);
    }
    const { pct } = progressFromTimes(o.startDate, o.endDate);
    return Math.round(pct);
  }

  /* --------- Charger l’utilisateur + ses objectifs --------- */
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const me = await fetchJSON<{ ok: boolean; user?: { id: number; name?: string } }>("/api/me");
        const uid = me?.user?.id ?? null;
        const uname = (me?.user?.name || "").trim();
        setMeId(uid);
        setMeName(uname);

        const o = await fetchJSON<{ items: ObjectiveAPI[] }>("/api/objectives?scope=my");
        const normalized = (o.items || []).map(normalize);

        // Filtre défensif (au cas où l’API ne filtre pas)
        const onlyMine =
          uid != null
            ? normalized.filter((x) => Number(x.userId) === uid || (uname && x.owner?.trim() === uname))
            : normalized;

        setItems(onlyMine);
        setErr(null);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Erreur chargement");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* --------- Date de fin ≥ début --------- */
  useEffect(() => {
    setEndDate((prev) => {
      const prevMs = safeDate(prev).getTime();
      const startMs = safeDate(startDate).getTime();
      return prevMs < startMs ? startDate : prev;
    });
  }, [startDate]);

  /* --------- Liste dérivée --------- */
  const list = useMemo(() => {
    let arr = items.slice();
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter(
        (o) =>
          o.title.toLowerCase().includes(s) ||
          (o.description ?? "").toLowerCase().includes(s)
      );
    }
    if (statusFilter !== "all") arr = arr.filter((o) => o.status === statusFilter);

    arr.sort((a, b) => {
      if (sort === "end") return safeDate(a.endDate).getTime() - safeDate(b.endDate).getTime();
      if (sort === "progress") return computeProgress(b) - computeProgress(a);
      // priority (en tenant compte de l'escalade auto)
      const ord: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
      const pa = ord[autoPriority(a.priority, computeProgress(a))];
      const pb = ord[autoPriority(b.priority, computeProgress(b))];
      if (pa !== pb) return pb - pa;
      return safeDate(a.endDate).getTime() - safeDate(b.endDate).getTime();
    });
    return arr;
  }, [items, q, statusFilter, sort]); // plus d'avertissement de dépendances manquantes

  /* =================== Création =================== */
  function validateCreate(): string | null {
    if (!meId) return "Utilisateur non authentifié.";
    if (!title.trim()) return "Le titre est requis.";
    const startMs = safeDate(startDate).getTime();
    const endMs = safeDate(endDate).getTime();
    if (endMs < startMs) return "La date de fin ne peut pas précéder la date de début.";
    const kept = subs.filter((s) => s.title.trim());
    const sum = kept.reduce((s, t) => s + (Number(t.weight) || 0), 0);
    if (kept.length && Math.abs(sum - 100) > 0.001)
      return "La somme des poids des sous-objectifs doit faire 100%.";
    return null;
  }

  async function createObjective(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    const v = validateCreate();
    if (v) {
      setFormErr(v);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        userId: meId!,
        title: title.trim(),
        description: desc.trim() || null,
        unit: unit.trim() || "%",
        target: Number(target || 0),
        startDate,
        endDate,
        subtasks: subs
          .filter((s) => s.title.trim())
          .map((s) => ({ ...s, weight: Number(s.weight || 0) })),
      };
      const out = await fetchJSON<{ item: ObjectiveAPI }>("/api/objectives", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const obj = normalize(out.item);
      // sécurité “my”
      if (obj.userId === meId || (meName && obj.owner?.trim() === meName)) {
        setItems((prev) => [obj, ...prev]);
      }
      // reset
      setTitle("");
      setDesc("");
      setUnit("%");
      setTarget(100);
      const d = todayStr();
      setStartDate(d);
      setEndDate(d);
      setSubs([
        { title: "", weight: 50, dueDate: "" },
        { title: "", weight: 50, dueDate: "" },
      ]);
    } catch (e: unknown) {
      setFormErr(e instanceof Error ? e.message : "Erreur de création");
    } finally {
      setSaving(false);
    }
  }

  /* =================== Actions =================== */
  async function toggleSub(o: Objective, s: SubObj) {
    const r = await fetchJSON<{ item: ObjectiveAPI }>(`/api/objectives/${o.id}/subtasks/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: !s.done }),
    });
    const updated = normalize(r.item);
    setItems((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
  }

  async function completeObjective(o: Objective) {
    const r = await fetchJSON<{ item: ObjectiveAPI }>(`/api/objectives/${o.id}`, {
      method: "PATCH",
      body: JSON.stringify({ complete: true }),
    });
    const updated = normalize(r.item);
    setItems((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
  }

  /* =================== Modale Édition =================== */
  function openEdit(o: Objective) {
    setEditing(o);
    setEditOpen(true);
  }

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Mes objectifs">
      {/* Fond doux */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div
          className="absolute -top-24 -left-16 w-80 h-80 rounded-full blur-3xl opacity-40"
          style={{ backgroundColor: "#c7d2fe" }}
        />
        <div
          className="absolute top-64 -right-10 w-96 h-96 rounded-full blur-3xl opacity-40"
          style={{ backgroundColor: "#fbcfe8" }}
        />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {err && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            <AlertCircle className="w-4 h-4" />
            {err}
          </div>
        )}

        {/* KPIs */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { key: "tot", title: "Mes objectifs", value: items.length, tone: "violet", icon: TrendingUp },
            { key: "todo", title: "À faire", value: items.filter((o) => o.status === "todo").length, tone: "blue", icon: CalendarIcon },
            { key: "prog", title: "En cours", value: items.filter((o) => o.status === "in_progress").length, tone: "amber", icon: Clock },
            { key: "done", title: "Terminés", value: items.filter((o) => o.status === "done").length, tone: "green", icon: CheckCircle2 },
          ].map((k) => {
            const Icon: LucideIcon = k.icon;
            return (
              <div key={k.key} className="rounded-2xl overflow-hidden">
                <div
                  className={cls(
                    "p-4 text-white bg-gradient-to-br",
                    k.tone === "violet"
                      ? "from-violet-500 to-fuchsia-500"
                      : k.tone === "blue"
                      ? "from-sky-500 to-blue-600"
                      : k.tone === "amber"
                      ? "from-amber-500 to-orange-500"
                      : "from-emerald-500 to-teal-500"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[12px] text-white/90">{k.title}</div>
                      <div className="text-3xl font-bold leading-tight">{k.value}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-white/20">
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {/* Création (assigné d’office à l’utilisateur connecté) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Créer un objectif</h2>
          {formErr && (
            <div className="mb-3 flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
              <AlertCircle className="w-4 h-4" /> {formErr}
            </div>
          )}
          <form onSubmit={createObjective} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
            <div className="xl:col-span-2">
              <div className="text-[12px] text-slate-600 mb-1">Titre</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex. Atteindre 95% de conformité"
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Unité</div>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="%"
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Cible</div>
              <input
                type="number"
                min={0}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value) || 0)}
                placeholder="100"
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Date de début</div>
              <input
                type="date"
                value={startDate}
                min={todayStr()}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Date de fin</div>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </div>
            <div className="md:col-span-2 xl:col-span-6">
              <div className="text-[12px] text-slate-600 mb-1">Description</div>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Détails, jalons, contraintes…"
                className="w-full h-24 px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none resize-y"
              />
            </div>

            {/* Sous-objectifs */}
            <div className="md:col-span-2 xl:col-span-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[12px] text-slate-600">Sous-objectifs (total = 100%)</div>
                <button
                  type="button"
                  onClick={() => setSubs((s) => [...s, { title: "", weight: 0, dueDate: "" }])}
                  className="inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">Ajouter</span>
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                {subs.map((s, i) => (
                  <div key={i} className="col-span-12 grid grid-cols-12 gap-2">
                    <input
                      className="col-span-6 h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                      placeholder={`Sous-objectif #${i + 1}`}
                      value={s.title}
                      onChange={(e) => setSubs((p) => p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="col-span-2 h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                      placeholder="Poids %"
                      value={s.weight}
                      onChange={(e) => setSubs((p) => p.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) || 0 } : x)))}
                    />
                    <input
                      type="date"
                      className="col-span-3 h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none"
                      value={s.dueDate}
                      onChange={(e) => setSubs((p) => p.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))}
                    />
                    <button
                      type="button"
                      className="col-span-1 inline-flex items-center justify-center rounded-xl ring-1 ring-slate-200 hover:bg-slate-50"
                      onClick={() => setSubs((p) => p.filter((_, j) => j !== i))}
                      aria-label="Supprimer"
                    >
                      <Trash2 className="w-4 h-4 text-slate-600" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-2 xl:col-span-6 flex justify-end">
              <button
                disabled={saving || !meId}
                className={cls(
                  "px-4 h-10 rounded-xl text-white font-semibold inline-flex items-center gap-2",
                  saving ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                )}
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{saving ? "Création…" : "Créer l’objectif"}</span>
                <span className="sm:hidden">{saving ? "…" : "Créer"}</span>
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
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher…"
                  className="h-10 pl-7 pr-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400 outline-none text-sm"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(toStatusFilter(e.target.value))}
                className="h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400 outline-none text-sm"
              >
                <option value="all">Tous statuts</option>
                <option value="todo">À faire</option>
                <option value="in_progress">En cours</option>
                <option value="done">Terminé</option>
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(toSortKey(e.target.value))}
                className="h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-400 outline-none text-sm"
              >
                <option value="priority">Tri par priorité</option>
                <option value="end">Tri par date de fin</option>
                <option value="progress">Tri par progression</option>
              </select>
            </div>
          </div>
        </section>

        {/* Liste */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {loading && <div className="col-span-full text-slate-500">Chargement…</div>}
          {!loading &&
            list.map((o) => {
              const progress = computeProgress(o);
              const pr = autoPriority(o.priority, progress);
              const prBadge =
                pr === "high"
                  ? "bg-red-100 text-red-700 ring-red-200"
                  : pr === "medium"
                  ? "bg-amber-100 text-amber-700 ring-amber-200"
                  : "bg-emerald-100 text-emerald-700 ring-emerald-200";
              const statusLabel = o.status === "todo" ? "À faire" : o.status === "in_progress" ? "En cours" : "Terminé";
              const stBadge =
                o.status === "done"
                  ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
                  : o.status === "in_progress"
                  ? "bg-blue-100 text-blue-700 ring-blue-200"
                  : "bg-slate-100 text-slate-700 ring-slate-200";

              return (
                <div key={o.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{o.title}</div>
                      {o.description && <div className="text-[12px] text-slate-500 line-clamp-2">{o.description}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={cls("px-2 py-1 rounded-lg text-xs ring-1", prBadge)}>
                        {pr === "high" ? "Priorité Haute" : pr === "medium" ? "Priorité Moyenne" : "Priorité Basse"}
                      </span>
                      <span className={cls("px-2 py-1 rounded-lg text-xs ring-1", stBadge)}>{statusLabel}</span>
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
                    {o.subtasks.length ? (
                      o.subtasks.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="accent-blue-600"
                            checked={Boolean(s.done)}
                            onChange={() => toggleSub(o, s)}
                          />
                          <span className={cls(Boolean(s.done) ? "line-through text-slate-400" : undefined)}>
                            {s.title}{" "}
                            <span className="text-[11px] text-slate-500">({s.weight}%)</span>
                            {s.dueDate && <span className="ml-1 text-[11px] text-slate-500">• {human(s.dueDate)}</span>}
                          </span>
                        </label>
                      ))
                    ) : (
                      <div className="text-[12px] text-slate-500">Aucun sous-objectif</div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    {/* Éditer */}
                    <button
                      onClick={() => openEdit(o)}
                      className="inline-flex items-center justify-center gap-2 px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm"
                      title="Modifier"
                    >
                      <Pencil className="w-4 h-4" />
                      <span className="hidden sm:inline">Modifier</span>
                    </button>

                    {/* Terminer */}
                    <button
                      onClick={() => completeObjective(o)}
                      disabled={o.status === "done"}
                      className={cls(
                        "inline-flex items-center justify-center gap-2 px-3 h-9 rounded-lg text-sm",
                        o.status === "done" ? "bg-slate-400 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"
                      )}
                      title="Marquer atteint"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="hidden sm:inline">{o.status === "done" ? "Terminé" : "Atteint"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          {!loading && list.length === 0 && (
            <div className="col-span-full text-slate-500">Aucun objectif.</div>
          )}
        </section>
      </main>

      {/* ===== Modale d’édition ===== */}
      <EditObjectiveModal
        open={editOpen}
        objective={editing}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        }}
      />
    </Shell>
  );
}

/* =================== Modale : Éditer objectif & sous-objectifs =================== */
function EditObjectiveModal({
  open,
  onClose,
  objective,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  objective: Objective | null;
  onSaved: (o: Objective) => void;
}) {
  // local state sécurisé
  const [local, setLocal] = useState<Objective | null>(null);
  const [rows, setRows] = useState<Array<{ id?: number; title: string; weight?: number; dueDate?: string | null; _action?: "delete" | "upsert" }>>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !objective) return;
    setLocal({ ...objective });
    setRows(
      (objective.subtasks || []).map((s) => ({
        id: s.id,
        title: s.title,
        weight: s.weight,
        dueDate: s.dueDate,
        _action: "upsert",
      }))
    );
    setErr(null);
    setSaving(false);
  }, [open, objective]);

  function validate(): string | null {
    if (!local) return "Aucun objectif chargé.";
    if (!local.title.trim()) return "Le titre est requis.";
    const startMs = new Date(`${local.startDate}T00:00:00`).getTime();
    const endMs = new Date(`${local.endDate}T00:00:00`).getTime();
    if (endMs < startMs) return "La date de fin ne peut pas précéder la date de début.";
    const kept = rows.filter((r) => r._action !== "delete");
    if (kept.length && kept.some((t) => !t.title.trim())) return "Chaque sous-objectif doit avoir un titre.";
    const sum = kept.reduce((s, t) => s + (Number(t.weight) || 0), 0);
    if (kept.length && sum > 0 && Math.abs(sum - 100) > 0.001) return "La somme des poids doit faire 100%.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }
    if (!local) return;
    setSaving(true);
    try {
      const payload = {
        title: local.title.trim(),
        description: local.description ?? null,
        unit: local.unit,
        target: Number(local.target || 0),
        startDate: local.startDate,
        endDate: local.endDate,
        subtasks: rows,
      };
      const r = await fetchJSON<{ item: ObjectiveAPI }>(`/api/objectives/${local.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const updated: Objective = normalize(r.item);
      onSaved(updated);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur d’enregistrement");
      setSaving(false);
    }
  }

  // normalizer local (copié depuis parent)
  function normalize(o: ObjectiveAPI): Objective {
    return {
      id: Number(o.id),
      userId: Number(o.userId ?? o.user_id ?? o.owner_id ?? 0),
      owner: String(o.owner ?? o.owner_name ?? ""),
      title: String(o.title ?? ""),
      description: o.description ?? null,
      unit: String(o.unit ?? "%"),
      target: Number(o.target ?? 100),
      current: Number(o.current ?? 0),
      startDate: String(o.startDate ?? o.start_date ?? todayStr()),
      endDate: String(o.endDate ?? o.end_date ?? todayStr()),
      status: (o.status as ObjStatus) ?? "todo",
      priority: (o.priority as Priority) ?? "low",
      created_at: String(o.created_at ?? new Date().toISOString()),
      updated_at: String(o.updated_at ?? new Date().toISOString()),
      subtasks: Array.isArray(o.subtasks)
        ? o.subtasks.map((s) => ({
            id: Number(s.id),
            objective_id: Number(s.objective_id ?? o.id ?? 0),
            title: String(s.title ?? ""),
            weight: Number(s.weight ?? 0),
            dueDate: s.dueDate ?? s.due_date ?? null,
            done: s.done ? 1 : 0,
          }))
        : [],
    };
  }

  // UI
  return (
    <Modal open={open} onClose={onClose} title="Modifier l’objectif" size="lg">
      {!local ? (
        <div className="text-sm text-slate-600">Chargement…</div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {err && (
            <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
              <AlertCircle className="w-4 h-4" /> {err}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Titre</div>
              <input
                value={local.title}
                onChange={(e) => setLocal({ ...local, title: e.target.value })}
                className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Unité</div>
              <input
                value={local.unit}
                onChange={(e) => setLocal({ ...local, unit: e.target.value })}
                className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Cible</div>
              <input
                type="number"
                min={0}
                value={local.target}
                onChange={(e) => setLocal({ ...local, target: Number(e.target.value) || 0 })}
                className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Date de début</div>
              <input
                type="date"
                value={local.startDate}
                min={todayStr()}
                onChange={(e) => {
                  const sd = e.target.value;
                  setLocal((prev) => {
                    if (!prev) return prev;
                    const endOK = new Date(`${prev.endDate}T00:00:00`).getTime() >= new Date(`${sd}T00:00:00`).getTime();
                    return { ...prev, startDate: sd, endDate: endOK ? prev.endDate : sd };
                  });
                }}
                className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
            <div>
              <div className="text-[12px] text-slate-600 mb-1">Date de fin</div>
              <input
                type="date"
                value={local.endDate}
                min={local.startDate}
                onChange={(e) => setLocal({ ...local, endDate: e.target.value })}
                className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-[12px] text-slate-600 mb-1">Description</div>
              <textarea
                value={local.description ?? ""}
                onChange={(e) => setLocal({ ...local, description: e.target.value })}
                className="w-full min-h-[80px] px-3 py-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
          </div>

          {/* Sous-objectifs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] text-slate-600">Sous-objectifs (100%)</div>
              <button
                type="button"
                onClick={() => setRows((p) => [...p, { title: "", weight: 0, dueDate: null, _action: "upsert" }])}
                className="inline-flex items-center gap-1 px-3 h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Ajouter</span>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
              {rows.map((r, i) => (
                <div key={i} className={cls("col-span-12 grid grid-cols-12 gap-2", r._action === "delete" && "opacity-50")}>
                  <input
                    className="col-span-6 h-9 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    placeholder={`Sous-objectif #${i + 1}`}
                    value={r.title}
                    onChange={(e) =>
                      setRows((p) => p.map((x, j) => (j === i ? { ...x, title: e.target.value, _action: "upsert" } : x)))
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="col-span-2 h-9 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    placeholder="Poids %"
                    value={r.weight ?? 0}
                    onChange={(e) =>
                      setRows((p) => p.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) || 0, _action: "upsert" } : x)))
                    }
                  />
                  <input
                    type="date"
                    className="col-span-3 h-9 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    value={r.dueDate || ""}
                    onChange={(e) =>
                      setRows((p) => p.map((x, j) => (j === i ? { ...x, dueDate: e.target.value, _action: "upsert" } : x)))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setRows((p) => p.map((x, j) => (j === i ? { ...x, _action: "delete" } : x)))}
                    className="col-span-1 inline-flex items-center justify-center rounded-lg ring-1 ring-slate-200 hover:bg-slate-50"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="w-4 h-4 text-slate-600" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm">
              Annuler
            </button>
            <button
              disabled={saving}
              className={cls(
                "px-4 h-9 rounded-lg text-white text-sm inline-flex items-center gap-2",
                saving ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
              )}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
