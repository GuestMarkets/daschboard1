// app/user/tasks/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Shell from "@/app/components/Shell";
import {
  AlertCircle, Search, Calendar as CalendarIcon, Clock, Repeat, Plus, Trash2,
  CheckCircle2, XCircle, AlertTriangle, ListChecks, CalendarDays, TrendingUp
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* =================== Types =================== */
type Status = "todo" | "in_progress" | "blocked" | "done";
type Priority = "low" | "medium" | "high";
type RecurrenceFreq = "NONE" | "WEEKLY" | "MONTHLY";

type Task = {
  id: number;
  title: string;
  description: string | null;
  due_date: string;        // YYYY-MM-DD
  due_time: string | null; // HH:MM (ou null)
  status: Status;
  progress: number;
  performance: number;
  priority: Priority;      // stockée
  is_recurrent: boolean;
  recurrence_pattern: string | null;
  created_by: number;
  created_at: string;      // ISO
  updated_at: string;      // ISO
  assignees: { id:number; name:string; email:string }[];
  assigneeIds: number[];
};

type Subtask = { id:number; task_id:number; title:string; description:string|null; done:0|1; created_at:string };

/* =================== Helpers =================== */
const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");
const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "Une erreur inconnue est survenue.";
  }
}

async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { credentials: "include", ...init, headers });
  const raw = await res.text();
  const data: unknown = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    const maybeErr = (data as { error?: unknown })?.error;
    const message = typeof maybeErr === "string" ? maybeErr : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

function withinBusinessHours(time: string) {
  // 07:30 → 19:00
  const [h, m] = time.split(":").map(Number);
  const min = 7 * 60 + 30, max = 19 * 60;
  const val = h * 60 + m;
  return val >= min && val <= max;
}
function combineDateTime(date: string, time?: string | null): Date {
  if (time && /^\d{2}:\d{2}$/.test(time)) return new Date(`${date}T${time}:00`);
  return new Date(`${date}T00:00:00`);
}
function formatDateTimeHuman(date: string, time?: string | null) {
  const d = combineDateTime(date, time);
  const ok = !Number.isNaN(d.getTime());
  const datePart = ok ? d.toLocaleDateString() : "—";
  if (time && /^\d{2}:\d{2}$/.test(time)) return `${datePart} à ${time}`;
  return datePart;
}

/* ====== Priorité auto selon heures écoulées ======
   - À 50% du temps (création → échéance) :
     low → medium, medium → high
   - À 70% :
     medium → high
   Toujours en escalade (jamais en baisse). */
function computeAutoPriority(base: Priority, createdAtISO: string, dueDate: string, dueTime?: string | null, now = new Date()): Priority {
  const start = new Date(createdAtISO);
  const end = combineDateTime(dueDate, dueTime || undefined);
  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = Math.max(0, now.getTime() - start.getTime());
  if (totalMs <= 0) return "high"; // échéance dépassée → haute
  const pct = (elapsedMs / totalMs) * 100;

  let escalated: Priority = base;
  if (pct >= 70) {
    if (escalated === "medium") escalated = "high";
  } else if (pct >= 50) {
    if (escalated === "low") escalated = "medium";
    else if (escalated === "medium") escalated = "high";
  }
  return escalated;
}

/* ============ Garde-types pour les selects (évite any) ============ */
function isStatus(val: string): val is Status {
  return val === "todo" || val === "in_progress" || val === "blocked" || val === "done";
}
function isPriority(val: string): val is Priority {
  return val === "low" || val === "medium" || val === "high";
}
type SortKey = "priority" | "date" | "name" | "progress";
function isSortKey(val: string): val is SortKey {
  return val === "priority" || val === "date" || val === "name" || val === "progress";
}

