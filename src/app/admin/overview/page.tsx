// app/admin/overview/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Shell from "../../components/Shell";
import { Card, SectionTitle } from "../../components/Primitives";
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Layers3,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";

/* ========================== Types ========================== */
type Priority = "Basse" | "Moyenne" | "Haute";
type TaskStatus = "todo" | "in_progress" | "done" | "overdue" | "blocked";
type MeetingStatus = "scheduled" | "in_progress" | "done" | "missed";
type GoalStatus = "on_track" | "at_risk" | "off_track" | "done";
type ProjectStatus = "planned" | "active" | "done" | "archived";

type UserRef = { id: number; name: string; deptName?: string | null };

type Task = {
  id: number;
  title: string;
  description: string | null;
  priority: Priority;
  status: TaskStatus;
  progress: number;
  deadline: string | null; // ISO date (due_date)
  assignee?: UserRef | null;
  project?: { id: number; name: string } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type Meeting = {
  id: number;
  title: string;
  description: string | null;
  startAt: string; // ISO
  endAt: string | null;
  location?: string | null;
  participants?: UserRef[];
  status?: MeetingStatus;
};

type Goal = {
  id: number;
  title: string;
  owner?: UserRef | null;
  progress: number; // 0..100
  deadline: string | null; // end_date
  status: GoalStatus;
};

type Project = {
  id: number;
  name: string;
  code: string;
  status: ProjectStatus;
  progress: number; // 0..100
  endDate: string; // ISO
  manager?: UserRef | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ActivityItem = {
  id: string;
  type: "task" | "project" | "meeting" | "goal" | "report" | "note" | "department";
  title: string;
  detail?: string;
  user?: string | null;
  at: string; // ISO datetime
  color?: string; // UI hint
};

/* ========================== Types DB (normaliseurs) ========================== */
type TaskDB = {
  id: number | string;
  title: string;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  progress?: number | string | null;
  due_date?: string | null;
  assignee_id?: number | string | null;
  assignee_name?: string | null;
  assignee_dept?: string | null;
  project_id?: number | string | null;
  project_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type MeetingDB = {
  id: number | string;
  title: string;
  notes?: string | null;
  start_at: string;
  end_at?: string | null;
  location?: string | null;
  status?: string | null;
};

type GoalDB = {
  id: number | string;
  title: string;
  owner_id?: number | string | null;
  owner_name?: string | null;
  owner_dept?: string | null;
  current?: number | string | null;
  target?: number | string | null;
  start_date: string;
  end_date: string;
  status?: string | null;
};

type ProjectDB = {
  id: number | string;
  name: string;
  code: string;
  status?: ProjectStatus | string | null;
  progress?: number | string | null;
  end_date: string;
  manager_id?: number | string | null;
  manager_name?: string | null;
  manager_dept?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/* ========================== Couleurs & utils UI ========================== */
const BRAND = "#3044f0";
const PINK = "#e647b3";
const VIOLET = "#7c3aed";
const GREEN = "#039855";
const ORANGE = "#f79009";
const RED = "#d92d20";
const SKY = "#0ea5e9";

const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");
const fmtDateTime = (d?: string | null) => (!d ? "—" : new Date(d).toLocaleString());
const fmtDate = (d?: string | null) => (!d ? "—" : new Date(d).toLocaleDateString());

const statusPillTask = (s: TaskStatus) =>
  ({
    todo: "bg-slate-100 text-slate-800",
    in_progress: "bg-blue-100 text-blue-800",
    done: "bg-emerald-100 text-emerald-800",
    overdue: "bg-red-100 text-red-800",
    blocked: "bg-amber-100 text-amber-800",
  }[s] || "bg-slate-100 text-slate-800");

const priorityPill = (p: Priority) =>
  ({
    Basse: "bg-emerald-100 text-emerald-800",
    Moyenne: "bg-orange-100 text-orange-800",
    Haute: "bg-red-100 text-red-800",
  }[p] || "bg-slate-100 text-slate-800");

const meetingPill = (s?: MeetingStatus) =>
  ({
    scheduled: "bg-indigo-100 text-indigo-800",
    in_progress: "bg-blue-100 text-blue-800",
    done: "bg-emerald-100 text-emerald-800",
    missed: "bg-rose-100 text-rose-800",
  }[s || "scheduled"]);

const goalPill = (s: GoalStatus) =>
  ({
    on_track: "bg-emerald-100 text-emerald-800",
    at_risk: "bg-amber-100 text-amber-800",
    off_track: "bg-rose-100 text-rose-800",
    done: "bg-blue-100 text-blue-800",
  }[s] || "bg-slate-100 text-slate-800");

/* ========================== Fetch JSON ========================== */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const res = await fetch(url, { credentials: "include", ...init, headers });
  const ct = res.headers.get("content-type") || "";
  let dataUnknown: unknown = null;
  if (ct.includes("application/json")) {
    try {
      dataUnknown = await res.json();
    } catch {
      dataUnknown = null;
    }
  } else {
    try {
      dataUnknown = await res.text();
    } catch {
      dataUnknown = null;
    }
  }
  if (!res.ok) {
    const message =
      typeof dataUnknown === "object" && dataUnknown !== null && "message" in dataUnknown
        ? String((dataUnknown as Record<string, unknown>).message)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return dataUnknown as T;
}

/* ========================== Normaliseurs ========================== */
function normPriorityDB(p?: string | null): Priority {
  const s = String(p || "").toLowerCase();
  if (s === "high" || s === "haute") return "Haute";
  if (s === "medium" || s === "moyenne") return "Moyenne";
  return "Basse";
}

function normTask(t: TaskDB): Task {
  return {
    id: Number(t.id),
    title: String(t.title),
    description: t.description ?? null,
    priority: normPriorityDB(t.priority),
    status: ((): TaskStatus => {
      const s = String(t.status || "todo").toLowerCase();
      if (s === "done") return "done";
      if (s === "in_progress") return "in_progress";
      if (s === "blocked") return "blocked";
      if (s === "overdue") return "overdue";
      return "todo";
    })(),
    progress: Math.max(0, Math.min(100, Number(t.progress || 0))),
    deadline: t.due_date ?? null,
    assignee: t.assignee_id
      ? {
          id: Number(t.assignee_id),
          name: t.assignee_name || "—",
          deptName: t.assignee_dept || null,
        }
      : null,
    project: t.project_id ? { id: Number(t.project_id), name: t.project_name || "Projet" } : null,
    createdAt: t.created_at ?? null,
    updatedAt: t.updated_at ?? null,
  };
}

function normMeeting(m: MeetingDB): Meeting {
  return {
    id: Number(m.id),
    title: String(m.title),
    description: m.notes ?? null,
    startAt: m.start_at,
    endAt: m.end_at ?? null,
    location: m.location ?? null,
    status: ((): MeetingStatus => {
      const s = String(m.status || "scheduled").toLowerCase() as MeetingStatus;
      return (["scheduled", "in_progress", "done", "missed"] as const).includes(s) ? s : "scheduled";
    })(),
    participants: [],
  };
}

function normGoal(g: GoalDB): Goal {
  const current = Number(g.current || 0);
  const target = Number(g.target || 100);
  const pct = !target ? 0 : Math.max(0, Math.min(100, Math.round((current / target) * 100)));
  let status: GoalStatus = "on_track";
  if (String(g.status).toLowerCase() === "done") status = "done";
  else {
    const start = new Date(g.start_date).getTime();
    const end = new Date(g.end_date).getTime();
    const now = Date.now();
    const span = end - start;
    const elapsed = Math.max(0, Math.min(span, now - start));
    const expected = span > 0 ? Math.round((elapsed / span) * 100) : 0;
    if (pct + 15 < expected) status = "at_risk";
    if (now > end && pct < 100) status = "off_track";
  }
  return {
    id: Number(g.id),
    title: String(g.title),
    owner: g.owner_id
      ? { id: Number(g.owner_id), name: g.owner_name || "—", deptName: g.owner_dept || null }
      : null,
    progress: pct,
    deadline: g.end_date ?? null,
    status,
  };
}

function normProject(p: ProjectDB): Project {
  const status =
    typeof p.status === "string" && ["planned", "active", "done", "archived"].includes(p.status)
      ? (p.status as ProjectStatus)
      : "active";
  return {
    id: Number(p.id),
    name: String(p.name),
    code: String(p.code),
    status,
    progress: Math.max(0, Math.min(100, Number(p.progress || 0))),
    endDate: p.end_date,
    manager: p.manager_id
      ? { id: Number(p.manager_id), name: p.manager_name || "—", deptName: p.manager_dept || null }
      : null,
    createdAt: p.created_at ?? null,
    updatedAt: p.updated_at ?? null,
  };
}

/* ========================== Helpers recherche (sans any) ========================== */
function matchTask(t: Task, s: string): boolean {
  const hay =
    `${t.title} ${t.description ?? ""} ${t.priority} ${t.status} ${t.assignee?.name ?? ""} ${t.project?.name ?? ""}`.toLowerCase();
  return hay.includes(s);
}
function matchMeeting(m: Meeting, s: string): boolean {
  const hay = `${m.title} ${m.description ?? ""} ${m.location ?? ""} ${m.status ?? ""}`.toLowerCase();
  return hay.includes(s);
}
function matchGoal(g: Goal, s: string): boolean {
  const hay = `${g.title} ${g.owner?.name ?? ""} ${g.status}`.toLowerCase();
  return hay.includes(s);
}
function matchProject(p: Project, s: string): boolean {
  const hay = `${p.name} ${p.code} ${p.manager?.name ?? ""} ${p.status}`.toLowerCase();
  return hay.includes(s);
}
function matchActivity(a: ActivityItem, s: string): boolean {
  const hay = `${a.title} ${a.detail ?? ""} ${a.user ?? ""} ${a.type}`.toLowerCase();
  return hay.includes(s);
}

/* ========================== Modal (liste complète) ========================== */
type ModalType = "tasks" | "meetings" | "goals" | "activities" | "projects";
type ModalFilterId =
  | "tasks_overdue"
  | "tasks_done"
  | "meetings_today"
  | "goals_risky"
  | undefined;

function FancyModal({
  open,
  onClose,
  title,
  accent = BRAND,
  type,
  data,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  accent?: string;
  type: ModalType;
  data: Task[] | Meeting[] | Goal[] | ActivityItem[] | Project[];
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;

    switch (type) {
      case "tasks":
        return (data as Task[]).filter((d) => matchTask(d, s));
      case "meetings":
        return (data as Meeting[]).filter((d) => matchMeeting(d, s));
      case "goals":
        return (data as Goal[]).filter((d) => matchGoal(d, s));
      case "projects":
        return (data as Project[]).filter((d) => matchProject(d, s));
      case "activities":
        return (data as ActivityItem[]).filter((d) => matchActivity(d, s));
      default:
        return data;
    }
  }, [data, q, type]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(1100px,92vw)] max-h-[86vh] -translate-x-1/2 -translate-y-1/2 rounded-3xl overflow-hidden shadow-2xl">
        <div
          className="relative px-6 py-5 text-white"
          style={{ background: `linear-gradient(135deg, ${accent}, ${PINK})` }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-lg font-semibold tracking-tight">{title}</div>
              <div className="text-white/90 text-[12px]">Liste complète — filtrable ci-dessous.</div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-2 rounded-xl bg-white/20 hover:bg-white/30 transition"
              title="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-3 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/80" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/20 focus:bg-white/25 outline-none placeholder:text-white/70 text-white text-sm"
            />
          </div>
        </div>

        <div className="bg-white p-0 overflow-auto max-h-[62vh]">
          {type === "tasks" && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left">
                  <th className="px-4 py-2">Titre</th>
                  <th className="px-4 py-2">Assigné</th>
                  <th className="px-4 py-2">Priorité</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Avancement</th>
                  <th className="px-4 py-2">Échéance</th>
                  <th className="px-4 py-2">Projet</th>
                </tr>
              </thead>
              <tbody>
                {(filtered as Task[]).map((t, i) => (
                  <tr key={t.id} className={i % 2 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-4 py-2 font-medium text-slate-900">{t.title}</td>
                    <td className="px-4 py-2">{t.assignee?.name || "—"}</td>
                    <td className="px-4 py-2">
                      <span className={"px-2 py-0.5 rounded-full text-[11px] " + priorityPill(t.priority)}>{t.priority}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={"px-2 py-0.5 rounded-full text-[11px] " + statusPillTask(t.status)}>{t.status}</span>
                    </td>
                    <td className="px-4 py-2">{t.progress}%</td>
                    <td className="px-4 py-2">{fmtDate(t.deadline)}</td>
                    <td className="px-4 py-2">{t.project?.name || "—"}</td>
                  </tr>
                ))}
                {!(filtered as Task[]).length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      Aucune tâche.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {type === "meetings" && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left">
                  <th className="px-4 py-2">Titre</th>
                  <th className="px-4 py-2">Début</th>
                  <th className="px-4 py-2">Fin</th>
                  <th className="px-4 py-2">Lieu</th>
                  <th className="px-4 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(filtered as Meeting[]).map((m, i) => (
                  <tr key={m.id} className={i % 2 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-4 py-2 font-medium text-slate-900">{m.title}</td>
                    <td className="px-4 py-2">{fmtDateTime(m.startAt)}</td>
                    <td className="px-4 py-2">{fmtDateTime(m.endAt)}</td>
                    <td className="px-4 py-2">{m.location || "—"}</td>
                    <td className="px-4 py-2">
                      <span className={"px-2 py-0.5 rounded-full text-[11px] " + meetingPill(m.status)}>{m.status || "scheduled"}</span>
                    </td>
                  </tr>
                ))}
                {!(filtered as Meeting[]).length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      Aucune réunion.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {type === "goals" && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left">
                  <th className="px-4 py-2">Objectif</th>
                  <th className="px-4 py-2">Porteur</th>
                  <th className="px-4 py-2">Progression</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Échéance</th>
                </tr>
              </thead>
              <tbody>
                {(filtered as Goal[]).map((g, i) => (
                  <tr key={g.id} className={i % 2 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-4 py-2 font-medium text-slate-900">{g.title}</td>
                    <td className="px-4 py-2">{g.owner?.name || "—"}</td>
                    <td className="px-4 py-2">{g.progress}%</td>
                    <td className="px-4 py-2">
                      <span className={"px-2 py-0.5 rounded-full text-[11px] " + goalPill(g.status)}>{g.status}</span>
                    </td>
                    <td className="px-4 py-2">{fmtDate(g.deadline)}</td>
                  </tr>
                ))}
                {!(filtered as Goal[]).length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      Aucun objectif.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {type === "projects" && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left">
                  <th className="px-4 py-2">Projet</th>
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Manager</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Progression</th>
                  <th className="px-4 py-2">Fin prévue</th>
                </tr>
              </thead>
              <tbody>
                {(filtered as Project[]).map((p, i) => (
                  <tr key={p.id} className={i % 2 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-4 py-2 font-medium text-slate-900">{p.name}</td>
                    <td className="px-4 py-2">{p.code}</td>
                    <td className="px-4 py-2">{p.manager?.name || "—"}</td>
                    <td className="px-4 py-2">{p.status}</td>
                    <td className="px-4 py-2">{p.progress}%</td>
                    <td className="px-4 py-2">{fmtDate(p.endDate)}</td>
                  </tr>
                ))}
                {!(filtered as Project[]).length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                      Aucun projet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {type === "activities" && (
            <div className="p-4 space-y-2">
              {(filtered as ActivityItem[]).map((a) => (
                <div
                  key={a.id}
                  className="rounded-2xl border border-slate-200 p-3 flex items-center gap-3 hover:shadow-sm transition"
                >
                  <div
                    className="w-10 h-10 rounded-xl"
                    style={{ background: `linear-gradient(135deg, ${a.color || "#c7d2fe"}, #fbcfe8)` }}
                  />
                  <div className="min-w-0">
                    <div className="text-slate-900 text-sm font-medium truncate">{a.title}</div>
                    <div className="text-slate-600 text-[12px]">{a.type} • {a.user || "—"}</div>
                  </div>
                  <div className="ml-auto text-slate-400 text-[12px] whitespace-nowrap">{fmtDateTime(a.at)}</div>
                </div>
              ))}
              {!(filtered as ActivityItem[]).length && (
                <div className="text-center text-slate-500 py-6">Aucune activité.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================== Page ========================== */
export default function AdminOverviewPage() {
  // Filtres
  const [userId, setUserId] = useState<number | "all">("all");
  const [users, setUsers] = useState<Array<{ id: number; name: string }>>([]);

  // Données
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Modale
  const [modal, setModal] = useState<{
    open: boolean;
    type: ModalType;
    title: string;
    accent?: string;
    filterId?: ModalFilterId;
  }>({
    open: false,
    type: "tasks",
    title: "",
  });

  const qDay = new Date();

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        // Users pour le filtre
        const u = await fetchJSON<{ items: { id: number; name: string }[] }>("/api/admin/users");
        setUsers([{ id: 0, name: "—" }, ...u.items]);

        // Overview (filtrable par user_id)
        const query = userId === "all" ? "" : `?user_id=${userId}`;
        const data = await fetchJSON<{
          tasks?: TaskDB[];
          meetings?: MeetingDB[];
          goals?: GoalDB[];
          projects?: ProjectDB[];
          activities?: ActivityItem[];
        }>(`/api/admin/overview${query}`);

        setTasks((data.tasks || []).map(normTask));
        setMeetings((data.meetings || []).map(normMeeting));
        setGoals((data.goals || []).map(normGoal));
        setProjects((data.projects || []).map(normProject));
        setActivities(data.activities || []);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Erreur inconnue";
        setErr(message);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  /* ================== KPIs ================== */
  const kpis = useMemo(() => {
    const totalTasks = tasks.length;
    const overdue = tasks.filter((t) => t.status === "overdue").length;
    const done = tasks.filter((t) => t.status === "done").length;
    const meetsToday = meetings.filter((m) => {
      const x = new Date(m.startAt);
      return (
        x.getFullYear() === qDay.getFullYear() &&
        x.getMonth() === qDay.getMonth() &&
        x.getDate() === qDay.getDate()
      );
    }).length;
    const goalsAtRisk = goals.filter((g) => g.status === "at_risk" || g.status === "off_track").length;

    return [
      {
        id: "k1",
        title: "Tâches totales",
        value: totalTasks,
        change: "—",
        trend: "up" as const,
        bg: "from-indigo-500 to-purple-500",
        icon: Layers3,
        accent: BRAND,
        open: () => setModal({ open: true, type: "tasks", title: "Toutes les tâches", accent: BRAND }),
      },
      {
        id: "k2",
        title: "En retard",
        value: overdue,
        change: "—",
        trend: overdue > 0 ? ("down" as const) : ("up" as const),
        bg: "from-rose-500 to-orange-500",
        icon: AlertCircle,
        accent: RED,
        open: () =>
          setModal({
            open: true,
            type: "tasks",
            title: "Tâches en retard",
            accent: RED,
            filterId: "tasks_overdue",
          }),
      },
      {
        id: "k3",
        title: "Terminées",
        value: done,
        change: "—",
        trend: "up" as const,
        bg: "from-emerald-500 to-teal-500",
        icon: CheckCircle2,
        accent: GREEN,
        open: () =>
          setModal({
            open: true,
            type: "tasks",
            title: "Tâches terminées",
            accent: GREEN,
            filterId: "tasks_done",
          }),
      },
      {
        id: "k4",
        title: "Réunions aujourd’hui",
        value: meetsToday,
        change: "—",
        trend: "up" as const,
        bg: "from-sky-500 to-blue-500",
        icon: CalendarDays,
        accent: SKY,
        open: () =>
          setModal({
            open: true,
            type: "meetings",
            title: "Toutes les réunions",
            accent: SKY,
            filterId: "meetings_today",
          }),
      },
      {
        id: "k5",
        title: "Objectifs à risque",
        value: goalsAtRisk,
        change: "—",
        trend: goalsAtRisk ? ("down" as const) : ("up" as const),
        bg: "from-pink-500 to-fuchsia-500",
        icon: Target,
        accent: PINK,
        open: () =>
          setModal({
            open: true,
            type: "goals",
            title: "Objectifs à risque",
            accent: PINK,
            filterId: "goals_risky",
          }),
      },
      {
        id: "k6",
        title: "Activités 24h",
        value: activities.length,
        change: "—",
        trend: "up" as const,
        bg: "from-violet-500 to-indigo-500",
        icon: Activity,
        accent: VIOLET,
        open: () =>
          setModal({ open: true, type: "activities", title: "Flux d’activités", accent: VIOLET }),
      },
    ];
  }, [tasks, meetings, goals, activities, qDay]); // ← ajout de qDay pour l’interdépendance

  // Listes limitées à 3, avec bouton "Voir tout"
  const soonTasks = useMemo(
    () =>
      tasks
        .filter((t) => !!t.deadline)
        .sort(
          (a, b) =>
            new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime()
        )
        .slice(0, 3),
    [tasks]
  );

  const nextMeetings = useMemo(
    () =>
      meetings
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
        .slice(0, 3),
    [meetings]
  );

  const riskyGoals = useMemo(
    () => goals.filter((g) => g.status === "at_risk" || g.status === "off_track").slice(0, 3),
    [goals]
  );

  const topProjects = useMemo(
    () =>
      projects
        .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
        .slice(0, 3),
    [projects]
  );

  // Filtres pour la modale (sans any)
  const modalData = useMemo((): Task[] | Meeting[] | Goal[] | ActivityItem[] | Project[] => {
    switch (modal.type) {
      case "tasks": {
        if (modal.filterId === "tasks_overdue") return tasks.filter((t) => t.status === "overdue");
        if (modal.filterId === "tasks_done") return tasks.filter((t) => t.status === "done");
        return tasks;
      }
      case "meetings": {
        if (modal.filterId === "meetings_today") {
          const d = new Date();
          return meetings.filter((m) => {
            const x = new Date(m.startAt);
            return (
              x.getFullYear() === d.getFullYear() &&
              x.getMonth() === d.getMonth() &&
              x.getDate() === d.getDate()
            );
          });
        }
        return meetings;
      }
      case "goals": {
        if (modal.filterId === "goals_risky")
          return goals.filter((g) => g.status === "at_risk" || g.status === "off_track");
        return goals;
      }
      case "projects":
        return projects;
      case "activities":
        return activities;
      default:
        return [];
    }
  }, [modal.type, modal.filterId, tasks, meetings, goals, projects, activities]);

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Super Admin • Vue d’ensemble">
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

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6 text-[13px]">
        {/* barre de filtres */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-[13px] text-slate-600">Filtrer les statistiques</div>
          <div className="flex items-center gap-2">
            <label className="text-[12px] text-slate-600">Utilisateur</label>
            <select
              value={userId}
              onChange={(e) =>
                setUserId(e.target.value === "all" ? "all" : Number(e.target.value))
              }
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="all">— Global —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* KPIs */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {kpis.map((k) => {
            const Icon = k.icon;
            const TrendIcon = k.trend === "up" ? TrendingUp : TrendingDown;
            return (
              <div
                key={k.id}
                className="rounded-2xl overflow-hidden cursor-pointer group"
                onClick={() => k.open()}
              >
                <div
                  className={cls(
                    "p-4 text-white bg-gradient-to-br",
                    k.bg,
                    "transition group-hover:opacity-95"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[12px] text-white/90">{k.title}</div>
                      <div className="text-3xl font-bold leading-tight">{k.value}</div>
                      <div className="flex items-center gap-1 text-[12px] mt-1">
                        <TrendIcon
                          className={cls(
                            "w-3.5 h-3.5",
                            k.trend === "up" ? "text-emerald-200" : "text-rose-200"
                          )}
                        />
                        <span className={k.trend === "up" ? "text-emerald-100" : "text-rose-100"}>
                          {k.change}
                        </span>
                        <span className="text-white/80">vs période précédente</span>
                      </div>
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

        {/* 4 colonnes : Échéances / Réunions / Objectifs / Projets */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>
                <span className="text-base">Échéances à venir</span>
              </SectionTitle>
              <button
                onClick={() =>
                  setModal({
                    open: true,
                    type: "tasks",
                    title: "Toutes les tâches",
                    accent: BRAND,
                  })
                }
                className="text-indigo-600 hover:bg-indigo-50 rounded-lg px-3 py-1 text-[12px]"
              >
                Voir tout
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {soonTasks.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{t.title}</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">
                        Assigné : {t.assignee?.name || "—"} • {t.project?.name || "Sans projet"}
                      </div>
                    </div>
                    <span className={cls("px-2 py-0.5 rounded-full text-[11px]", priorityPill(t.priority))}>
                      {t.priority}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px]">
                    <span className={cls("px-2 py-0.5 rounded-full", statusPillTask(t.status))}>
                      {t.status}
                    </span>
                    <span className="text-slate-600">
                      Échéance : <b>{fmtDate(t.deadline)}</b>
                    </span>
                  </div>
                </div>
              ))}
              {!soonTasks.length && (
                <div className="text-slate-500 text-sm">Aucune tâche proche de l’échéance.</div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>
                <span className="text-base">Prochaines réunions</span>
              </SectionTitle>
              <button
                onClick={() =>
                  setModal({
                    open: true,
                    type: "meetings",
                    title: "Toutes les réunions",
                    accent: SKY,
                    filterId: "meetings_today",
                  })
                }
                className="text-sky-600 hover:bg-sky-50 rounded-lg px-3 py-1 text-[12px]"
              >
                Voir tout
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {nextMeetings.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{m.title}</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">
                        {fmtDateTime(m.startAt)} • {m.location || "—"}
                      </div>
                    </div>
                    <span className={cls("px-2 py-0.5 rounded-full text-[11px]", meetingPill(m.status))}>
                      {m.status || "scheduled"}
                    </span>
                  </div>
                  <div className="mt-2 text-[12px] text-slate-600 line-clamp-2">
                    {m.description || "—"}
                  </div>
                </div>
              ))}
              {!nextMeetings.length && (
                <div className="text-slate-500 text-sm">Aucune réunion planifiée.</div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>
                <span className="text-base">Objectifs à suivre</span>
              </SectionTitle>
              <button
                onClick={() =>
                  setModal({
                    open: true,
                    type: "goals",
                    title: "Tous les objectifs",
                    accent: PINK,
                    filterId: "goals_risky",
                  })
                }
                className="text-pink-600 hover:bg-pink-50 rounded-lg px-3 py-1 text-[12px]"
              >
                Voir tout
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {riskyGoals.map((g) => (
                <div
                  key={g.id}
                  className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{g.title}</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">
                        Porteur : {g.owner?.name || "—"}
                      </div>
                    </div>
                    <span className={cls("px-2 py-0.5 rounded-full text-[11px]", goalPill(g.status))}>
                      {g.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px]">
                    <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: `${g.progress}%`,
                          background: `linear-gradient(90deg, ${PINK}, ${VIOLET})`,
                        }}
                      />
                    </div>
                    <span className="ml-2 text-slate-700">{g.progress}%</span>
                  </div>
                  <div className="text-[12px] text-slate-600 mt-1">
                    Échéance : <b>{fmtDate(g.deadline)}</b>
                  </div>
                </div>
              ))}
              {!riskyGoals.length && (
                <div className="text-slate-500 text-sm">Aucun objectif à risque.</div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>
                <span className="text-base">Projets</span>
              </SectionTitle>
              <button
                onClick={() =>
                  setModal({
                    open: true,
                    type: "projects",
                    title: "Tous les projets",
                    accent: ORANGE,
                  })
                }
                className="text-amber-600 hover:bg-amber-50 rounded-lg px-3 py-1 text-[12px]"
              >
                Voir tout
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {topProjects.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{p.name}</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">
                        {p.code} • Manager : {p.manager?.name || "—"}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-800">
                      {p.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px]">
                    <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: `${p.progress}%`,
                          background: `linear-gradient(90deg, ${ORANGE}, ${RED})`,
                        }}
                      />
                    </div>
                    <span className="ml-2 text-slate-700">{p.progress}%</span>
                  </div>
                  <div className="text-[12px] text-slate-600 mt-1">
                    Fin prévue : <b>{fmtDate(p.endDate)}</b>
                  </div>
                </div>
              ))}
              {!topProjects.length && (
                <div className="text-slate-500 text-sm">Aucun projet actif.</div>
              )}
            </div>
          </Card>
        </section>

        {/* Activités récentes */}
        <section>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>
                <span className="text-base">Activités récentes</span>
              </SectionTitle>
              <button
                onClick={() =>
                  setModal({
                    open: true,
                    type: "activities",
                    title: "Flux d’activités",
                    accent: VIOLET,
                  })
                }
                className="text-violet-600 hover:bg-violet-50 rounded-lg px-3 py-1 text-[12px]"
              >
                Tout voir
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {activities.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border border-slate-200 p-3 flex items-center gap-3 hover:shadow-sm transition"
                >
                  <div
                    className="w-10 h-10 rounded-xl"
                    style={{ background: `linear-gradient(135deg, ${a.color || "#c7d2fe"}, #fbcfe8)` }}
                  />
                  <div className="min-w-0">
                    <div className="text-slate-900 text-sm font-medium truncate">{a.title}</div>
                    <div className="text-slate-600 text-[12px]">{a.type} • {a.user || "—"}</div>
                  </div>
                  <div className="ml-auto text-slate-400 text-[12px] whitespace-nowrap">
                    {fmtDateTime(a.at)}
                  </div>
                </div>
              ))}
              {!activities.length && (
                <div className="text-slate-500 text-sm">Aucune activité.</div>
              )}
            </div>
          </Card>
        </section>

        {err && (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4" /> {err}
          </div>
        )}
        {loading && <div className="text-slate-500 text-sm">Chargement…</div>}
      </main>

      {/* Modale */}
      <FancyModal
        open={modal.open}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        title={modal.title}
        accent={modal.accent}
        type={modal.type}
        data={modalData}
      />
    </Shell>
  );
}
