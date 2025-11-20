"use client";

import React, { useEffect, useMemo, useState } from "react";
import Shell from "../../components/Shell";
import Modal from "../../components/ui/Modal";
import {
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, Link2,
  Cloud, CloudOff, Mail
} from "lucide-react";

/* ---------- Types ---------- */
type EventType = "task" | "meeting" | "reminder" | "other";

type UserLite = { id: number; name: string; email: string };
type TaskLite = { id: number; title: string };

type EventItem = {
  id: number;
  title: string;
  description: string | null;
  type: EventType;
  allDay: boolean;
  timezone: string;
  startAt: string; // ISO
  endAt: string;   // ISO
  createdBy: number;
  taskId: number | null;
  googleEventId?: string | null;
  attendees: { id: number }[];
};

type ListResp<T> = { items: T[] };
type GoogleStatus = { connected: boolean; gmail?: string | null; has_gmail?: boolean };
type AuthUrlResp = { url: string };
type EventResp = { item: EventItem };

type EventPayload = {
  title: string;
  description: string | null;
  type: EventType;
  allDay: boolean;
  startAt: string; // ISO
  endAt: string;   // ISO
  attendees: number[];
  taskId: number | null;
  syncGoogle: boolean;
};

const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit"
  });

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit" });
const today = new Date();

/* ---------- utils ---------- */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return "Erreur inconnue"; }
}

/* ---------- fetch JSON helper ---------- */
async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept","application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch { /* ignore */ }

  const res = await fetch(url, { credentials:"include", ...init, headers });
  const ct = res.headers.get("content-type") || "";
  let data: unknown = null;

  if (ct.includes("application/json")) {
    try { data = await res.json(); }
    catch { data = null; }
  } else {
    const text = await res.text();
    try { data = JSON.parse(text); }
    catch { data = { error: (text || "").slice(0, 200) }; }
  }

  // @ts-expect-error — data may carry an error field from API; we normalize message below if not ok
  if (!res.ok) throw new Error((data && (data as { error?: string }).error) || `HTTP ${res.status}`);
  return data as T;
}