/* =================== Page =================== */
export default function MyTasksPage() {
  // Profil
  const [currentUserId, setCurrentUserId] = useState<number|null>(null);
  const [departmentId, setDepartmentId] = useState<number|null>(null);

  // Données
  const [items, setItems] = useState<Task[]>([]);
  const [sel, setSel] = useState<Task|null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);

  // UI
  const [err, setErr] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);

  // Filtres
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all"|Status>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all"|Priority>("all");
  const [sort, setSort] = useState<SortKey>("priority");

  // Handlers typés pour éviter any
  const onStatusFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setStatusFilter(v === "all" ? "all" : (isStatus(v) ? v : "all"));
  };
  const onPriorityFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setPriorityFilter(v === "all" ? "all" : (isPriority(v) ? v : "all"));
  };
  const onSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setSort(isSortKey(v) ? v : "priority");
  };

  // Form création (assigné automatiquement à l’utilisateur connecté)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(todayStr());
  const [dueTime, setDueTime] = useState("");
  const [isRecurrent, setIsRecurrent] = useState(false);
  const [freq, setFreq] = useState<RecurrenceFreq>("NONE");
  const [interval, setInterval] = useState(1);
  const [count, setCount] = useState(4);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string|null>(null);

  /* --------- Profil --------- */
  useEffect(() => {
    (async () => {
      try {
        const me = await fetchJSON<{ ok:boolean; user?:{ id:number } }>(`/api/me`);
        if (!me.ok || !me.user) throw new Error("Non authentifié");
        const prof = await fetchJSON<{ department_id:number|null }>(`/api/me/profile`);
        setCurrentUserId(me.user.id);
        setDepartmentId(prof.department_id ?? null);
      } catch (e: unknown) {
        setErr(getErrorMessage(e) || "Erreur lors du chargement du profil.");
      }
    })();
  }, []);

  /* --------- Chargement des tâches (uniquement celles assignées à l'utilisateur) --------- */
  useEffect(() => {
    if (!currentUserId) return;
    (async () => {
      try {
        setLoading(true);

        // 1) Tentative endpoint dédié si présent
        let raw: { items?: Task[] } = { items: [] };
        try {
          raw = await fetchJSON<{ items: Task[] }>(`/api/my/tasks`);
        } catch {
          // 2) Fallback : chercher toutes puis filtrer client-side (assigneeIds contient currentUserId)
          const probe = await fetchJSON<{ items: Task[] }>(`/api/admin/department/tasks${departmentId ? `?department_id=${departmentId}` : ""}`);
          const filtered = (probe.items || []).filter((t) =>
            Array.isArray(t.assigneeIds) && t.assigneeIds.map(Number).includes(currentUserId)
          );
          raw = { items: filtered };
        }

        const arr = (raw.items || []).map(normalizeTask);
        setItems(arr);
        setSel(arr[0] ?? null);
        setErr(null);
      } catch (e: unknown) {
        setErr(getErrorMessage(e) || "Erreur lors du chargement des tâches.");
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUserId, departmentId]);

  /* --------- Charger les sous-tâches de la sélection --------- */
  const selId = sel?.id ?? null;
  useEffect(() => {
    (async () => {
      if (!selId) { setSubtasks([]); return; }
      try {
        const data = await fetchJSON<{ items: Subtask[] }>(`/api/admin/department/tasks/${selId}/subtasks`);
        setSubtasks(data.items || []);
      } catch {
        setSubtasks([]);
      }
    })();
  }, [selId]);

  /* --------- Normalisation robuste --------- */
  function normalizeTask(t: Partial<Task>): Task {
    return {
      id: Number(t.id),
      title: String(t.title || ""),
      description: t.description ?? null,
      due_date: String(t.due_date || todayStr()),
      due_time: t.due_time ? String(t.due_time) : null,
      status: (t.status as Status) || "todo",
      progress: Number(t.progress ?? 0),
      performance: Number(t.performance ?? 0),
      priority: (t.priority as Priority) || "low",
      is_recurrent: !!t.is_recurrent,
      recurrence_pattern: t.recurrence_pattern ?? null,
      created_by: Number(t.created_by ?? 0),
      created_at: String(t.created_at ?? new Date().toISOString()),
      updated_at: String(t.updated_at ?? new Date().toISOString()),
      assignees: Array.isArray(t.assignees) ? t.assignees : [],
      assigneeIds: Array.isArray(t.assigneeIds) ? t.assigneeIds.map(Number) : [],
    };
  }

  /* --------- Priorité affichée = escalade auto --------- */
  function getDisplayPriority(t: Task): Priority {
    return computeAutoPriority(t.priority, t.created_at, t.due_date, t.due_time || undefined);
  }

  /* --------- KPIs --------- */
  const kpis: { id:string; title:string; value:number; gradient:string; icon: LucideIcon }[] = useMemo(() => {
    const now = new Date();
    const total = items.length;
    const done = items.filter(t => t.status === "done").length;
    const blocked = items.filter(t => t.status === "blocked").length;
    const todayCount = items.filter(t => {
      const d = combineDateTime(t.due_date, t.due_time);
      return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth() && d.getDate()===now.getDate();
    }).length;
    const overdue = items.filter(t => {
      const d = combineDateTime(t.due_date, t.due_time);
      return t.status !== "done" && d.getTime() < now.getTime();
    }).length;
    const next7 = items.filter(t => {
      const d = combineDateTime(t.due_date, t.due_time).getTime();
      const in7 = now.getTime() + 7*24*3600*1000;
      return d >= now.getTime() && d <= in7;
    }).length;

    return [
      { id:"k1", title:"Mes tâches", value: total, gradient:"from-indigo-500 to-purple-500", icon: ListChecks },
      { id:"k2", title:"En retard", value: overdue, gradient:"from-rose-500 to-orange-500", icon: AlertTriangle },
      { id:"k3", title:"Aujourd’hui", value: todayCount, gradient:"from-sky-500 to-blue-500", icon: CalendarDays },
      { id:"k4", title:"Débloquée", value: blocked, gradient:"from-amber-500 to-rose-500", icon: XCircle },
      { id:"k5", title:"Terminées", value: done, gradient:"from-emerald-500 to-teal-500", icon: CheckCircle2 },
      { id:"k6", title:"À venir (7 j)", value: next7, gradient:"from-fuchsia-500 to-pink-500", icon: TrendingUp },
    ];
  }, [items]);

  /* --------- Liste dérivée + tri + filtres --------- */
  const list = useMemo(() => {
    let arr = items.slice();
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter(
        (t) =>
          t.title.toLowerCase().includes(s) ||
          (t.description ?? "").toLowerCase().includes(s)
      );
    }
    if (statusFilter !== "all") arr = arr.filter((t) => t.status === statusFilter);
    if (priorityFilter !== "all") arr = arr.filter((t) => getDisplayPriority(t) === priorityFilter);

    arr.sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title);
      if (sort === "progress") return b.progress - a.progress;
      if (sort === "date") {
        const aDT = combineDateTime(a.due_date, a.due_time).getTime();
        const bDT = combineDateTime(b.due_date, b.due_time).getTime();
        return aDT - bDT;
      }
      // priority
      const pa = getDisplayPriority(a);
      const pb = getDisplayPriority(b);
      const order = { high:3, medium:2, low:1 } as Record<Priority, number>;
      const ap = order[pa] || 0, bp = order[pb] || 0;
      if (ap !== bp) return bp - ap;
      return combineDateTime(a.due_date, a.due_time).getTime() - combineDateTime(b.due_date, b.due_time).getTime();
    });
    return arr;
  }, [items, q, statusFilter, priorityFilter, sort]);

  /* --------- Validation création --------- */
  function validateCreate(): string|null {
    if (!title.trim()) return "Le titre est requis.";
    if (!dueDate) return "La date d’échéance est requise.";
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(dueDate); d.setHours(0,0,0,0);
    if (d.getTime() < today.getTime()) return "L’échéance ne peut pas être dans le passé.";
    if (dueTime) {
      if (!withinBusinessHours(dueTime)) return "Choisis une heure entre 07:30 et 19:00.";
      const dt = combineDateTime(dueDate, dueTime);
      if (d.getTime() === today.getTime() && dt.getTime() < Date.now()) return "Impossible de programmer avant l’heure actuelle.";
    }
    if (isRecurrent && freq !== "NONE") {
      if (interval < 1) return "L’intervalle de récurrence doit être au moins 1.";
      if (count < 1) return "Le nombre d’occurrences doit être au moins 1.";
    }
    if (!currentUserId) return "Utilisateur non identifié.";
    return null;
  }

  /* --------- Création --------- */
  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    const v = validateCreate();
    if (v) { setFormErr(v); return; }
    if (!currentUserId) return;

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate,
        due_time: dueTime || null,
        assigneeIds: [currentUserId],
        is_recurrent: isRecurrent && freq !== "NONE",
        recurrence: isRecurrent && freq !== "NONE" ? { frequency: freq, interval, count } : { frequency: "NONE" },
        created_by: currentUserId,
        department_id: departmentId ?? undefined,
      };

      // Endpoint création (priorité au scope “my” si dispo)
      let out: { item: Task } | null = null;
      try {
        out = await fetchJSON<{ item: Task }>(`/api/my/tasks`, { method: "POST", body: JSON.stringify(payload) });
      } catch {
        out = await fetchJSON<{ item: Task }>(`/api/admin/department/tasks`, { method: "POST", body: JSON.stringify(payload) });
      }
      const newTask = normalizeTask(out!.item);

      // Garder uniquement si elle m’est bien assignée
      if (!newTask.assigneeIds.includes(currentUserId)) {
        newTask.assigneeIds = [currentUserId];
      }

      setItems((prev) => [newTask, ...prev]);
      setSel(newTask);
      // reset form
      setTitle(""); setDescription(""); setDueDate(todayStr()); setDueTime("");
      setIsRecurrent(false); setFreq("NONE"); setInterval(1); setCount(4);
    } catch (e: unknown) {
      setFormErr(getErrorMessage(e) || "Erreur lors de la création.");
    } finally {
      setSaving(false);
    }
  }

  /* --------- Mise à jour --------- */
  async function updateTask(patch: Partial<Task> & { id:number }) {
    if (!currentUserId) return;
    try {
      // Force l’affectation à moi
      const payload = { ...patch, assigneeIds: [currentUserId], department_id: departmentId ?? undefined };
      let out: { item: Task } | null = null;
      try {
        out = await fetchJSON<{ item: Task }>(`/api/my/tasks/${patch.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } catch {
        out = await fetchJSON<{ item: Task }>(`/api/admin/department/tasks/${patch.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      const updated = normalizeTask(out!.item);
      setItems(arr => arr.map(x => x.id === patch.id ? updated : x));
      if (sel?.id === patch.id) setSel(updated);
    } catch (e: unknown) {
      setErr(getErrorMessage(e) || "Erreur lors de la mise à jour.");
    }
  }

  /* --------- Suppression --------- */
  async function removeTask(id:number) {
    try {
      try {
        await fetchJSON(`/api/my/tasks/${id}`, { method: "DELETE" });
      } catch {
        await fetchJSON(`/api/admin/department/tasks/${id}`, { method: "DELETE" });
      }
      setItems(p => p.filter(t => t.id !== id));
      if (sel?.id === id) setSel(null);
    } catch (e: unknown) {
      setErr(getErrorMessage(e) || "Erreur lors de la suppression.");
    }
  }

  /* --------- Sous-tâches --------- */
  const [stTitle, setStTitle] = useState("");
  const [stDesc, setStDesc] = useState("");

  async function addSubtask() {
    if (!sel || !stTitle.trim()) return;
    try {
      const r = await fetchJSON<{ item: Subtask }>(`/api/admin/department/tasks/${sel.id}/subtasks`, {
        method: "POST", body: JSON.stringify({ title: stTitle.trim(), description: stDesc.trim() || null })
      });
      setSubtasks(prev => [r.item, ...prev]);
      setStTitle(""); setStDesc("");
    } catch (e: unknown) {
      setErr(getErrorMessage(e) || "Erreur lors de l'ajout de la sous-tâche.");
    }
  }
  async function toggleSubtask(s: Subtask) {
    if (!sel) return;
    try {
      const r = await fetchJSON<{ item: Subtask }>(`/api/admin/department/tasks/${sel.id}/subtasks/${s.id}`, {
        method: "PATCH", body: JSON.stringify({ done: !s.done })
      });
      setSubtasks(prev => prev.map(x => x.id === s.id ? r.item : x));
    } catch (e: unknown) {
      setErr(getErrorMessage(e) || "Erreur lors de la mise à jour de la sous-tâche.");
    }
  }
  async function removeSubtask(s: Subtask) {
    if (!sel) return;
    try {
      await fetchJSON(`/api/admin/department/tasks/${sel.id}/subtasks/${s.id}`, { method: "DELETE" });
      setSubtasks(prev => prev.filter(x => x.id !== s.id));
    } catch (e: unknown) {
      setErr(getErrorMessage(e) || "Erreur lors de la suppression de la sous-tâche.");
    }
  }

  /* =================== UI =================== */
  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Mes tâches">
      {/* Fond doux */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -left-16 w-80 h-80 rounded-full blur-3xl opacity-40" style={{ backgroundColor: "#c7d2fe" }} />
        <div className="absolute top-64 -right-10 w-96 h-96 rounded-full blur-3xl opacity-40" style={{ backgroundColor: "#fbcfe8" }} />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {err && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          <AlertCircle className="w-4 h-4" />{err}
        </div>}

        {/* Récapitulatif (KPI colorés) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {kpis.map(k => {
            const Icon = k.icon;
            return (
              <div key={k.id} className="rounded-2xl overflow-hidden">
                <div className={cls("p-4 text-white bg-gradient-to-br", k.gradient, "transition")}>
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

        {/* Création (assignée d’office à l’utilisateur connecté) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm md:text-base font-semibold text-slate-900 mb-2">Créer une tâche</h2>
          {formErr && <div className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-1.5">{formErr}</div>}

          <form onSubmit={createTask} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-2.5">
              <div className="md:col-span-3">
                <label className="block text-[11px] text-slate-600 mb-1">Titre</label>
                <input
                  value={title} onChange={(e)=> setTitle(e.target.value)}
                  className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  placeholder="Ex. Préparer le rapport hebdo"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] text-slate-600 mb-1 flex items-center gap-1">
                  <CalendarIcon className="w-3.5 h-3.5" /> Échéance
                </label>
                <input
                  type="date" value={dueDate} min={todayStr()}
                  onChange={(e)=> setDueDate(e.target.value)}
                  className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] text-slate-600 mb-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Heure (07:30 → 19:00)
                </label>
                <input
                  type="time" value={dueTime} min="07:30" max="19:00" step={60}
                  onChange={(e)=> setDueTime(e.target.value)}
                  className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-[11px] text-slate-600 mb-1 flex items-center gap-1">
                  <Repeat className="w-3.5 h-3.5" /> Récurrence (comme Google Agenda)
                </label>
                <div className="rounded-lg ring-1 ring-slate-200 p-2 grid grid-cols-1 sm:grid-cols-5 gap-2">
                  <label className="flex items-center gap-2 sm:col-span-1">
                    <input type="checkbox" className="accent-blue-600 scale-110"
                           checked={isRecurrent} onChange={(e)=> setIsRecurrent(e.target.checked)} />
                    <span className="text-sm">Récurrente</span>
                  </label>
                  <select
                    disabled={!isRecurrent}
                    value={freq} onChange={(e)=> setFreq(e.target.value as RecurrenceFreq)}
                    className="h-9 px-2 rounded-md ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white sm:col-span-1"
                  >
                    <option value="NONE">— Aucune —</option>
                    <option value="WEEKLY">Hebdomadaire</option>
                    <option value="MONTHLY">Mensuelle</option>
                  </select>
                  <div className="sm:col-span-1">
                    <div className="text-[11px] text-slate-500">Intervalle</div>
                    <input
                      type="number" min={1} value={interval}
                      disabled={!isRecurrent || freq==="NONE"}
                      onChange={(e)=> setInterval(Math.max(1, Number(e.target.value)||1))}
                      className="h-9 w-full px-2 rounded-md ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <div className="text-[11px] text-slate-500">Occurrences</div>
                    <input
                      type="number" min={1} value={count}
                      disabled={!isRecurrent || freq==="NONE"}
                      onChange={(e)=> setCount(Math.max(1, Number(e.target.value)||1))}
                      className="h-9 w-full px-2 rounded-md ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div className="sm:col-span-1 text-[12px] text-slate-600 self-center">
                    {isRecurrent && freq!=="NONE"
                      ? <>FREQ <b>{freq}</b> • INTERVALLE <b>{interval}</b> • NBR <b>{count}</b></>
                      : <>Pas de récurrence</>}
                  </div>
                </div>
              </div>

              <div className="md:col-span-6">
                <label className="block text-[11px] text-slate-600 mb-1">Description</label>
                <textarea
                  value={description} onChange={(e)=> setDescription(e.target.value)}
                  className="w-full min-h-[70px] px-3 py-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  placeholder="Détails…"
                />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                disabled={saving || !currentUserId}
                className={cls("h-9 px-4 rounded-lg text-white text-sm flex items-center gap-2",
                  saving ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700")}
              >
                <Plus className="w-4 h-4" />
                {saving ? "Création…" : "Créer la tâche"}
              </button>
            </div>
          </form>
        </section>

        {/* Filtres */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q} onChange={(e)=> setQ(e.target.value)}
                placeholder="Rechercher…"
                className="w-full h-9 pl-7 pr-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <select
              value={statusFilter} onChange={onStatusFilterChange}
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 bg-white outline-none"
            >
              <option value="all">Tous statuts</option>
              <option value="todo">À faire</option>
              <option value="in_progress">En cours</option>
              <option value="blocked">Débloquée</option>
              <option value="done">Terminées</option>
            </select>
            <select
              value={priorityFilter} onChange={onPriorityFilterChange}
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 bg-white outline-none"
            >
              <option value="all">Toutes priorités</option>
              <option value="high">Haute</option>
              <option value="medium">Moyenne</option>
              <option value="low">Basse</option>
            </select>
            <select
              value={sort} onChange={onSortChange}
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 bg-white outline-none"
            >
              <option value="priority">Tri par priorité</option>
              <option value="date">Tri par date</option>
              <option value="name">Tri par nom</option>
              <option value="progress">Tri par progression</option>
            </select>
            <div />
          </div>
        </section>

        {/* Liste + Détails */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Liste */}
          <section className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2 mb-2">
              <ListChecks className="w-4 h-4 text-blue-700" />
              <h2 className="text-sm md:text-base font-semibold text-slate-900">Mes tâches</h2>
            </div>
            {loading && <div className="text-slate-500 text-sm">Chargement…</div>}
            {!loading && list.length === 0 && <div className="text-slate-500 text-sm">Aucune tâche.</div>}

            <div className="divide-y divide-slate-100">
              {list.map(t => {
                const active = sel?.id === t.id;

                const statusText =
                  t.status === "todo" ? "À faire" :
                  t.status === "in_progress" ? "En cours" :
                  t.status === "blocked" ? "Débloquée" : "Terminée";

                const statusBadge =
                  t.status === "done" ? "bg-green-100 text-green-700"
                  : t.status === "blocked" ? "bg-amber-100 text-amber-700"
                  : t.status === "in_progress" ? "bg-blue-100 text-blue-700"
                  : "bg-slate-100 text-slate-700";

                const dispPr = getDisplayPriority(t);
                const prBadge =
                  dispPr === "high" ? "bg-red-100 text-red-700"
                  : dispPr === "medium" ? "bg-orange-100 text-orange-700"
                  : "bg-green-100 text-green-700";

                return (
                  <div key={t.id} className={cls("py-3 px-3 rounded-xl hover:bg-slate-50 transition-colors", active && "bg-blue-50 ring-1 ring-blue-200")}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <h3 className="font-medium text-slate-900 truncate">{t.title}</h3>
                          <div className="flex flex-wrap items-center gap-1 shrink-0">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                              {formatDateTimeHuman(t.due_date, t.due_time)}
                            </span>
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${prBadge}`}>
                              Priorité {dispPr === "high" ? "Haute" : dispPr === "medium" ? "Moyenne" : "Basse"}
                            </span>
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusBadge}`}>
                              {statusText}
                            </span>
                          </div>
                        </div>
                        {t.description && <p className="mt-1 text-sm text-slate-600 line-clamp-2">{t.description}</p>}
                        <div className="text-[12px] text-slate-500 mt-1">
                          Progression : {t.progress}% • Performance : {t.performance}%
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSel(t)}
                          className={cls("h-8 px-3 rounded-lg text-[12.5px] ring-1 transition-colors",
                            active ? "bg-blue-600 text-white ring-blue-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50")}
                        >Détails</button>
                        <button
                          onClick={() => updateTask({ id: t.id, status: "done", progress: 100, performance: 100 })}
                          disabled={t.status === "done"}
                          className={cls("h-8 px-3 rounded-lg text-[12.5px] inline-flex items-center gap-1 transition-colors",
                            t.status === "done" ? "bg-slate-400 cursor-not-allowed text-white" : "bg-green-600 hover:bg-green-700 text-white")}
                        >
                          <CheckCircle2 className="w-3 h-3" /> Terminer
                        </button>
                        <button
                          onClick={() => removeTask(t.id)}
                          className="h-8 px-2 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100 transition-colors"
                          title="Supprimer"
                        ><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Détails (même logique que le haut : pas d’assignation, récurrence incluse) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-3">
            <h2 className="text-sm md:text-base font-semibold text-slate-900 mb-2">Détails</h2>
            {!sel ? (
              <div className="text-slate-500 text-sm">Sélectionnez une tâche.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-slate-600 mb-1">Titre</div>
                    <input
                      value={sel.title}
                      onChange={(e)=> setSel({ ...sel, title: e.target.value })}
                      className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 mb-1">Échéance</div>
                    <input
                      type="date" value={sel.due_date} min={todayStr()}
                      onChange={(e)=> setSel({ ...sel, due_date: e.target.value })}
                      className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 mb-1">Heure (07:30 → 19:00)</div>
                    <input
                      type="time" value={sel.due_time || ""} min="07:30" max="19:00" step={60}
                      onChange={(e)=> setSel({ ...sel, due_time: e.target.value || null })}
                      className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 mb-1">Progression (%)</div>
                    <input
                      type="number" min={0} max={100} value={sel.progress}
                      onChange={(e)=> setSel({ ...sel, progress: Math.max(0, Math.min(100, Number(e.target.value)||0)) })}
                      className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 mb-1">Performance (%)</div>
                    <input
                      type="number" min={0} max={100} value={sel.performance}
                      onChange={(e)=> setSel({ ...sel, performance: Math.max(0, Math.min(100, Number(e.target.value)||0)) })}
                      className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-600 mb-1">
                      Priorité (affichée : automatique selon l’échéance)
                    </div>
                    <select
                      value={sel.priority} onChange={(e)=> setSel({ ...sel, priority: e.target.value as Priority })}
                      className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
                    >
                      <option value="low">Basse</option>
                      <option value="medium">Moyenne</option>
                      <option value="high">Haute</option>
                    </select>
                    <div className="text-[12px] text-slate-500 mt-1">
                      Priorité auto actuelle : <b>
                        {(() => {
                          const p = getDisplayPriority(sel);
                          return p === "high" ? "Haute" : p === "medium" ? "Moyenne" : "Basse";
                        })()}
                      </b>
                    </div>
                  </div>

                  {/* Récurrence — même UI que haut */}
                  <RecurrenceEditor
                    value={{ is_recurrent: sel.is_recurrent, pattern: sel.recurrence_pattern }}
                    onChange={(next) => {
                      setSel({
                        ...sel,
                        is_recurrent: next.is_recurrent,
                        recurrence_pattern: next.recurrence_pattern,
                      });
                    }}
                  />

                  <div className="md:col-span-2">
                    <div className="text-[11px] text-slate-600 mb-1">Description</div>
                    <textarea
                      value={sel.description ?? ""} onChange={(e)=> setSel({ ...sel, description: e.target.value })}
                      className="w-full min-h-[80px] px-3 py-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>
                </div>

                {/* Statuts */}
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { code:"todo" as Status, label:"À faire", Icon: Clock as LucideIcon },
                    { code:"in_progress" as Status, label:"En cours", Icon: AlertTriangle as LucideIcon },
                    { code:"blocked" as Status, label:"Bloquée", Icon: XCircle as LucideIcon },
                    { code:"done" as Status, label:"Terminée", Icon: CheckCircle2 as LucideIcon },
                  ]).map(({code, label, Icon}) => {
                    const active = sel.status === code;
                    const base = code==="done" ? "bg-green-100 text-green-700 ring-green-300 hover:bg-green-200"
                              : code==="blocked" ? "bg-amber-100 text-amber-700 ring-amber-300 hover:bg-amber-200"
                              : code==="in_progress" ? "bg-blue-100 text-blue-700 ring-blue-300 hover:bg-blue-200"
                              : "bg-slate-100 text-slate-700 ring-slate-300 hover:bg-slate-200";
                    const activeC = code==="done" ? "bg-green-600 text-white ring-green-600"
                                 : code==="blocked" ? "bg-amber-600 text-white ring-amber-600"
                                 : code==="in_progress" ? "bg-blue-600 text-white ring-blue-600"
                                 : "bg-slate-600 text-white ring-slate-600";
                    const disabled = sel.status === "done" && code !== "done";
                    return (
                      <button
                        key={code}
                        disabled={disabled}
                        onClick={()=> updateTask({ ...sel, status: code })}
                        className={cls("px-3 py-2.5 rounded-lg text-sm font-medium ring-1 transition-all flex items-center gap-2 justify-center",
                          disabled ? "opacity-50 cursor-not-allowed bg-slate-50 text-slate-400 ring-slate-200" : active ? activeC : base)}
                      >
                        <Icon className="w-4 h-4" /><span className="hidden sm:inline">{label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={()=> updateTask(sel)}
                    className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
                  >Enregistrer</button>
                </div>

                {/* Sous-tâches */}
                <div className="pt-3 border-t border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-900 mb-1">Sous-tâches ({subtasks.length})</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {subtasks.map(s => (
                      <div key={s.id} className="p-2 rounded-lg ring-1 ring-slate-200 hover:ring-slate-300 transition-colors">
                        <label className="flex items-start gap-3">
                          <input type="checkbox" className="mt-1 accent-blue-600 scale-110"
                                 checked={!!s.done} onChange={()=> toggleSubtask(s)} />
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm break-words font-medium ${s.done ? "line-through text-slate-400" : "text-slate-800"}`}>
                              {s.title}
                            </div>
                            {s.description && <div className={`text-xs mt-1 ${s.done ? "text-slate-400" : "text-slate-600"}`}>{s.description}</div>}
                            <button onClick={()=> removeSubtask(s)} className="text-xs text-red-600 hover:text-red-700 mt-2 font-medium">
                              Supprimer
                            </button>
                          </div>
                        </label>
                      </div>
                    ))}
                    {subtasks.length === 0 && (
                      <div className="text-sm text-slate-500 text-center py-4 border border-dashed border-slate-200 rounded-lg">
                        Aucune sous-tâche
                      </div>
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-5 gap-2">
                    <input
                      value={stTitle} onChange={(e)=> setStTitle(e.target.value)}
                      placeholder="Titre…" className="h-9 sm:col-span-2 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                    <input
                      value={stDesc} onChange={(e)=> setStDesc(e.target.value)}
                      placeholder="Description (facultatif)…"
                      className="h-9 sm:col-span-2 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                    <button
                      onClick={addSubtask}
                      className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm flex items-center justify-center gap-1"
                    >
                      <Plus className="w-4 h-4" /> Ajouter
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </Shell>
  );
}

/* ============== Éditeur de récurrence (détails) ============== */
function RecurrenceEditor({
  value,
  onChange,
}: {
  value: { is_recurrent: boolean; pattern: string | null };
  onChange: (v: { is_recurrent: boolean; recurrence_pattern: string | null }) => void;
}) {
  const [enabled, setEnabled] = useState<boolean>(value.is_recurrent);
  const [freq, setFreq] = useState<RecurrenceFreq>("NONE");
  const [interval, setInterval] = useState(1);
  const [count, setCount] = useState(4);

  useEffect(() => {
    setEnabled(value.is_recurrent);
  }, [value.is_recurrent]);

  useEffect(() => {
    // Ici on génère juste un résumé friendly ; côté API, ta logique buildRRule sera appliquée.
    if (!enabled || freq === "NONE") {
      onChange({ is_recurrent: false, recurrence_pattern: null });
    } else {
      // Petite string indicative (pas d’impact serveur si ton API reconstruit la RRULE)
      onChange({
        is_recurrent: true,
        recurrence_pattern: `FREQ=${freq};INTERVAL=${interval};COUNT=${count}`,
      });
    }
  }, [enabled, freq, interval, count, onChange]);

  return (
    <div className="md:col-span-2">
      <div className="text-[11px] text-slate-600 mb-1 flex items-center gap-1">
        <Repeat className="w-3.5 h-3.5" /> Récurrence
      </div>
      <div className="rounded-lg ring-1 ring-slate-200 p-2 grid grid-cols-1 sm:grid-cols-5 gap-2">
        <label className="flex items-center gap-2 sm:col-span-1">
          <input
            type="checkbox" className="accent-blue-600 scale-110"
            checked={enabled} onChange={(e)=> setEnabled(e.target.checked)}
          />
          <span className="text-sm">Récurrente</span>
        </label>
        <select
          disabled={!enabled}
          value={freq} onChange={(e)=> setFreq(e.target.value as RecurrenceFreq)}
          className="h-9 px-2 rounded-md ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white sm:col-span-1"
        >
          <option value="NONE">— Aucune —</option>
          <option value="WEEKLY">Hebdomadaire</option>
          <option value="MONTHLY">Mensuelle</option>
        </select>
        <div className="sm:col-span-1">
          <div className="text-[11px] text-slate-500">Intervalle</div>
          <input
            type="number" min={1} value={interval}
            disabled={!enabled || freq==="NONE"}
            onChange={(e)=> setInterval(Math.max(1, Number(e.target.value)||1))}
            className="h-9 w-full px-2 rounded-md ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
        </div>
        <div className="sm:col-span-1">
          <div className="text-[11px] text-slate-500">Occurrences</div>
          <input
            type="number" min={1} value={count}
            disabled={!enabled || freq==="NONE"}
            onChange={(e)=> setCount(Math.max(1, Number(e.target.value)||1))}
            className="h-9 w-full px-2 rounded-md ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
        </div>
        <div className="sm:col-span-1 text-[12px] text-slate-600 self-center">
          {enabled && freq!=="NONE"
            ? <>FREQ <b>{freq}</b> • INTERVALLE <b>{interval}</b> • NBR <b>{count}</b></>
            : <>Pas de récurrence</>}
        </div>
      </div>
    </div>
  );
}
