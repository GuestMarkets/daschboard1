// /guestmarkets/app/guestmarkets/projects/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Shell from "../../components/Shell";
import Modal from "../../components/ui/Modal";
import {
  FolderKanban, Users, CalendarDays, ArrowRight, Pencil,
  AlertCircle, CheckCircle2, Flame, NotebookPen
} from "lucide-react";

/* ------------------------------- Palette -------------------------------- */
const BRAND   = "#4f46e5"; // indigo-600
const EMERALD = "#059669";
const ORANGE  = "#f59e0b";
const RED     = "#dc2626";
const SLATE   = "#334155";

type ProjectStatus = "planned" | "active" | "done" | "archived";
type Priority = "low" | "medium" | "high";
type UserLite = { id: number; name: string; email?: string };
type Note = { id: number; project_id: number; user_id: number | null; text: string; created_at: string; user_name?: string | null };

type Project = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  progress: number;
  createdAt?: string;
  updatedAt: string;
  assigneeIds: number[];
  assignees: UserLite[];
  managerId?: number | null;
  manager?: { id: number; name: string } | null;
  priority?: Priority | null;
};

type Me = { id: number; name: string; email?: string; departmentId: number | null; isAdmin?: boolean };

/* ------------------------------ Utils UI -------------------------------- */
const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");
const fmt = (d?: string | null) => {
  if (!d) return "—";
  const dd = new Date(d);
  return Number.isNaN(dd.getTime()) ? "—" : dd.toLocaleDateString();
};
const fmtDateTimeSafe = (d?: string | null) => {
  if (!d) return "—";
  const dd = new Date(d);
  return Number.isNaN(dd.getTime()) ? "—" : dd.toLocaleString();
};

/* --------------------------------- Dates --------------------------------- */
function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function atLocal(dateStr: string, hhmm: string): Date {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Y, (M ?? 1) - 1, D ?? 1, h ?? 0, m ?? 0, 0, 0);
}

/* ----------- Utilitaires heures/progression/priority/statut ----------- */
function computeTotalHours(startDate: string, endDate: string): number {
  const start = atLocal(startDate, "08:00");
  const end   = atLocal(endDate, "17:00");
  const ms = Math.max(0, end.getTime() - start.getTime());
  return ms / 3_600_000;
}
function computeProgressAuto(startDate: string, endDate: string, now?: Date): number {
  const start = atLocal(startDate, "08:00");
  const end   = atLocal(endDate, "17:00");
  const nowD = now ?? new Date();
  const totalMs = Math.max(0, end.getTime() - start.getTime());
  if (totalMs === 0) return 100;
  const elapsedMs = Math.min(Math.max(0, nowD.getTime() - start.getTime()), totalMs);
  return Math.max(0, Math.min(100, Math.round((elapsedMs / totalMs) * 100)));
}
function computeStatusAuto(existing: ProjectStatus, startDate: string, endDate: string): ProjectStatus {
  if (existing === "archived") return "archived";
  const now = new Date();
  const sd = atLocal(startDate, "08:00");
  const ed = atLocal(endDate, "17:00");
  if (now < sd) return "planned";
  if (now > ed) return "done";
  return "active";
}
function computePriorityFromProgress(current: Priority | null | undefined, progressPercent: number): Priority {
  let pr: Priority = (current ?? "low");
  if (progressPercent >= 50) {
    if (pr === "low") pr = "medium";
    else if (pr === "medium") pr = "high";
  }
  if (progressPercent >= 70) {
    if (pr === "medium") pr = "high";
  }
  return pr;
}

/* --------------------------------- UI bits -------------------------------- */
const Pill = ({ children, tone = "indigo" }: { children: React.ReactNode; tone?: "indigo" | "emerald" | "orange" | "red" | "slate" }) => {
  const map = {
    indigo:  { bg: "bg-indigo-50",  text: "text-indigo-700",  ring: "ring-indigo-200"  },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
    orange:  { bg: "bg-amber-50",   text: "text-amber-700",   ring: "ring-amber-200"   },
    red:     { bg: "bg-red-50",     text: "text-red-700",     ring: "ring-red-200"     },
    slate:   { bg: "bg-slate-100",  text: "text-slate-700",   ring: "ring-slate-200"   },
  }[tone];
  return <span className={cls("px-2 py-0.5 rounded-full text-[11px] ring-1", map.bg, map.text, map.ring)}>{children}</span>;
};

