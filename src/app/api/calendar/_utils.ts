export type EventType = "task" | "meeting" | "reminder" | "other";

export function clampEnd(startISO: string, endISO: string): string {
  // garantit end >= start
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  return e < s ? new Date(s).toISOString() : endISO;
}

export function notPast(dateISO: string): boolean {
  const t = new Date();
  t.setSeconds(0, 0);
  const d = new Date(dateISO);
  return d.getTime() >= t.getTime();
}

export function toLocalISO(date: Date): string {
  // datetime-local friendly ISO (yyyy-MM-ddTHH:mm)
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

/** Représentation d'une ligne renvoyée par MySQL */
export interface EventRow {
  id: number | string;
  title: string;
  description?: string | null;
  type?: EventType | string | null;
  all_day?: 0 | 1 | boolean | null;
  timezone?: string | null;
  start_at: string | Date;
  end_at: string | Date;
  created_by: number | string;
  task_id?: number | string | null;
  google_event_id?: string | null;
  attendees?: unknown; // JSON, tableau ou null/undefined
}

/** Type retourné par mapEventRow */
export interface MappedEvent {
  id: number;
  title: string;
  description: string | null;
  type: EventType;
  allDay: boolean;
  timezone: string;
  startAt: string;
  endAt: string;
  createdBy: number;
  taskId: number | null;
  googleEventId: string | null;
  attendees: unknown[]; // on expose en tableau générique sans any
}

function toISOString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toBoolean(value: 0 | 1 | boolean | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return false;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function safeParseAttendees(input: unknown): unknown[] {
  if (Array.isArray(input)) return input as unknown[];
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? (parsed as unknown[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function mapEventRow(row: EventRow): MappedEvent {
  return {
    id: toNumber(row.id),
    title: row.title,
    description: row.description ?? null,
    type: (row.type ?? "other") as EventType,
    allDay: toBoolean(row.all_day ?? null),
    timezone: row.timezone || "UTC",
    startAt: toISOString(row.start_at),
    endAt: toISOString(row.end_at),
    createdBy: toNumber(row.created_by),
    taskId: row.task_id != null ? toNumber(row.task_id) : null,
    googleEventId: row.google_event_id ?? null,
    attendees: safeParseAttendees(row.attendees),
  };
}
