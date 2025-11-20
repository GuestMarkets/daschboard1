"use client";

import React, { useEffect, useMemo, useState } from "react";
import Shell from "../../components/Shell";
import {
  Activity, AlertCircle, CalendarDays, CheckCircle2, Layers3, Target,
  TrendingDown, TrendingUp, Search, X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ========================== Types ========================== */
type Priority = "Basse" | "Moyenne" | "Haute";
type TaskStatus = "todo" | "in_progress" | "done" | "overdue" | "blocked";
type MeetingStatus = "scheduled" | "in_progress" | "done" | "missed";
type GoalStatus = "on_track" | "at_risk" | "off_track" | "done";
type ProjectStatus = "planned" | "active" | "done" | "archived";

type UserRef = { id: number; name: string; deptName?: string | null };

type Task = {
  id: number; title: string; description: string | null;
  priority: Priority; status: TaskStatus; progress: number;
  deadline: string | null;
  assignee?: UserRef | null;
  project?: { id: number; name: string } | null;
  createdAt?: string | null; updatedAt?: string | null;
};
type Meeting = {
  id: number; title: string; description: string | null;
  startAt: string; endAt: string | null; location?: string | null;
  status?: MeetingStatus;
};
type Goal = {
  id: number; title: string; owner?: UserRef | null;
  progress: number; deadline: string | null; status: GoalStatus;
};
type Project = {
  id: number; name: string; code: string; status: ProjectStatus;
  progress: number; endDate: string; manager?: UserRef | null;
  createdAt?: string | null; updatedAt?: string | null;
};
type ActivityItem = {
  id: string; type: "task"|"project"|"meeting"|"goal"|"report"|"note";
  title: string; detail?: string; user?: string | null; at: string; color?: string;
};

type MeOk = {
  ok: true;
  user: {
    id: number;
    name: string;
    role: "superAdmin" | "user";
    email: string;
    status: "VALIDATED" | "PENDING" | "SUSPENDED";
    is_admin: boolean;
    is_team_lead: boolean;
    is_department_lead: boolean;
    managed_project_ids: number[];
    lead_team_ids: number[];
  };
};
type MeErr = { ok: false; error: string };
type MeResponse = MeOk | MeErr;

type Scope = "global" | "department" | "self";

type OverviewResponse = {
  tasks?: unknown[];
  meetings?: unknown[];
  goals?: unknown[];
  projects?: unknown[];
  actions?: ActivityItem[];
};

/* ========================== UI utils ========================== */
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
    overdue: "bg-rose-100 text-rose-800",
    blocked: "bg-amber-100 text-amber-800",
  }[s] || "bg-slate-100 text-slate-800");

const priorityPill = (p: Priority) =>
  ({
    Basse: "bg-emerald-100 text-emerald-800",
    Moyenne: "bg-orange-100 text-orange-800",
    Haute: "bg-rose-100 text-rose-800",
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
  const data = ct.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && data !== null && "error" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).error)
        : undefined) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

/* ========================== Normaliseurs ========================== */
type Dict = Record<string, unknown>;