/* ---------- Date utils ---------- */
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function startOfWeek(d: Date)  { const nd = new Date(d); const day = (nd.getDay()+6)%7; nd.setDate(nd.getDate()-day); nd.setHours(0,0,0,0); return nd; }
function addDays(d: Date, n: number) { const nd = new Date(d); nd.setDate(nd.getDate()+n); return nd; }
function isoDate(d: Date) { const m = String(d.getMonth()+1).padStart(2,"0"); const dd = String(d.getDate()).padStart(2,"0"); return `${d.getFullYear()}-${m}-${dd}`; }
function toLocalInput(dt: Date) {
  const p = (n:number)=>String(n).padStart(2,"0");
  const y = dt.getFullYear(), mo = p(dt.getMonth()+1), da = p(dt.getDate());
  const h = p(dt.getHours()), mi = p(dt.getMinutes());
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

/* ---------- Modales ---------- */

/** Saisie Gmail si manquant */
function GmailModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string|null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(()=>{ if (open) { setEmail(""); setErr(null); setSaving(false); } }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email.trim().toLowerCase().endsWith("@gmail.com")) {
      setErr("Merci de saisir une adresse Gmail valide (ex: exemple@gmail.com).");
      return;
    }
    setSaving(true);
    try {
      await fetchJSON<unknown>("/api/calendar/google/save-gmail", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      onSaved(email.trim());
      onClose();
    } catch (e: unknown) {
      setErr(getErrorMessage(e) || "Impossible d’enregistrer l’adresse Gmail.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Ajouter mon adresse Gmail" size="sm">
      <form onSubmit={submit} className="space-y-3">
        {err && <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">{err}</div>}
        <div>
          <label className="text-[12px] text-slate-600 mb-1 block">Adresse Gmail</label>
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="email"
              value={email}
              onChange={e=>setEmail(e.target.value)}
              placeholder="exemple@gmail.com"
              className="w-full h-10 pl-7 pr-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
          <p className="text-[12px] text-slate-500 mt-1">
            Nous l’utiliserons pour connecter votre Google Agenda (OAuth2).
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm">Annuler</button>
          <button className={cls("px-3 h-9 rounded-lg text-white text-sm", saving ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700")}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Création / Edition d’événement */
function EventModal({
  open, onClose, onSubmit, defaults, users, tasks, googleConnected
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: EventPayload) => Promise<void>;
  defaults?: Partial<EventItem> & { startAt?: string; endAt?: string };
  users: UserLite[];
  tasks: TaskLite[];
  googleConnected: boolean;
}) {
  const nowPlus1h = useMemo(()=>{ const d=new Date(); d.setMinutes(0,0,0); d.setHours(d.getHours()+1); return d; },[]);
  const [title, setTitle] = useState(defaults?.title || "");
  const [description, setDescription] = useState(defaults?.description || "");
  const [type, setType] = useState<EventType>(defaults?.type || "meeting");
  const [allDay, setAllDay] = useState<boolean>(defaults?.allDay || false);
  const [startAt, setStartAt] = useState<string>(defaults?.startAt || toLocalInput(nowPlus1h));
  const [endAt, setEndAt] = useState<string>(defaults?.endAt || toLocalInput(new Date(nowPlus1h.getTime()+60*60*1000)));
  const [attendees, setAttendees] = useState<number[]>(defaults?.attendees?.map(a=>a.id) || []);
  const [taskId, setTaskId] = useState<number | "">((defaults?.taskId ?? "") as number | "");
  const [syncGoogle, setSyncGoogle] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(()=> {
    setTitle(defaults?.title || "");
    setDescription(defaults?.description || "");
    setType((defaults?.type as EventType) || "meeting");
    setAllDay(!!defaults?.allDay);
    setStartAt(defaults?.startAt || toLocalInput(nowPlus1h));
    setEndAt(defaults?.endAt || toLocalInput(new Date(nowPlus1h.getTime()+60*60*1000)));
    setAttendees(defaults?.attendees?.map(a=>a.id) || []);
    setTaskId((defaults?.taskId ?? "") as number | "");
    setErr(null); setSaving(false); setSyncGoogle(false);
  },[open, defaults, nowPlus1h]);

  useEffect(()=>{
    const s = new Date(startAt).getTime();
    const e = new Date(endAt).getTime();
    if (e < s) setEndAt(startAt);
  },[startAt, endAt]);

  function minDateTimeLocal() {
    const d=new Date(); d.setSeconds(0,0);
    return toLocalInput(d);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) { setErr("Titre requis."); return; }
    if (new Date(startAt).getTime() < (new Date()).setSeconds(0,0)) {
      setErr("Impossible de programmer dans le passé.");
      return;
    }
    setSaving(true);
    try {
      const payload: EventPayload = {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        type, allDay,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        attendees,
        taskId: taskId === "" ? null : Number(taskId),
        syncGoogle,
      };
      await onSubmit(payload);
      onClose();
    } catch (e: unknown) {
      setErr(getErrorMessage(e) || "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={defaults?.id ? "Modifier l’événement" : "Nouvel événement"} size="lg">
      <form onSubmit={submit} className="space-y-3">
        {err && <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">{err}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-[12px] text-slate-600 mb-1 block">Titre</label>
            <input value={title} onChange={e=>setTitle(e.target.value)} className="w-full h-9 px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"/>
          </div>
          <div>
            <label className="text-[12px] text-slate-600 mb-1 block">Type</label>
            <select value={type} onChange={e=>setType(e.target.value as EventType)} className="w-full h-9 px-2 rounded-lg ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none text-sm">
              <option value="meeting">Réunion</option>
              <option value="task">Tâche</option>
              <option value="reminder">Rappel</option>
              <option value="other">Autre</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-[12px] text-slate-600 mb-1 block">Description</label>
            <textarea value={description ?? ""} onChange={e=>setDescription(e.target.value)} className="w-full min-h-[70px] px-3 py-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none resize-y text-sm"/>
          </div>

          <div>
            <label className="text-[12px] text-slate-600 mb-1 block flex items=center gap-1"><Clock className="w-3.5 h-3.5"/> Début</label>
            <input type="datetime-local" value={startAt} onChange={e=>setStartAt(e.target.value)} min={minDateTimeLocal()} className="w-full h-9 px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"/>
          </div>
          <div>
            <label className="text-[12px] text-slate-600 mb-1 block flex items=center gap-1"><Clock className="w-3.5 h-3.5"/> Fin</label>
            <input type="datetime-local" value={endAt} onChange={e=>setEndAt(e.target.value)} min={startAt} className="w-full h-9 px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"/>
          </div>

          <div className="flex items-center gap-2">
            <input id="chk-allday" type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} className="accent-blue-600"/>
            <label htmlFor="chk-allday" className="text-sm text-slate-700">Toute la journée</label>
          </div>

          <div>
            <label className="text-[12px] text-slate-600 mb-1 block flex items-center gap-1"><Users className="w-3.5 h-3.5"/> Participants</label>
            <select
              multiple
              size={Math.min(6, Math.max(3, users.length))}
              value={attendees.map(String)}
              onChange={e=>{
                const ids = Array.from(e.target.selectedOptions).map(o=>Number(o.value));
                setAttendees(ids);
              }}
              className="w-full px-2 py-2 rounded-lg ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none text-sm">
              {users.map(u=> <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
            </select>
            <div className="text-[11px] text-slate-500 mt-1">Ctrl/⌘ pour multi-sélection.</div>
          </div>

          <div>
            <label className="text-[12px] text-slate-600 mb-1 block flex items-center gap-1"><Link2 className="w-3.5 h-3.5"/> Lier à une tâche</label>
            <select
              value={taskId === "" ? "" : String(taskId)}
              onChange={e=>setTaskId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full h-9 px-2 rounded-lg ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none text-sm">
              <option value="">— Aucune —</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 md:col-span-2">
            <input
              id="chk-gsync"
              type="checkbox"
              className="accent-blue-600"
              disabled={!googleConnected}
              checked={googleConnected && syncGoogle}
              onChange={e=>setSyncGoogle(e.target.checked)}
            />
            <label htmlFor="chk-gsync" className={cls("text-sm", googleConnected ? "text-slate-700" : "text-slate-400")}>
              Synchroniser avec mon Google Agenda {googleConnected ? "(connecté)" : "(non connecté)"}
            </label>
            {googleConnected ? <Cloud className="w-4 h-4 text-blue-600"/> : <CloudOff className="w-4 h-4 text-slate-400"/>}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm">Annuler</button>
          <button className={cls("px-3 h-9 rounded-lg text-white text-sm", saving ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700")}>
            {saving ? "Enregistrement…" : (defaults?.id ? "Enregistrer" : "Créer")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Page ---------- */
export default function CalendarPage() {
  const [month, setMonth] = useState<Date>(() => { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [events, setEvents] = useState<EventItem[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [gmail, setGmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [defaultStart, setDefaultStart] = useState<string | null>(null);

  const [askGmailOpen, setAskGmailOpen] = useState(false);

  // charger users, tasks, google status (au mount)
  useEffect(()=> {
    (async()=>{
      try {
        const [u, t, g] = await Promise.all([
          fetchJSON<ListResp<UserLite>>("/api/calendar/users-lite"),
          fetchJSON<ListResp<TaskLite>>("/api/calendar/tasks-lite"),
          fetchJSON<GoogleStatus>("/api/calendar/google/status"),
        ]);
        setUsers(u.items||[]); setTasks(t.items||[]);
        setGoogleConnected(!!g.connected);
        setGmail(g.gmail ?? null);
        // Si pas connecté et pas d’email en DB → demander Gmail
        if (!g.connected && !g.has_gmail) setAskGmailOpen(true);
        setErr(null);
      } catch(e: unknown) {
        setErr(getErrorMessage(e) || "Erreur chargement");
      }
    })();
  },[]);

  // charger les événements pour le mois courant
  const range = useMemo(()=>{
    const mStart = startOfWeek(startOfMonth(month));
    const mEnd   = addDays(startOfWeek(endOfMonth(month)), 6);
    return { from: isoDate(mStart), to: isoDate(mEnd) };
  },[month]);

  useEffect(()=> {
    (async()=>{
      try {
        // On suppose que ton API /api/calendar/events agrège toutes les tables calendrier
        const data = await fetchJSON<ListResp<EventItem>>(`/api/calendar/events?from=${range.from}&to=${range.to}`);
        setEvents(data.items || []);
        setErr(null);
      } catch(e: unknown) {
        setErr(getErrorMessage(e) || "Erreur calendrier");
        setEvents([]);
      }
    })();
  },[range.from, range.to]);

  // grille jours (6 semaines)
  const days = useMemo(()=>{
    const start = startOfWeek(startOfMonth(month));
    return Array.from({length: 42}, (_,i)=> addDays(start, i));
  },[month]);

  function eventsOnDay(d: Date) {
    const y = d.getFullYear(); const m = d.getMonth(); const dd = d.getDate();
    return events.filter(ev => {
      const s = new Date(ev.startAt);
      const e = new Date(ev.endAt);
      const startDay = new Date(y,m,dd,0,0,0,0);
      const endDay = new Date(y,m,dd,23,59,59,999);
      return startDay <= e && endDay >= s;
    }).slice(0,4);
  }

  function openCreateOn(day: Date) {
    const start = new Date(day);
    const now = new Date();
    const sameDay =
      now.getDate() === day.getDate() &&
      now.getMonth() === day.getMonth() &&
      now.getFullYear() === day.getFullYear();
    const safeHour = Math.max(9, sameDay ? now.getHours()+1 : 9);
    start.setHours(safeHour, 0, 0, 0);
    setDefaultStart(toLocalInput(start));
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(ev: EventItem) {
    setEditing(ev); setDefaultStart(null); setModalOpen(true);
  }

  async function handleSubmit(payload: EventPayload) {
    if (editing) {
      const data = await fetchJSON<EventResp>(`/api/calendar/events/${editing.id}`, {
        method: "PATCH", headers: { "Content-Type":"application/json" }, body: JSON.stringify(payload),
      });
      setEvents(arr => arr.map(x => x.id === editing.id ? data.item : x));
      setEditing(null);
    } else {
      const data = await fetchJSON<EventResp>(`/api/calendar/events`, {
        method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(payload),
      });
      setEvents(arr => [...arr, data.item]);
    }
  }

  const monthLabel = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Calendrier">
      {/* Fond décoratif */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -left-16 w-80 h-80 rounded-full blur-3xl opacity-40" style={{ backgroundColor: "#c7d2fe" }} />
        <div className="absolute top-64 -right-10 w-96 h-96 rounded-full blur-3xl opacity-40" style={{ backgroundColor: "#fbcfe8" }} />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</div>}

        {/* Bandeau Google */}
        <div className={cls("rounded-xl px-3 py-2 border flex items-center gap-2",
          googleConnected ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700")}>
          <CalendarIcon className={cls("w-4 h-4", googleConnected ? "text-blue-700" : "text-slate-600")} />
          <div className="text-sm">
            {googleConnected
              ? <>Connecté à Google Agenda {gmail ? `(${gmail})` : ""}. Vous pouvez synchroniser vos événements.</>
              : <>Connectez votre Google Agenda pour synchroniser vos événements.</>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!googleConnected ? (
              <>
                <button
                  onClick={async ()=>{
                    try {
                      // S’il n’y a pas d’email en base, on (re)demande
                      const st = await fetchJSON<GoogleStatus>("/api/calendar/google/status");
                      if (!st.has_gmail) { setAskGmailOpen(true); return; }
                      const { url } = await fetchJSON<AuthUrlResp>("/api/calendar/google/auth-url");
                      window.location.href = url;
                    } catch(err: unknown) {
                      // eslint-disable-next-line no-alert
                      alert(getErrorMessage(err) || "Impossible d’ouvrir Google");
                    }
                  }}
                  className="px-3 h-8 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
                  Connecter
                </button>
              </>
            ) : (
              <button
                onClick={async()=>{
                  try {
                    await fetchJSON<unknown>("/api/calendar/google/disconnect", { method: "POST" });
                    setGoogleConnected(false);
                  } catch(e: unknown){
                    // eslint-disable-next-line no-alert
                    alert(getErrorMessage(e) || "Erreur de déconnexion");
                  }
                }}
                className="px-3 h-8 rounded-lg ring-1 ring-slate-200 text-sm hover:bg-slate-50"
              >
                Déconnecter
              </button>
            )}
            {googleConnected ? <Cloud className="w-4 h-4 text-blue-600"/> : <CloudOff className="w-4 h-4 text-slate-400"/>}
          </div>
        </div>

        {/* Toolbar calendrier */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={()=> setMonth(new Date(month.getFullYear(), month.getMonth()-1, 1))}
              className="h-9 w-9 grid place-items-center rounded-lg ring-1 ring-slate-200 bg-white hover:bg-slate-50">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 py-1 rounded-lg bg-white ring-1 ring-slate-200 text-slate-900 font-medium">
              {monthLabel}
            </div>
            <button onClick={()=> setMonth(new Date(month.getFullYear(), month.getMonth()+1, 1))}
              className="h-9 w-9 grid place-items-center rounded-lg ring-1 ring-slate-200 bg-white hover:bg-slate-50">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={()=> setMonth(new Date())} className="h-9 px-3 rounded-lg ring-1 ring-slate-200 bg-white hover:bg-slate-50 text-sm">
              Aujourd’hui
            </button>
          </div>

          <button onClick={()=>{ setEditing(null); setDefaultStart(null); setModalOpen(true); }}
            className="h-9 px-3 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
            + Nouvel événement
          </button>
        </div>

        {/* Grille calendrier */}
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/60">
            {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((d)=>
              <div key={d} className="px-3 py-2 text-[12px] text-slate-600">{d}</div>
            )}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, idx) => {
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = d.toDateString() === today.toDateString();
              const evs = eventsOnDay(d);
              return (
                <div key={idx} className={cls(
                  "min-h-[110px] border-b border-r border-slate-100 p-2 hover:bg-slate-50 transition",
                  (idx % 7) === 6 ? "!border-r-0" : "",
                  inMonth ? "bg-white" : "bg-slate-50/70"
                )}>
                  <div className="flex items-center justify-between">
                    <div className={cls("text-[12px]", isToday ? "text-blue-700 font-semibold" : "text-slate-600")}>{fmtDay(d)}</div>
                    <button
                      className="text-[11px] px-2 py-0.5 rounded-md ring-1 ring-slate-200 hover:bg-slate-100"
                      onClick={()=> openCreateOn(d)}
                    >
                      Ajouter
                    </button>
                  </div>
                  <div className="mt-1 space-y-1">
                    {evs.map(ev => (
                      <button key={ev.id}
                        onClick={()=> openEdit(ev)}
                        className={cls(
                          "w-full text-left px-2 py-1 rounded-md text-[12.5px] truncate",
                          ev.type==="meeting" ? "bg-blue-50 text-blue-800 ring-1 ring-blue-200" :
                          ev.type==="task"    ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" :
                          ev.type==="reminder"? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" :
                                                "bg-slate-100 text-slate-800 ring-1 ring-slate-200"
                        )}
                        title={`${ev.title}\n${fmtDate(ev.startAt)} → ${fmtDate(ev.endAt)}`}
                      >
                        {ev.allDay ? "Journée • " : ""}{ev.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Modales */}
      <EventModal
        open={modalOpen}
        onClose={()=> setModalOpen(false)}
        onSubmit={handleSubmit}
        defaults={editing ? editing : (defaultStart ? { startAt: defaultStart } : undefined)}
        users={users}
        tasks={tasks}
        googleConnected={googleConnected}
      />
      <GmailModal
        open={askGmailOpen}
        onClose={()=> setAskGmailOpen(false)}
        onSaved={(email)=> setGmail(email)}
      />
    </Shell>
  );
}
