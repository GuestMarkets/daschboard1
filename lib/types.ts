// lib/types.ts

/* ---------- Tâches / Réunions ---------- */
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type UrgencyColor = "red" | "orange" | "green" | "slate";
export type UrgencyFilter = "all" | "red" | "orange" | "green" | "blocked" | "done";
export type SortKey = "due" | "priority" | "progress";
export type MeetingStatus = "scheduled" | "done" | "missed";
export type Role = "user" | "superAdmin";
export type Status = "todo" | "in_progress" | "blocked" | "done";
export type Priority = "low" | "medium" | "high";

export type RecurrenceInput = {
  frequency: "NONE" | "WEEKLY" | "MONTHLY";
  interval?: number;   // nb semaines ou nb mois
  count?: number;      // nb d'occurrences
};

export type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  due_date: string;       // YYYY-MM-DD
  due_time: string | null;// HH:MM
  status: Status;
  progress: number;
  performance: number;
  priority: Priority;
  is_recurrent: 0|1;
  recurrence_pattern: string | null;
  created_by: number;
  department_id: number | null;
  created_at: string;
  updated_at: string;
};

export type SubtaskRow = {
  id: number;
  task_id: number;
  title: string;
  description: string | null;
  done: 0|1;
  created_at: string;
};

export type UserLite = { id:number; name:string; email:string; department_id:number|null };

export interface Task {
  id: string;
  title: string;
  owner: string;
  dueAt: string;           // ISO date
  status: TaskStatus;
  progress: number;        // 0..100
  performance: number;     // libre (score)
  priority: 1 | 2 | 3;     // 1 haut, 3 bas
  updatedAt: string;       // ISO date
}

export interface Meeting {
  id: string;
  title: string;
  startAt: string;         // ISO date
  durationMin: number;
  attendees: string[];
  status: MeetingStatus;
  createdBy: string;
  rescheduledCount: number;
  location?: string;
  notes?: string;
}

/* ---------- Objectifs ---------- */
export type ObjectiveStatus = "todo" | "in_progress" | "done" | "archived";
export type ObjectivePriority = "passable" | "moyen" | "urgent";
export type ObjectiveScope = "mine" | "all";

export interface SubObjective {
  id: string | number;
  title: string;
  done: boolean;
  /** Poids en %, la somme doit faire 100 si défini */
  weight: number;
  /** YYYY-MM-DD | ISO string | null */
  dueDate?: string | null;
}

/**
 * Modèle d'objectif (API & UI).
 * `userId` et `scope` sont optionnels pour éviter les erreurs quand l'info n'est pas encore connue côté UI.
 */
export interface Objective {
  id: string | number;

  /** Propriétaire (id user) — optionnel si non connu côté UI immédiatement */
  userId?: number | null;

  /** "mine" | "all" — optionnel si non fourni par l'API */
  scope?: ObjectiveScope;

  title: string;
  description?: string | null;
  unit: string;                   // %, j, tâches…
  target: number;                 // cible (ex. 100 si pourcentage)
  current: number;                // valeur actuelle (peut rester 0 si calcul via subtasks)
  startDate: string;              // YYYY-MM-DD
  endDate: string;                // YYYY-MM-DD
  status: ObjectiveStatus;        // todo | in_progress | done | archived
  priority: ObjectivePriority;    // passable | moyen | urgent (calcul UI)
  subtasks: SubObjective[];       // sous-objectifs pondérés
  updatedAt: string;              // ISO date

  /** Champs legacy UI */
  owner?: string;
}

/* ---------- AppState du store ---------- */
export interface AppState {
  tasks: Task[];
  meetings: Meeting[];
  objectives: Objective[];
  currentUser: { name: string; role: Role };
}

/* ---------- Utils génériques ---------- */
export const iso = (d: Date | string) => new Date(d).toISOString();

export function addDays(date: Date, d: number) {
  const x = new Date(date);
  x.setDate(x.getDate() + d);
  return x;
}

export function setTime(date: Date, hh: number, mm: number) {
  const x = new Date(date);
  x.setHours(hh, mm, 0, 0);
  return x;
}

export function isSameDay(a: string | Date, b: string | Date) {
  const x = new Date(a), y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/* ---------- Urgence (tâches) ---------- */
export function urgencyColor(task: Task): UrgencyColor {
  const due = new Date(task.dueAt);
  const today = new Date();
  const daysLeft = Math.ceil((due.getTime() - setTime(today, 0, 0).getTime()) / 86400000);
  const overdue = due < today && task.progress < 100;

  if (task.status === "blocked" || overdue || daysLeft <= 0) return "red";
  if (task.progress > 0 && task.progress < 90) return "orange";
  if (task.status === "done" || task.progress >= 90) return "green";
  if (daysLeft <= 2) return "orange";
  return "slate";
}

export function statusLabel(task: Task) {
  const map: Record<TaskStatus, string> = {
    todo: "À faire",
    in_progress: "En cours",
    blocked: "Bloquée",
    done: "Terminée",
  };
  return map[task.status];
}

/* ---------- Helpers Objectifs (UI) ---------- */
export function computeObjectivePriority(endDate: string): ObjectivePriority {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(endDate + "T00:00:00");
  const diff = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (diff <= 2) return "urgent";
  if (diff <= 10) return "moyen";
  return "passable";
}

/** Progression basée sur les sous-objectifs pondérés si présents ; sinon current/target */
export function objectiveProgress(obj: Objective): number {
  if (obj.subtasks && obj.subtasks.length) {
    const totalW = obj.subtasks.reduce((s, t) => s + Math.max(0, t.weight || 0), 0) || 100;
    const doneW  = obj.subtasks.filter(t => t.done).reduce((s, t) => s + Math.max(0, t.weight || 0), 0);
    return Math.round((doneW / totalW) * 100);
  }
  return Math.round(Math.min(100, Math.max(0, (obj.current / (obj.target || 1)) * 100)));
}