function asNum(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function asStr(v: unknown, def = "—"): string {
  return typeof v === "string" ? v : def;
}

function normPriorityDB(p?: unknown): Priority {
  const s = String(p || "").toLowerCase();
  if (s === "high" || s === "haute") return "Haute";
  if (s === "medium" || s === "moyenne") return "Moyenne";
  return "Basse";
}
function normTask(tu: Dict): Task {
  const t = tu as Dict;
  const statusStr = String((t.status as string) || "todo").toLowerCase();
  let status: TaskStatus = "todo";
  if (statusStr === "done") status = "done";
  else if (statusStr === "in_progress") status = "in_progress";
  else if (statusStr === "blocked") status = "blocked";
  else if (statusStr === "overdue") status = "overdue";

  return {
    id: asNum(t.id),
    title: asStr((t as Dict).title ?? (t as Dict).name ?? "—"),
    description: (t as Dict).description as string ?? null,
    priority: normPriorityDB(t.priority),
    status,
    progress: Math.max(0, Math.min(100, asNum(t.progress))),
    deadline: (t as Dict).due_date as string ?? (t as Dict).deadline as string ?? null,
    assignee: (t as Dict).assignee_id
      ? {
          id: asNum((t as Dict).assignee_id),
          name: asStr((t as Dict).assignee_name, "—"),
          deptName: (t as Dict).assignee_dept as string ?? null
        }
      : null,
    project: (t as Dict).project_id
      ? { id: asNum((t as Dict).project_id), name: asStr((t as Dict).project_name, "Projet") }
      : null,
    createdAt: (t as Dict).created_at as string ?? null,
    updatedAt: (t as Dict).updated_at as string ?? null,
  };
}
function normMeeting(mu: Dict): Meeting {
  const m = mu as Dict;
  const rawStatus = String((m.status as string) || "scheduled").toLowerCase();
  const valid: MeetingStatus[] = ["scheduled", "in_progress", "done", "missed"];
  const status: MeetingStatus = valid.includes(rawStatus as MeetingStatus) ? (rawStatus as MeetingStatus) : "scheduled";

  return {
    id: asNum(m.id),
    title: asStr(m.title ?? "—"),
    description: (m as Dict).notes as string ?? (m as Dict).description as string ?? null,
    startAt: asStr((m as Dict).start_at ?? (m as Dict).startAt ?? ""),
    endAt: (m as Dict).end_at as string ?? (m as Dict).endAt as string ?? null,
    location: (m as Dict).location as string ?? null,
    status,
  };
}
function normGoal(gu: Dict): Goal {
  const g = gu as Dict;
  const current = asNum(g.current);
  const target = asNum(g.target, 100);
  const pct = !target ? 0 : Math.max(0, Math.min(100, Math.round((current / target) * 100)));

  let status: GoalStatus = "on_track";
  if (String(g.status).toLowerCase() === "done") status = "done";
  else {
    const start = new Date((g as Dict).start_date as string).getTime();
    const end = new Date((g as Dict).end_date as string).getTime();
    const now = Date.now();
    const span = end - start;
    const elapsed = Math.max(0, Math.min(span, now - start));
    const expected = span > 0 ? Math.round((elapsed / span) * 100) : 0;
    if (pct + 15 < expected) status = "at_risk";
    if (now > end && pct < 100) status = "off_track";
  }

  return {
    id: asNum(g.id),
    title: asStr(g.title),
    owner: (g as Dict).owner_id
      ? {
          id: asNum((g as Dict).owner_id),
          name: asStr((g as Dict).owner_name, "—"),
          deptName: (g as Dict).owner_dept as string ?? null
        }
      : null,
    progress: pct,
    deadline: (g as Dict).end_date as string ?? null,
    status,
  };
}
function normProject(pu: Dict): Project {
  const p = pu as Dict;
  return {
    id: asNum(p.id),
    name: asStr(p.name),
    code: asStr(p.code ?? (p as Dict).ref ?? ""),
    status: (p.status as ProjectStatus) || "active",
    progress: Math.max(0, Math.min(100, asNum(p.progress))),
    endDate: asStr((p as Dict).end_date ?? (p as Dict).endDate ?? ""),
    manager: (p as Dict).manager_id
      ? {
          id: asNum((p as Dict).manager_id),
          name: asStr((p as Dict).manager_name, "—"),
          deptName: (p as Dict).manager_dept as string ?? null
        }
      : null,
    createdAt: (p as Dict).created_at as string ?? null,
    updatedAt: (p as Dict).updated_at as string ?? null,
  };
}

/* ========================== Primitives (light) ========================== */
function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cls("rounded-2xl border border-slate-200 bg-white/90 backdrop-blur-sm shadow-sm", props.className)} />
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold text-slate-800 tracking-tight">{children}</div>;
}

/* ========================== Modale liste ========================== */
type ModalType = "tasks" | "meetings" | "goals" | "projects" | "actions";

function stringifyItem(item: unknown): string {
  if (item == null) return "";
  if (typeof item === "string") return item;
  try {
    return JSON.stringify(item);
  } catch {
    return "";
  }
}