const PriorityBadge = ({ priority }: { priority?: Priority | null }) => {
  const label = priority === "high" ? "Urgente" : priority === "medium" ? "Moyenne" : "Basse";
  const color = priority === "high" ? RED : priority === "medium" ? ORANGE : EMERALD;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ring-1"
      style={{ backgroundColor: `${color}12`, color, borderColor: `${color}33` }}
      title={`Priorité ${label}`}
    >
      <Flame className="w-3.5 h-3.5" /> {label}
    </span>
  );
};

const ProgressBar = ({ value, color = BRAND }: { value: number; color?: string }) => (
  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
    <div className="h-full" style={{ background: color, width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

/* ----------------------------- Popups ----------------------------------- */
function NoteList({ notes }: { notes: Note[] }) {
  if (!notes?.length) return <div className="text-[12px] text-slate-500">Aucune note.</div>;
  return (
    <div className="space-y-2 max-h-64 overflow-auto pr-1">
      {notes.map(n => (
        <div key={n.id} className="rounded-lg ring-1 ring-slate-200 bg-slate-50/60 p-2">
          <div className="text-[11px] text-slate-500">
            {n.user_name ? <b>{n.user_name}</b> : "—"} • {fmtDateTimeSafe(n.created_at)}
          </div>
          <div className="text-[13px] text-slate-800 whitespace-pre-wrap">{n.text}</div>
        </div>
      ))}
    </div>
  );
}

function ViewProjectModal({
  open, onClose, projectId
}: {
  open: boolean; onClose: () => void; projectId: number | null;
}) {
  const [item, setItem] = useState<Project | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!open || !projectId) return;
      try {
        setErr(null);
        const [a, b] = await Promise.all([
          fetchJSON<{ item: Project }>(`/api/projects/${projectId}`),
          fetchJSON<{ notes: Note[] }>(`/guestmarkets/api/projects/${projectId}/notes`),
        ]);
        setItem(a.item);
        setNotes(b.notes || []);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Erreur");
      }
    })();
  }, [open, projectId]);
  return (
    <Modal open={open} onClose={onClose} title="Détails du projet" size="lg">
      {!item ? <div className="text-slate-500 text-sm">Chargement…</div> : (
        <div className="space-y-3">
          {err && <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">{err}</div>}
          <div className="rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-500 text-white p-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <NotebookPen className="w-5 h-5" /> {item.name} <Pill tone="indigo">{item.code}</Pill>
            </div>
            <div className="mt-1 text-[12px] text-white/90">
              <CalendarDays className="inline w-3.5 h-3.5 mr-1" />
              Du {fmt(item.startDate)} au {fmt(item.endDate)} (17:00)
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
              <div className="text-[11px] text-slate-500 mb-1">Chef de projet</div>
              <div className="font-medium text-slate-900">{item.manager?.name || "—"}</div>
            </div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
              <div className="text-[11px] text-slate-500 mb-1">Progression</div>
              <div className="flex items-center gap-2">
                <ProgressBar value={item.progress} color={item.status==="planned"?ORANGE:item.status==="active"?EMERALD:item.status==="done"?BRAND:SLATE} />
                <span className="text-[12px] text-slate-700">{item.progress}%</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
            <div className="text-[11px] text-slate-500 mb-1">Membres affectés</div>
            {item.assignees?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {item.assignees.map(a => {
                  const hue = (a.id * 47) % 360;
                  return (
                    <span key={a.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ring-1"
                      style={{
                        background: `linear-gradient(90deg, hsl(${hue} 70% 97%), hsl(${hue} 70% 94%))`,
                        borderColor: `hsl(${hue} 45% 80%)`,
                        color: `hsl(${hue} 35% 28%)`,
                      }}>
                      <Users className="w-3.5 h-3.5 opacity-70" />
                      {a.name}
                    </span>
                  );
                })}
              </div>
            ) : <div className="text-[12px] text-slate-500">Aucun utilisateur assigné</div>}
          </div>

          {item.description && (
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
              <div className="text-[11px] text-slate-500 mb-1">Description</div>
              <div className="text-[13px] text-slate-800 whitespace-pre-wrap">{item.description}</div>
            </div>
          )}

          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
            <div className="text-[11px] text-slate-500 mb-1">Notes</div>
            <NoteList notes={notes} />
          </div>

          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 h-10 rounded-xl ring-1 ring-slate-200 hover:bg-slate-50">
              Fermer
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------ Modale Création (dépt only) --------------------- */
function CreateProjectModal({
  open, onClose, users, me, onCreated
}: {
  open: boolean; onClose: () => void; users: UserLite[]; me: Me | null;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(() => {
    const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0");
    const rand = Math.floor(Math.random()*900+100);
    return `PRJ-${y}${m}-${rand}`;
  });
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [managerId, setManagerId] = useState<number | "">("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && me?.id) {
      setAssigneeIds(prev => (prev.includes(me.id) ? prev : [me.id, ...prev]));
    }
    if (!open) {
      setName(""); setDescription(""); setStartDate(todayStr()); setEndDate(todayStr());
      setAssigneeIds(me?.id ? [me.id] : []); setManagerId(""); setPriority(""); setErr(null); setSaving(false);
    }
  }, [open, me?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) { setErr("Le nom est requis."); return; }
    if (!code.trim()) { setErr("Le code est requis."); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim() || null,
        startDate, endDate,
        assigneeIds,
        managerId: managerId === "" ? null : Number(managerId),
        priority: priority === "" ? null : priority,
      };
      const { item } = await fetchJSON<{ item: Project }>(`/guestmarkets/api/projects`, {
        method: "POST", body: JSON.stringify(payload)
      });
      onCreated(item);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  const totalHours = computeTotalHours(startDate, endDate);
  const unitPerHour = totalHours > 0 ? (100 / totalHours) : 0;

  return (
    <Modal open={open} onClose={onClose} title="Créer un projet" size="lg">
      <form onSubmit={submit} className="space-y-3">
        {err && <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm"><AlertCircle className="w-4 h-4" /> {err}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-2">
            <label className="block text-[12px] text-slate-600 mb-1">Nom</label>
            <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Ex. Lancement nouvelle marketplace" className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Code</label>
            <input value={code} onChange={(e)=>setCode(e.target.value)} placeholder="PRJ-202509-123" className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Début</label>
            <input type="date" value={startDate} onChange={(e)=>setStartDate(e.target.value)} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Fin (17:00 par défaut)</label>
            <input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5"><Users className="w-4 h-4" /> Chef de projet</label>
            <select value={managerId === "" ? "" : String(managerId)} onChange={(e)=>setManagerId(e.target.value === "" ? "" : Number(e.target.value))} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
              <option value="">— Aucun —</option>
              {users.map(u => (<option key={u.id} value={u.id}>{u.name}</option>))}
            </select>
          </div>
          <div className="md:col-span-2 xl:col-span-2">
            <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5"><Users className="w-4 h-4" /> Utilisateurs assignés (département)</label>
            <UserPicker users={users} value={assigneeIds} onChange={setAssigneeIds} lockUserId={me?.id ?? null} />
            <div className="text-[11px] text-slate-500 mt-1">Vous serez assigné automatiquement au projet.</div>
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5"><Flame className="w-4 h-4" /> Priorité</label>
            <select value={priority === "" ? "" : String(priority)} onChange={(e)=>setPriority(e.target.value === "" ? "" : (e.target.value as Priority))} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
              <option value="">— Auto —</option>
              <option value="low">Basse (vert)</option>
              <option value="medium">Moyenne (orange)</option>
              <option value="high">Urgente (rouge)</option>
            </select>
          </div>
          <div className="xl:col-span-2 grid content-center text-[11px] text-slate-600">
            Heures totales&nbsp;: <b>{Math.max(0, Math.round(totalHours))} h</b> • Unité/heure&nbsp;: <b>{unitPerHour ? unitPerHour.toFixed(2) : "—"}%</b>
          </div>
          <div className="md:col-span-2 xl:grid xl:col-span-6">
            <label className="block text-[12px] text-slate-600 mb-1">Description</label>
            <textarea value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="Objectifs, périmètre, contraintes…" className="w-full min-h-[90px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y" />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 h-10 rounded-xl ring-1 ring-slate-200 hover:bg-slate-50">Annuler</button>
          <button disabled={saving} className={cls("px-4 h-10 rounded-xl text-white font-semibold", saving ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700")}>
            {saving ? "Création…" : "Créer le projet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------- Modale Edit ------------------------------ */
function EditProjectModal({
  open, onClose, project, users, me, onSaved
}: {
  open: boolean; onClose: () => void; project: Project | null; users: UserLite[];
  me: Me | null; onSaved: (p: Project) => void;
}) {
  const isManager = !!(me && project && project.managerId === me.id);
  const locked = !isManager || (project?.status === "archived");

  const [name, setName] = useState(project?.name ?? "");
  const [code, setCode] = useState(project?.code ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [startDate, setStartDate] = useState(project?.startDate ?? todayStr());
  const [endDate, setEndDate] = useState(project?.endDate ?? todayStr());
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [progress, setProgress] = useState<number>(project?.progress ?? 0);
  const [priority, setPriority] = useState<Priority | "">((project?.priority as Priority) ?? "");
  const [assigneeIds, setAssigneeIds] = useState<number[]>(project?.assigneeIds ?? []);
  const [managerId, setManagerId] = useState<number | "">((project?.managerId as number) ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(project?.name ?? ""); setCode(project?.code ?? ""); setDescription(project?.description ?? "");
    setStartDate(project?.startDate ?? todayStr()); setEndDate(project?.endDate ?? todayStr());
    setStatus(project?.status ?? "active"); setProgress(project?.progress ?? 0);
    setPriority((project?.priority as Priority) ?? "");
    setAssigneeIds(project?.assigneeIds ?? []);
    setManagerId((project?.managerId as number) ?? "");
    setSaving(false); setErr(null);
  }, [project, open]);

  // recalcul auto (intentionnellement sans dépendances supplémentaires)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const newProgress = computeProgressAuto(startDate, endDate);
    const newStatus   = computeStatusAuto(status === "archived" ? "archived" : (project?.status ?? "active"), startDate, endDate);
    const currentBase = (priority === "" ? (project?.priority ?? "low") : priority) as Priority;
    const escalated   = computePriorityFromProgress(currentBase, newProgress);
    setProgress(newProgress);
    if ((project?.status ?? "active") !== "archived") setStatus(newStatus);
    setPriority(escalated);
  }, [startDate, endDate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!project || locked) return;
    setSaving(true); setErr(null);
    try {
      const guardedAssignees = me && assigneeIds.includes(me.id) ? assigneeIds : (me ? [me!.id, ...assigneeIds] : assigneeIds);
      const patch = {
        id: project.id, name: name.trim(), code: code.trim().toUpperCase(),
        description: description.trim() || null, startDate, endDate,
        status, progress,
        assigneeIds: guardedAssignees,
        managerId: managerId === "" ? null : Number(managerId),
        priority: (priority === "" ? null : (priority as Priority)),
      };
      const { item } = await fetchJSON<{ item: Project }>(`/api/projects/${project.id}`, {
        method: "PATCH", body: JSON.stringify(patch)
      });
      onSaved(item);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  const totalHours = computeTotalHours(startDate, endDate);
  const unitPerHour = totalHours > 0 ? (100 / totalHours) : 0;

  return (
    <Modal open={open} onClose={onClose} title={locked ? "Consulter le projet" : "Modifier le projet"} size="lg">
      {!project ? null : (
        <form onSubmit={submit} className={cls("space-y-3", locked && "opacity-70 pointer-events-none")}>
          {err && <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">{err}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">Nom</label>
              <input value={name} onChange={(e)=>setName(e.target.value)} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">Code</label>
              <input value={code} onChange={(e)=>setCode(e.target.value)} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none" />
            </div>
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">Début</label>
              <input type="date" value={startDate} onChange={(e)=>setStartDate(e.target.value)} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none" />
              <div className="text-[11px] text-slate-500 mt-1">La progression se base sur <b>08:00</b> ce jour.</div>
            </div>
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">Fin (17:00 par défaut)</label>
              <input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none" />
              <div className="text-[11px] text-slate-500 mt-1">Heure de fin par défaut : <b>17:00</b></div>
            </div>

            <div className="md:col-span-2 grid gap-2 rounded-xl bg-slate-50/70 ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-600">
                Heures totales&nbsp;: <b>{Math.max(0, Math.round(totalHours))} h</b> • Unité/heure&nbsp;: <b>{unitPerHour ? unitPerHour.toFixed(2) : "—"}%</b>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[12px] text-slate-600">Progression :</span>
                <ProgressBar value={progress} color={status==="planned"?ORANGE:status==="active"?EMERALD:status==="done"?BRAND:SLATE} />
                <span className="text-[12px] text-slate-700">{progress}%</span>
                <span className="mx-2">•</span>
                <span className="text-[12px] text-slate-600">Statut :</span>
                <Pill tone={status==="planned"?"orange":status==="active"?"emerald":status==="done"?"indigo":"slate"}>
                  {status==="planned"?"En attente":status==="active"?"En cours":status==="done"?"Terminé":"Archivé"}
                </Pill>
                <span className="mx-2">•</span>
                <span className="text-[12px] text-slate-600">Priorité :</span>
                <PriorityBadge priority={priority as Priority} />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-2"><Users className="w-4 h-4" /> Chef de projet</label>
              <select value={managerId === "" ? "" : String(managerId)} onChange={(e)=>setManagerId(e.target.value === "" ? "" : Number(e.target.value))} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 outline-none">
                <option value="">— Aucun —</option>
                {users.map(u => (<option key={u.id} value={u.id}>{u.name}</option>))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-2"><Users className="w-4 h-4" /> Utilisateurs assignés</label>
              <UserPicker users={users} value={assigneeIds} onChange={setAssigneeIds} disabled={!!locked} lockUserId={isManager ? (me?.id ?? null) : null} />
              {isManager && <div className="text-[11px] text-slate-500 mt-1">Vous ne pouvez pas vous retirer du projet tant que vous êtes chef.</div>}
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5"><Flame className="w-4 h-4" /> Priorité</label>
              <select value={priority === "" ? "" : String(priority)} onChange={(e)=>setPriority(e.target.value === "" ? "" : (e.target.value as Priority))} className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 outline-none">
                <option value="">— Auto —</option>
                <option value="low">Basse (vert)</option>
                <option value="medium">Moyenne (orange)</option>
                <option value="high">Urgente (rouge)</option>
              </select>
              <div className="text-[11px] text-slate-500 mt-1">La priorité peut être rehaussée automatiquement (50% / 70%).</div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] text-slate-600 mb-1">Description</label>
              <textarea value={description ?? ""} onChange={(e)=>setDescription(e.target.value)} className="w-full min-h-[90px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none resize-y" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 h-10 rounded-xl ring-1 ring-slate-200 hover:bg-slate-50">Fermer</button>
            {!locked && (
              <button
                disabled={saving}
                className={cls(
                  "px-4 h-10 rounded-xl text-white",
                  saving ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"
                )}
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

/* --------------------------- fetch JSON robuste --------------------------- */
async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const baseHeaders = new Headers(init?.headers || {});
  if (!baseHeaders.has("Accept")) baseHeaders.set("Accept", "application/json");
  const headers = new Headers(baseHeaders);
  try {
    const t = localStorage.getItem("auth_token");
    if (t) headers.set("Authorization", `Bearer ${t}`);
  } catch {}
  const res = await fetch(url, { credentials: "include", ...init, headers });
  const ct = res.headers.get("content-type") || "";
  let data: unknown = null;

  if (ct.includes("application/json")) {
    try { data = await res.json(); } catch { data = null; }
  } else {
    const text = await res.text();
    try { data = JSON.parse(text); }
    catch {
      data = {
        // on fournit un aperçu en cas de non-JSON
        error: (text || "").replace(/\s+/g, " ").slice(0, 200) || "Réponse non-JSON",
      };
    }
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.error === "string" && obj.error.trim()) {
        message = obj.error;
      }
    }
    throw new Error(message);
  }
  return data as T;
}

/* ======================= Helpers déplacés en haut-niveau ================== */
function toStringIfString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function toNumberIfNumber(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function toArrayUsers(v: unknown): UserLite[] {
  return Array.isArray(v) ? (v as UserLite[]) : [];
}
function toArrayNumbers(v: unknown): number[] {
  return Array.isArray(v) ? (v as number[]) : [];
}
function normalizeProject(row: unknown): Project {
  const r = (typeof row === "object" && row !== null) ? (row as Record<string, unknown>) : {};

  const updatedRaw =
    toStringIfString(r.updatedAt) ??
    toStringIfString(r.updated_at) ??
    null;

  const updatedAt =
    (updatedRaw && !Number.isNaN(new Date(updatedRaw).getTime()))
      ? new Date(updatedRaw).toISOString()
      : new Date().toISOString();

  const managerObj = (typeof r.manager === "object" && r.manager !== null)
    ? (r.manager as Record<string, unknown>)
    : null;

  const managerId =
    toNumberIfNumber(r.managerId) ??
    toNumberIfNumber(r.manager_id) ??
    (managerObj && toNumberIfNumber(managerObj.id)) ??
    null;

  const managerName =
    (managerObj && toStringIfString(managerObj.name)) ??
    (typeof r.manager_name === "string" ? String(r.manager_name) : null);

  const startDate = toStringIfString(r.startDate) ?? toStringIfString(r.start_date) ?? "";
  const endDate   = toStringIfString(r.endDate)   ?? toStringIfString(r.end_date)   ?? "";

  const statusRaw = (typeof r.status === "string" ? r.status : "planned") as ProjectStatus;

  return {
    id: Number(r.id ?? 0),
    name: String(r.name ?? ""),
    code: String(r.code ?? ""),
    description: (typeof r.description === "string" ? r.description : null),
    startDate,
    endDate,
    status: statusRaw,
    progress: Number(r.progress ?? 0),
    createdAt: toStringIfString(r.createdAt) ?? toStringIfString(r.created_at) ?? undefined,
    updatedAt,
    assigneeIds: toArrayNumbers(r.assigneeIds),
    assignees: toArrayUsers(r.assignees),
    managerId,
    manager: managerId && managerName ? { id: managerId, name: managerName } : (managerObj && managerId ? { id: managerId, name: String(managerName ?? "") } : null),
    priority: (typeof r.priority === "string" ? (r.priority as Priority) : null),
  };
}

/* --------------------------------- Page ---------------------------------- */
type StatusFilter = "all" | ProjectStatus;
type SortKey = "date" | "name" | "progress";

function UserPicker({
  users, value, onChange, disabled, lockUserId, placeholder = "Rechercher un utilisateur…"
}: {
  users: UserLite[]; value: number[]; onChange: (ids: number[]) => void;
  disabled?: boolean; lockUserId?: number | null; placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(u => (u.name + (u.email ?? "")).toLowerCase().includes(s));
  }, [users, q]);

  function toggle(id: number) {
    if (lockUserId != null && id === lockUserId) return; // impossible de se retirer si chef
    if (value.includes(id)) onChange(value.filter(v => v !== id));
    else onChange([...value, id]);
  }

  return (
    <div className={cls("rounded-xl ring-1 ring-slate-200 p-2 bg-white/70", disabled && "opacity-50 pointer-events-none")}>
      <div className="flex items-center gap-2 mb-2">
        <input value={q} onChange={e => setQ(e.target.value)} className="h-9 flex-1 px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-white" placeholder={placeholder} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.length === 0 ? (
          <span className="text-[12px] text-slate-500">Aucun utilisateur sélectionné.</span>
        ) : value.map(id => {
          const u = users.find(x => x.id === id);
          if (!u) return null;
          const locked = (lockUserId != null) && id === lockUserId;
          return (
            <span key={id} className={cls(
              "text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 inline-flex items-center gap-1",
              locked && "opacity-70"
            )}>
              {u.name}
              {!locked && <button type="button" onClick={() => toggle(id)} className="hover:text-indigo-900">×</button>}
            </span>
          );
        })}
      </div>
      <div className="max-h-56 overflow-auto pr-1 space-y-1">
        {filtered.map(u => {
          const checked = value.includes(u.id);
          const locked  = (lockUserId != null) && u.id === lockUserId;
          return (
            <label key={u.id} className={cls("flex items-center gap-2 text-[13px] px-2 py-1 rounded-lg hover:bg-slate-50", locked && "opacity-60 cursor-not-allowed")}>
              <input type="checkbox" disabled={!!locked} checked={checked} onChange={() => toggle(u.id)} />
              <span className="truncate">
                <span className="font-medium text-slate-800">{u.name}</span>
                {u.email && <span className="text-[11px] text-slate-500 ml-1">— {u.email}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [usersDept, setUsersDept] = useState<UserLite[]>([]);
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filtres
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("date");
  const [managerFilter, setManagerFilter] = useState<number | "all">("all");

  // modales
  const [viewId, setViewId] = useState<number | null>(null);
  const [editItem, setEditItem] = useState<Project | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // progression temps réel
  const [clock, setClock] = useState(0);
  useEffect(() => { const id = setInterval(()=>setClock(c=>c+1), 60_000); return ()=>clearInterval(id); }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [meRes, usersRes, projRes] = await Promise.all([
          fetchJSON<{ me: Me }>(`/guestmarkets/api/me`),
          fetchJSON<{ users: UserLite[] }>(`/guestmarkets/api/users/department`),
          fetchJSON<{ projects: unknown[] }>(`/guestmarkets/api/projects/assigned`),
        ]);
        setMe(meRes.me || null);
        setUsersDept(usersRes.users || []);
        setItems((projRes.projects || []).map(normalizeProject));
        setErr(null);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visualItems = useMemo(() => {
    // utilisation explicite de clock pour recalculer toutes les minutes
    const now = new Date(Date.now() + clock * 0);
    return items.map(p => {
      const autoProg = computeProgressAuto(p.startDate, p.endDate, now);
      const mergedProgress = Math.max(p.progress ?? 0, autoProg);
      const visualStatus = computeStatusAuto(p.status, p.startDate, p.endDate);
      const escalatedPriority = computePriorityFromProgress(p.priority ?? "low", mergedProgress);
      return { ...p, progress: mergedProgress, status: visualStatus, priority: escalatedPriority };
    });
  }, [items, clock]);

  const managersDept = useMemo(() => {
    const set = new Map<number,string>();
    for (const p of visualItems) if (p.manager?.id && p.manager?.name) set.set(p.manager.id, p.manager.name);
    const idsDept = new Set(usersDept.map(u=>u.id));
    return Array.from(set.entries()).filter(([id]) => idsDept.has(id)).map(([id,name])=>({id,name}));
  }, [visualItems, usersDept]);

  const list = useMemo(() => {
    let arr = visualItems.slice();
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter(p =>
        p.name.toLowerCase().includes(s) ||
        p.code.toLowerCase().includes(s) ||
        (p.description ?? "").toLowerCase().includes(s) ||
        (p.assignees?.map(a => a.name).join(", ").toLowerCase().includes(s)) ||
        (p.manager?.name?.toLowerCase().includes(s) ?? false)
      );
    }
    if (statusFilter !== "all") arr = arr.filter(p => p.status === statusFilter);
    if (managerFilter !== "all") arr = arr.filter(p => (p.managerId ?? null) === Number(managerFilter));
    arr.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "progress") return b.progress - a.progress;
      return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
    });
    return arr;
  }, [visualItems, q, statusFilter, sort, managerFilter]);

  const stats = useMemo(() => {
    const total = visualItems.length;
    const planned = visualItems.filter(d => d.status === "planned").length;
    const active = visualItems.filter(d => d.status === "active").length;
    const done = visualItems.filter(d => d.status === "done").length;
    const archived = visualItems.filter(d => d.status === "archived").length;
    const avg = total ? Math.round(visualItems.reduce((s, d) => s + d.progress, 0) / total) : 0;
    return { total, planned, active, done, archived, avg };
  }, [visualItems]);

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Projets">
      {/* Hero + stats */}
      <section className="rounded-3xl bg-gradient-to-r from-indigo-600 via-purple-500 to-emerald-500 text-white p-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
              <FolderKanban className="w-6 h-6" /> Projets
            </h1>
            <p className="text-white/90">
              Vue unifiée : vos projets <b>assignés</b> et ceux où vous êtes <b>chef</b>. Progression temps (08:00 → 17:00) & <i>priorité</i> auto.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setCreateOpen(true)} className="px-4 h-10 rounded-xl bg-white text-indigo-700 font-semibold hover:bg-slate-50">
              + Créer un projet
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">Total</div><div className="text-xl font-bold">{stats.total}</div></div>
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">En attente</div><div className="text-xl font-bold">{stats.planned}</div></div>
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">En cours</div><div className="text-xl font-bold">{stats.active}</div></div>
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">Terminés</div><div className="text-xl font-bold">{stats.done}</div></div>
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">Moy. progression</div><div className="text-xl font-bold">{stats.avg}%</div></div>
        </div>
      </section>

      {/* Filtres (chef limité au département) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 mt-3 mb-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div className="text-[13px] text-slate-600">Filtrer et trier</div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              value={q} onChange={(e)=>setQ(e.target.value)}
              placeholder="Rechercher (nom, code, description, chef, membre)…"
              className="text-gray-700 h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none min-w-[230px]"
            />
            <select
              value={statusFilter}
              onChange={(e)=>setStatusFilter(e.target.value as StatusFilter)}
              className="text-gray-700 h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="all">Tous les statuts</option>
              <option value="planned">En attente</option>
              <option value="active">En cours</option>
              <option value="done">Terminé</option>
              <option value="archived">Archivé</option>
            </select>
            <select
              value={managerFilter === "all" ? "all" : String(managerFilter)}
              onChange={(e)=>setManagerFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="text-gray-700 h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="all">Tous les chefs (mon dépt.)</option>
              {managersDept.map(m => (<option key={m.id} value={m.id}>{m.name}</option>))}
            </select>
            <select
              value={sort}
              onChange={(e)=>setSort(e.target.value as SortKey)}
              className="text-gray-700 h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="date">Tri par date</option>
              <option value="name">Tri par nom</option>
              <option value="progress">Tri par progression</option>
            </select>
          </div>
        </div>
      </section>

      {/* Liste */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {loading && <div className="col-span-full text-slate-500">Chargement…</div>}
        {err && !loading && <div className="col-span-full text-red-600">Erreur : {err}</div>}

        {!loading && !err && list.map(p => {
          const toneClass =
            p.status === "planned" ? "border-amber-200 bg-amber-50/60" :
            p.status === "active" ? "border-emerald-200 bg-emerald-50/60" :
            p.status === "done"   ? "border-indigo-200 bg-indigo-50/60" :
                                    "border-slate-200 bg-slate-50/60";
          const barColor =
            p.status === "planned" ? ORANGE :
            p.status === "active" ? EMERALD :
            p.status === "done"   ? BRAND : SLATE;

          const amIManager = !!(me && p.managerId === me.id);

          return (
            <div key={p.id} className={cls("rounded-2xl border p-3 hover:shadow-md transition", toneClass)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: barColor }} />
                    <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                    <Pill tone="indigo">{p.code}</Pill>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    Du {fmt(p.startDate)} au {fmt(p.endDate)} (17:00)
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone={p.status==="planned"?"orange":p.status==="active"?"emerald":p.status==="done"?"indigo":"slate"}>
                    {p.status==="planned"?"En attente":p.status==="active"?"En cours":p.status==="done"?"Terminé":"Archivé"}
                  </Pill>
                  <PriorityBadge priority={p.priority} />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
                <div className="rounded-xl bg-white/70 ring-1 ring-slate-200 p-2.5">
                  <div className="text-[11px] text-slate-500">Chef de projet</div>
                  <div className="font-medium text-slate-900 truncate">{p.manager?.name || "—"}</div>
                </div>
                <div className="rounded-xl bg-white/70 ring-1 ring-slate-200 p-2.5">
                  <div className="text-[11px] text-slate-500">Progression</div>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={p.progress} color={barColor} />
                    <span className="text-[11px] text-slate-700 min-w-[2.2rem] text-right">{p.progress}%</span>
                  </div>
                </div>
              </div>

              {p.assignees?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {p.assignees.map(a => {
                    const hue = (a.id * 47) % 360;
                    return (
                      <span key={a.id} className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[11px] ring-1"
                        style={{
                          background: `linear-gradient(90deg, hsl(${hue} 70% 97%), hsl(${hue} 70% 94%))`,
                          borderColor: `hsl(${hue} 45% 80%)`,
                          color: `hsl(${hue} 35% 28%)`,
                        }}>
                        <Users className="w-3.5 h-3.5 opacity-70" />
                        {a.name}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-1.5 text-[11px] text-slate-500">Aucun utilisateur assigné</div>
              )}

              <div className="mt-3 flex flex-wrap gap-2 justify-end">
                <button
                  onClick={()=>setViewId(p.id)}
                  className="cursor-pointer text-gray-500 inline-flex items-center gap-2 px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-white text-sm"
                >
                  Détails <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={()=>amIManager && setEditItem(p)}
                  className={cls(
                    "cursor-pointer text-gray-500 inline-flex items-center gap-2 px-3 h-9 rounded-lg ring-1 ring-slate-200 text-sm",
                    amIManager ? "hover:bg-white" : "opacity-50 cursor-not-allowed"
                  )}
                  title={amIManager ? "Modifier" : "Réservé au chef de projet"}
                >
                  <Pencil className="w-4 h-4" /> Modifier
                </button>
                <button
                  onClick={async ()=>{
                    if (!amIManager) return;
                    try {
                      const { item } = await fetchJSON<{ item: Project }>(`/api/projects/${p.id}`, {
                        method: "PATCH", body: JSON.stringify({ complete: true })
                      });
                      setItems(arr => arr.map(x => x.id === p.id ? item : x));
                    } catch {}
                  }}
                  disabled={!amIManager || p.status === "done"}
                  className={cls(
                    "inline-flex items-center gap-2 px-3 h-9 rounded-lg text-white text-sm",
                    (!amIManager || p.status === "done") ? "bg-slate-400 cursor-not-allowed" : "hover:opacity-95"
                  )}
                  style={{ backgroundColor: (!amIManager || p.status === "done") ? undefined : RED }}
                >
                  <CheckCircle2 className="w-4 h-4" /> Terminer
                </button>
              </div>
            </div>
          );
        })}

        {!loading && !err && list.length === 0 && (
          <div className="col-span-full text-slate-500 text-sm">Aucun projet.</div>
        )}
      </section>

      {/* Modales */}
      <ViewProjectModal open={!!viewId} onClose={()=>setViewId(null)} projectId={viewId} />
      <EditProjectModal
        open={!!editItem}
        onClose={()=>setEditItem(null)}
        project={editItem}
        users={usersDept}
        me={me}
        onSaved={(np)=>setItems(arr=>arr.map(x=>x.id===np.id?np:x))}
      />
      <CreateProjectModal
        open={createOpen}
        onClose={()=>setCreateOpen(false)}
        users={usersDept}
        me={me}
        onCreated={(p)=>setItems(prev=>[p, ...prev])}
      />
    </Shell>
  );
}