function FancyModal({
  open, onClose, title, accent = BRAND, type, data,
}: {
  open: boolean; onClose: () => void; title: string; accent?: string;
  type: ModalType;
  data: Task[] | Meeting[] | Goal[] | Project[] | ActivityItem[];
}) {
  const [q, setQ] = useState("");

  useEffect(() => { if (open) setQ(""); }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return (data as unknown[]).filter((d) => stringifyItem(d).toLowerCase().includes(s));
  }, [q, data]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(1100px,92vw)] max-h-[86vh] -translate-x-1/2 -translate-y-1/2 rounded-3xl overflow-hidden shadow-2xl">
        <div className="relative px-6 py-5 text-white" style={{ background: `linear-gradient(135deg, ${accent}, ${PINK})` }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-lg font-semibold tracking-tight">{title}</div>
              <div className="text-white/90 text-[12px]">Liste détaillée — filtrable ci-dessous</div>
            </div>
            <button onClick={onClose} className="shrink-0 p-2 rounded-xl bg-white/20 hover:bg-white/30 transition" title="Fermer">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-3 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/80" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/20 focus:bg-white/25 outline-none placeholder:text-white/70 text-white text-sm"
            />
          </div>
        </div>

        <div className="bg-white p-0 overflow-auto max-h-[62vh] text-sm">
          {type === "tasks" && (
            <table className="w-full">
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
                    <td className="px-4 py-2"><span className={"px-2 py-0.5 rounded-full text-[11px] " + priorityPill(t.priority)}>{t.priority}</span></td>
                    <td className="px-4 py-2"><span className={"px-2 py-0.5 rounded-full text-[11px] " + statusPillTask(t.status)}>{t.status}</span></td>
                    <td className="px-4 py-2">{t.progress}%</td>
                    <td className="px-4 py-2">{fmtDate(t.deadline)}</td>
                    <td className="px-4 py-2">{t.project?.name || "—"}</td>
                  </tr>
                ))}
                {!(filtered as Task[]).length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Aucune tâche.</td></tr>}
              </tbody>
            </table>
          )}

          {type === "meetings" && (
            <table className="w-full">
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
                    <td className="px-4 py-2"><span className={"px-2 py-0.5 rounded-full text-[11px] " + meetingPill(m.status)}>{m.status}</span></td>
                  </tr>
                ))}
                {!(filtered as Meeting[]).length && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Aucune réunion.</td></tr>}
              </tbody>
            </table>
          )}

          {type === "goals" && (
            <table className="w-full">
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
                    <td className="px-4 py-2"><span className={"px-2 py-0.5 rounded-full text-[11px] " + goalPill(g.status)}>{g.status}</span></td>
                    <td className="px-4 py-2">{fmtDate(g.deadline)}</td>
                  </tr>
                ))}
                {!(filtered as Goal[]).length && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Aucun objectif.</td></tr>}
              </tbody>
            </table>
          )}

          {type === "projects" && (
            <table className="w-full">
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
                {!(filtered as Project[]).length && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Aucun projet.</td></tr>}
              </tbody>
            </table>
          )}

          {type === "actions" && (
            <div className="p-4 space-y-2">
              {(filtered as ActivityItem[]).map((a) => (
                <div key={a.id} className="rounded-2xl border border-slate-200 p-3 flex items-center gap-3 hover:shadow-sm transition">
                  <div className="w-10 h-10 rounded-xl" style={{ background: `linear-gradient(135deg, ${a.color || "#c7d2fe"}, #fbcfe8)` }} />
                  <div className="min-w-0">
                    <div className="text-slate-900 text-sm font-medium truncate">{a.title}</div>
                    <div className="text-slate-600 text-[12px]">{a.type} • {a.user || "—"}</div>
                  </div>
                  <div className="ml-auto text-slate-400 text-[12px] whitespace-nowrap">{fmtDateTime(a.at)}</div>
                </div>
              ))}
              {!(filtered as ActivityItem[]).length && <div className="text-center text-slate-500 py-6">Aucune action.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================== Page ========================== */
type KPITrend = "up" | "down";
type KPI = {
  id: string;
  title: string;
  value: number;
  change: string;
  trend: KPITrend;
  bg: string;
  icon: LucideIcon;
  accent: string;
  open: () => void;
};

export default function AdminOverviewPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [scope, setScope] = useState<Scope>("self");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [actions, setActions] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [modal, setModal] = useState<{
    open: boolean;
    type: ModalType;
    title: string;
    accent?: string;
    data: Task[] | Meeting[] | Goal[] | Project[] | ActivityItem[];
  }>({ open: false, type: "tasks", title: "", data: [] });

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const r = await fetchJSON<MeResponse>("/api/me");
        if (!r.ok) {
          const message = "error" in r ? r.error : "Unauthorized";
          throw new Error(message);
        }
        setMe(r);

        // PRIORITÉ RESPONSABLE :
        const computedScope: Scope = r.user.is_admin
          ? "global"
          : r.user.is_department_lead
          ? "department"
          : "self";
        setScope(computedScope);

        const qs = new URLSearchParams();
        qs.set("scope", computedScope);
        qs.set("user_id", String(r.user.id));
        const data = await fetchJSON<OverviewResponse>(`/guestmarkets/api/overview?${qs.toString()}`);

        setTasks((data.tasks ?? []).map((t) => normTask(t as Dict)));
        setMeetings((data.meetings ?? []).map((m) => normMeeting(m as Dict)));
        setGoals((data.goals ?? []).map((g) => normGoal(g as Dict)));
        setProjects((data.projects ?? []).map((p) => normProject(p as Dict)));
        setActions((data.actions ?? []) as ActivityItem[]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ================== KPIs ================== */
  const kpis: KPI[] = useMemo(() => {
    const totalTasks = tasks.length;
    const overdue = tasks.filter((t) => t.status === "overdue").length;
    const done = tasks.filter((t) => t.status === "done").length;

    const todayCountMeetings = meetings.filter((m) => {
      const x = new Date(m.startAt);
      const d = new Date();
      return (
        x.getFullYear() === d.getFullYear() &&
        x.getMonth() === d.getMonth() &&
        x.getDate() === d.getDate()
      );
    }).length;

    const goalsAtRisk = goals.filter((g) => g.status === "at_risk" || g.status === "off_track").length;

    return [
      {
        id: "k1",
        title: "Tâches totales",
        value: totalTasks,
        change: "—",
        trend: "up",
        bg: "from-indigo-500 to-purple-500",
        icon: Layers3,
        accent: BRAND,
        open: () =>
          setModal({
            open: true,
            type: "tasks",
            title: "Toutes les tâches",
            accent: BRAND,
            data: tasks
          }),
      },
      {
        id: "k2",
        title: "En retard",
        value: overdue,
        change: "—",
        trend: overdue > 0 ? "down" : "up",
        bg: "from-rose-500 to-orange-500",
        icon: AlertCircle,
        accent: RED,
        open: () =>
          setModal({
            open: true,
            type: "tasks",
            title: "Tâches en retard",
            accent: RED,
            data: tasks.filter(t => t.status === "overdue")
          }),
      },
      {
        id: "k3",
        title: "Terminées",
        value: done,
        change: "—",
        trend: "up",
        bg: "from-emerald-500 to-teal-500",
        icon: CheckCircle2,
        accent: GREEN,
        open: () =>
          setModal({
            open: true,
            type: "tasks",
            title: "Tâches terminées",
            accent: GREEN,
            data: tasks.filter(t => t.status === "done")
          }),
      },
      {
        id: "k4",
        title: "Réunions aujourd’hui",
        value: todayCountMeetings,
        change: "—",
        trend: "up",
        bg: "from-sky-500 to-blue-500",
        icon: CalendarDays,
        accent: SKY,
        open: () =>
          setModal({
            open: true,
            type: "meetings",
            title: "Toutes les réunions",
            accent: SKY,
            data: meetings
          }),
      },
      {
        id: "k5",
        title: "Objectifs à risque",
        value: goalsAtRisk,
        change: "—",
        trend: goalsAtRisk ? "down" : "up",
        bg: "from-pink-500 to-fuchsia-500",
        icon: Target,
        accent: PINK,
        open: () =>
          setModal({
            open: true,
            type: "goals",
            title: "Objectifs à risque",
            accent: PINK,
            data: goals.filter(g => g.status === "at_risk" || g.status === "off_track")
          }),
      },
      {
        id: "k6",
        title:
          scope === "global" ? "Actions globales" :
          scope === "department" ? "Actions du département" : "Mes actions",
        value: actions.length,
        change: "—",
        trend: "up",
        bg: "from-violet-500 to-indigo-500",
        icon: Activity,
        accent: VIOLET,
        open: () =>
          setModal({
            open: true,
            type: "actions",
            title:
              scope === "global" ? "Activités globales" :
              scope === "department" ? "Activités du département" : "Mes activités",
            accent: VIOLET,
            data: actions
          }),
      },
    ];
  }, [tasks, meetings, goals, actions, scope]);

  const soonTasks = useMemo(
    () => tasks
      .filter(t => !!t.deadline)
      .sort((a, b) => new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime())
      .slice(0, 3),
    [tasks]
  );

  const nextMeetings = useMemo(
    () => [...meetings].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()).slice(0, 3),
    [meetings]
  );

  const riskyGoals = useMemo(
    () => goals.filter(g => g.status === "at_risk" || g.status === "off_track").slice(0, 3),
    [goals]
  );

  const topProjects = useMemo(
    () => [...projects].sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()).slice(0, 3),
    [projects]
  );

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Vue d’ensemble">
      {/* fond bokeh */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -left-16 w-80 h-80 rounded-full blur-3xl opacity-40" style={{ backgroundColor: "#c7d2fe" }} />
        <div className="absolute top-64 -right-10 w-96 h-96 rounded-full blur-3xl opacity-40" style={{ backgroundColor: "#fbcfe8" }} />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6 text-[13px]">
        {/* En-tête */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-[13px] text-slate-600">
            {me?.ok ? (
              <>
                Connecté en tant que <b>{me.user.name}</b> • Rôle :{" "}
                <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                  {me.user.is_admin ? "Super Admin" : (me.user.is_department_lead ? "Responsable de département" : "Utilisateur")}
                </span>
              </>
            ) : "Chargement du profil…"}
          </div>
          <div className="text-[12px] text-slate-500">
            Portée&nbsp;: <b>{scope === "global" ? "Globale" : scope === "department" ? "Département" : "Personnel"}</b>
          </div>
        </div>

        {/* KPIs */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {kpis.map((k) => {
            const Icon = k.icon;
            const TrendIcon = k.trend === "up" ? TrendingUp : TrendingDown;
            return (
              <div key={k.id} className="rounded-2xl overflow-hidden cursor-pointer group" onClick={() => k.open()}>
                <div className={cls("p-4 text-white bg-gradient-to-br", k.bg, "transition group-hover:opacity-95")}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[12px] text-white/90">{k.title}</div>
                      <div className="text-3xl font-bold leading-tight">{k.value}</div>
                      <div className="flex items-center gap-1 text-[12px] mt-1">
                        <TrendIcon className={cls("w-3.5 h-3.5", k.trend === "up" ? "text-emerald-200" : "text-rose-200")} />
                        <span className={k.trend === "up" ? "text-emerald-100" : "text-rose-100"}>{k.change}</span>
                        <span className="text-white/80">vs période précédente</span>
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-white/20"><Icon className="w-5 h-5" /></div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {/* 4 colonnes */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>Échéances à venir</SectionTitle>
              <button
                onClick={() => setModal({ open: true, type: "tasks", title: "Toutes les tâches", accent: BRAND, data: tasks })}
                className="text-indigo-600 hover:bg-indigo-50 rounded-lg px-3 py-1 text-[12px]">Voir tout</button>
            </div>
            <div className="mt-3 space-y-2">
              {soonTasks.map(t => (
                <div key={t.id} className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{t.title}</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">Assigné : {t.assignee?.name || "—"} • {t.project?.name || "Sans projet"}</div>
                    </div>
                    <span className={cls("px-2 py-0.5 rounded-full text-[11px]", priorityPill(t.priority))}>{t.priority}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px]">
                    <span className={cls("px-2 py-0.5 rounded-full", statusPillTask(t.status))}>{t.status}</span>
                    <span className="text-slate-600">Échéance : <b>{fmtDate(t.deadline)}</b></span>
                  </div>
                </div>
              ))}
              {!soonTasks.length && <div className="text-slate-500 text-sm">Aucune tâche proche de l’échéance.</div>}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>Prochaines réunions</SectionTitle>
              <button
                onClick={() => setModal({ open: true, type: "meetings", title: "Toutes les réunions", accent: SKY, data: meetings })}
                className="text-sky-600 hover:bg-sky-50 rounded-lg px-3 py-1 text-[12px]">Voir tout</button>
            </div>
            <div className="mt-3 space-y-2">
              {nextMeetings.map(m => (
                <div key={m.id} className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{m.title}</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">{fmtDateTime(m.startAt)} • {m.location || "—"}</div>
                    </div>
                    <span className={cls("px-2 py-0.5 rounded-full text-[11px]", meetingPill(m.status))}>{m.status || "scheduled"}</span>
                  </div>
                  <div className="mt-2 text-[12px] text-slate-600 line-clamp-2">{m.description || "—"}</div>
                </div>
              ))}
              {!nextMeetings.length && <div className="text-slate-500 text-sm">Aucune réunion planifiée.</div>}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>Objectifs à suivre</SectionTitle>
              <button
                onClick={() => setModal({ open: true, type: "goals", title: "Tous les objectifs", accent: PINK, data: goals })}
                className="text-pink-600 hover:bg-pink-50 rounded-lg px-3 py-1 text-[12px]">Voir tout</button>
            </div>
            <div className="mt-3 space-y-2">
              {riskyGoals.map(g => (
                <div key={g.id} className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{g.title}</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">Porteur : {g.owner?.name || "—"}</div>
                    </div>
                    <span className={cls("px-2 py-0.5 rounded-full text-[11px]", goalPill(g.status))}>{g.status}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px]">
                    <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full" style={{ width: `${g.progress}%`, background: `linear-gradient(90deg, ${PINK}, ${VIOLET})` }} />
                    </div>
                    <span className="ml-2 text-slate-700">{g.progress}%</span>
                  </div>
                  <div className="text-[12px] text-slate-600 mt-1">Échéance : <b>{fmtDate(g.deadline)}</b></div>
                </div>
              ))}
              {!riskyGoals.length && <div className="text-slate-500 text-sm">Aucun objectif à risque.</div>}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>Projets</SectionTitle>
              <button
                onClick={() => setModal({ open: true, type: "projects", title: "Tous les projets", accent: ORANGE, data: projects })}
                className="text-amber-600 hover:bg-amber-50 rounded-lg px-3 py-1 text-[12px]">Voir tout</button>
            </div>
            <div className="mt-3 space-y-2">
              {topProjects.map(p => (
                <div key={p.id} className="rounded-xl border border-slate-200 p-3 hover:shadow-sm transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{p.name}</div>
                      <div className="text-[12px] text-slate-500 mt-0.5">{p.code} • Manager : {p.manager?.name || "—"}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-800">{p.status}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px]">
                    <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full" style={{ width: `${p.progress}%`, background: `linear-gradient(90deg, ${ORANGE}, ${RED})` }} />
                    </div>
                    <span className="ml-2 text-slate-700">{p.progress}%</span>
                  </div>
                  <div className="text-[12px] text-slate-600 mt-1">Fin prévue : <b>{fmtDate(p.endDate)}</b></div>
                </div>
              ))}
              {!topProjects.length && <div className="text-slate-500 text-sm">Aucun projet actif.</div>}
            </div>
          </Card>
        </section>

        {/* ACTIVITÉS SCINDÉES PAR PORTÉE */}
        <section>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionTitle>
                {scope === "global" ? "Activités globales" : scope === "department" ? "Activités du département" : "Mes activités"}
              </SectionTitle>
              <button
                onClick={() => setModal({
                  open: true,
                  type: "actions",
                  title: scope === "global" ? "Activités globales" : scope === "department" ? "Activités du département" : "Mes activités",
                  accent: VIOLET,
                  data: actions,
                })}
                className="text-violet-600 hover:bg-violet-50 rounded-lg px-3 py-1 text-[12px]">
                Tout voir
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {actions.map(a => (
                <div key={a.id} className="rounded-xl border border-slate-200 p-3 flex items-center gap-3 hover:shadow-sm transition">
                  <div className="w-10 h-10 rounded-xl" style={{ background: `linear-gradient(135deg, ${a.color || "#c7d2fe"}, #fbcfe8)` }} />
                  <div className="min-w-0">
                    <div className="text-slate-900 text-sm font-medium truncate">{a.title}</div>
                    <div className="text-slate-600 text-[12px]">{a.type} • {a.user || "—"}</div>
                  </div>
                  <div className="ml-auto text-slate-400 text-[12px] whitespace-nowrap">{fmtDateTime(a.at)}</div>
                </div>
              ))}
              {!actions.length && <div className="text-slate-500 text-sm">Aucune action à afficher.</div>}
            </div>
          </Card>
        </section>

        {err && (
          <div className="flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4" /> {err}
          </div>
        )}
        {loading && <div className="text-slate-500 text-sm">Chargement…</div>}
      </main>

      <FancyModal
        open={modal.open}
        onClose={() => setModal(m => ({ ...m, open: false }))}
        title={modal.title}
        accent={modal.accent}
        type={modal.type}
        data={modal.data}
      />
    </Shell>
  );
}
