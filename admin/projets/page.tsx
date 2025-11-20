// app/admin/projects/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Shell from "../../components/Shell";
import Modal from "../../components/ui/Modal";
import {
  Plus, Pencil, AlertCircle, CheckCircle2, Users, Trash2, Flame,
} from "lucide-react";

/* -------------------------------- Palette -------------------------------- */
const BRAND = "#4f46e5"; // indigo-600
const EMERALD = "#059669"; // vert
const ORANGE = "#f59e0b";  // orange
const RED = "#dc2626";     // rouge
const SLATE = "#334155";

type ProjectStatus = "planned" | "active" | "done" | "archived";
type Priority = "low" | "medium" | "high";
type UserLite = { id: number; name: string; email?: string };
type Note = { id: number; project_id: number; user_id: number | null; text: string; created_at: string };

type Project = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  startDate: string;  // "YYYY-MM-DD"
  endDate: string;    // "YYYY-MM-DD"
  status: ProjectStatus;
  progress: number;   // 0..100 (manuel côté API)
  createdAt: string;
  updatedAt: string;
  assigneeIds: number[];
  assignees: { id: number; name: string; email?: string }[];
  managerId?: number | null;
  manager?: { id: number; name: string } | null;
  notes?: Note[];
  priority?: Priority | null;
};

const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");
const fmt = (d: string) => new Date(d).toLocaleDateString();

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
/** Calcule les heures totales du projet entre 08:00 (début) et 17:00 (fin) */
function computeTotalHours(startDate: string, endDate: string): number {
  const start = atLocal(startDate, "08:00");
  const end = atLocal(endDate, "17:00");
  const ms = Math.max(0, end.getTime() - start.getTime());
  return ms / 3_600_000; // ms -> heures
}
/** Heures écoulées à l’instant t, bornées [0..total] */
function computeElapsedHours(startDate: string, endDate: string, now = new Date()): number {
  const start = atLocal(startDate, "08:00");
  const end = atLocal(endDate, "17:00");
  if (end.getTime() <= start.getTime()) return 0;
  const elapsed = Math.min(Math.max(0, now.getTime() - start.getTime()), end.getTime() - start.getTime());
  return elapsed / 3_600_000;
}
/** Progression en % basée sur heures (unité par heure = 100/totalHours) */
function computeProgressAuto(startDate: string, endDate: string, now = new Date()): number {
  const totalH = computeTotalHours(startDate, endDate);
  if (totalH <= 0) return 100;
  const elapsedH = computeElapsedHours(startDate, endDate, now);
  const pct = Math.round((elapsedH / totalH) * 100);
  return Math.max(0, Math.min(100, pct));
}
/** Statut automatique basé sur la date/heure (08:00 / 17:00 par défaut) */
function computeStatusAuto(existing: ProjectStatus, startDate: string, endDate: string, now = new Date()): ProjectStatus {
  if (existing === "archived") return "archived";
  const sd = atLocal(startDate, "08:00");
  const ed = atLocal(endDate, "17:00");
  if (now < sd) return "planned";
  if (now > ed) return "done";
  return "active";
}
/** Priorité auto qui se contente de REHAUSSER selon paliers (ne baisse jamais) */
function computePriorityFromProgress(current: Priority | null | undefined, progressPercent: number): Priority {
  let pr: Priority = (current ?? "low");
  if (progressPercent >= 50) {           // palier 50%
    if (pr === "low") pr = "medium";
    else if (pr === "medium") pr = "high";
  }
  if (progressPercent >= 70) {           // palier 70%
    if (pr === "medium") pr = "high";
  }
  return pr;
}

const Pill = ({ children, tone = "indigo" }: { children: React.ReactNode; tone?: "indigo" | "emerald" | "orange" | "red" | "slate" }) => {
  const map = {
    indigo: { bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-200" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
    orange: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200" },
    red: { bg: "bg-red-50", text: "text-red-700", ring: "ring-red-200" },
    slate: { bg: "bg-slate-100", text: "text-slate-700", ring: "ring-slate-200" },
  } as const;
  const c = map[tone];
  return <span className={cls("px-2 py-0.5 rounded-full text-[11px] ring-1", c.bg, c.text, c.ring)}>{children}</span>;
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

/* --------------------------------- UserPicker ---------------------------------- */
function UserPicker({
  users, value, onChange, disabled, placeholder = "Rechercher un utilisateur…"
}: { users: UserLite[]; value: number[]; onChange: (ids: number[]) => void; disabled?: boolean; placeholder?: string; }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(u => (u.name + (u.email ?? "")).toLowerCase().includes(s));
  }, [users, q]);
  function toggle(id: number) { if (value.includes(id)) onChange(value.filter(v => v !== id)); else onChange([...value, id]); }
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
          return (
            <span key={id} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 inline-flex items-center gap-1">
              {u.name}
              <button type="button" onClick={() => toggle(id)} className="hover:text-indigo-900">×</button>
            </span>
          );
        })}
      </div>
      <div className="max-h-56 overflow-auto pr-1 space-y-1">
        {filtered.map(u => (
          <label key={u.id} className="flex items-center gap-2 text-[13px] px-2 py-1 rounded-lg hover:bg-slate-50">
            <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} />
            <span className="truncate">
              <span className="font-medium text-slate-800">{u.name}</span>
              {u.email && <span className="text-[11px] text-slate-500 ml-1">— {u.email}</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- Modales ------------------------------------- */
function NoteModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (text: string) => Promise<void>; }) {
  const [text, setText] = useState(""); const [err, setErr] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!open) { setText(""); setErr(null); setSaving(false); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Ajouter une note" size="md">
      <div className="space-y-3">
        {err && <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">{err}</div>}
        <textarea value={text} onChange={(e)=>setText(e.target.value)} className="w-full min-h-[100px] px-3 py-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y text-sm" placeholder="Votre note ou remarque…" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 h-8 rounded-md ring-1 ring-slate-200 hover:bg-slate-50 text-sm">Annuler</button>
          <button
            onClick={async ()=>{ setErr(null); if(!text.trim()) { setErr("La note est vide."); return; } setSaving(true);
              try { await onSubmit(text.trim()); onClose(); } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                setErr(msg || "Erreur inconnue");
              } finally { setSaving(false); } }}
            className={cls("px-3 h-8 rounded-md text-white text-sm", saving ? "bg-slate-400 cursor-not-allowed":"bg-indigo-600 hover:bg-indigo-700")}
          >
            {saving ? "Ajout…" : "Ajouter"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Modale : Créer un projet (responsive) ---------- */
function CreateProjectModal({
  open, onClose, users, onCreate, initialCode,
}: {
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  onCreate: (payload: {
    name: string; code: string; description: string | null;
    startDate: string; endDate: string;
    assigneeIds: number[];
    managerId: number | "";
    priority: Priority | "";
  }) => Promise<void>;
  initialCode: string;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
  const [managerId, setManagerId] = useState<number | "">("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName(""); setCode(initialCode); setDescription("");
      setStartDate(todayStr()); setEndDate(todayStr());
      setAssigneeIds([]); setManagerId(""); setPriority("");
      setErr(null); setSaving(false);
    }
  }, [open, initialCode]);

  useEffect(() => {
    if (!name.trim()) return;
    if (code.trim()) return;
    const initials = name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || "").join("").slice(0, 4);
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const rand = Math.floor(Math.random() * 900 + 100);
    setCode(`${initials || "PRJ"}-${y}${m}-${rand}`);
  }, [name, code]);

  function validate(): string | null {
    if (!name.trim()) return "Le nom est requis.";
    if (!code.trim()) return "Le code est requis.";
    if (!startDate || !endDate) return "Dates requises.";
    const sd = atLocal(startDate, "08:00").getTime();
    const ed = atLocal(endDate, "17:00").getTime();
    if (sd > ed) return "La date de fin doit être après (ou égale à) la date de début.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate(); if (v) { setErr(v); return; }
    setSaving(true);
    await onCreate({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description.trim() || null,
      startDate, endDate,
      assigneeIds,
      managerId,
      priority,
    });
    setSaving(false);
    onClose();
  }

  // Optionnel : mini-rappel total d'heures & unité (lecture seule)
  const totalHours = computeTotalHours(startDate, endDate);
  const unitPerHour = totalHours > 0 ? (100 / totalHours) : 0;

  return (
    <Modal open={open} onClose={onClose} title="Créer un projet" size="lg">
      <form onSubmit={submit} className="space-y-3">
        {err && (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4" /> {err}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-2">
            <label className="block text-[12px] text-slate-600 mb-1">Nom</label>
            <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Ex. Refonte site web" className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Code (auto)</label>
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
          {/* Chef de projet */}
          <div>
            <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5">
              <Users className="w-4 h-4" /> Chef de projet
            </label>
            <select
              value={managerId === "" ? "" : String(managerId)}
              onChange={(e)=>setManagerId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">— Aucun —</option>
              {users.map(u => (<option key={u.id} value={u.id}>{u.name}</option>))}
            </select>
          </div>
          {/* Assignés */}
          <div className="md:col-span-2 xl:col-span-2">
            <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5">
              <Users className="w-4 h-4" /> Utilisateurs assignés
            </label>
            <UserPicker users={users} value={assigneeIds} onChange={setAssigneeIds} />
          </div>
          {/* Priorité */}
          <div>
            <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5">
              <Flame className="w-4 h-4" /> Priorité
            </label>
            <select
              value={priority === "" ? "" : String(priority)}
              onChange={(e)=>setPriority(e.target.value === "" ? "" : (e.target.value as Priority))}
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">— Auto —</option>
              <option value="low">Basse (vert)</option>
              <option value="medium">Moyenne (orange)</option>
              <option value="high">Urgente (rouge)</option>
            </select>
            <div className="text-[11px] text-slate-500 mt-1">
              La priorité peut être <b>rehaussée automatiquement</b> aux seuils 50% / 70% selon l’avancement, même si vous la définissez manuellement.
              (Laisser “Auto” = point de départ <i>Basse</i>.)
            </div>
          </div>

          {/* Info calculée (lecture seule) */}
          <div className="xl:col-span-2 grid content-center">
            <div className="text-[11px] text-slate-600">
              Heures totales estimées&nbsp;: <b>{Math.max(0, Math.round(totalHours))} h</b> •
              Unité/heure&nbsp;: <b>{unitPerHour ? unitPerHour.toFixed(2) : "—"}%</b>
            </div>
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

/* --------------------------- Modale édition --------------------------- */
function EditProjectModal({
  open, onClose, project, users, onSave, locked,
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  users: UserLite[];
  onSave: (patch: {
    id: number;
    name?: string; code?: string; description?: string | null;
    startDate?: string; endDate?: string;
    status?: ProjectStatus; progress?: number;
    assigneeIds?: number[];
    managerId?: number | null;
    priority?: Priority | null;
  }) => Promise<void>;
  locked?: boolean;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [code, setCode] = useState(project?.code ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [startDate, setStartDate] = useState(project?.startDate ?? todayStr());
  const [endDate, setEndDate] = useState(project?.endDate ?? todayStr());

  // Etats DERIVÉS recalculés automatiquement (progression, statut, priorité)
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [progress, setProgress] = useState<number>(project?.progress ?? 0);
  const [saving, setSaving] = useState(false);
  const [priority, setPriority] = useState<Priority | "">((project?.priority as Priority) ?? "");

  const [assigneeIds, setAssigneeIds] = useState<number[]>(project?.assigneeIds ?? []);
  const [managerId, setManagerId] = useState<number | "">((project?.managerId as number) ?? "");

  const [err, setErr] = useState<string | null>(null);

  // Quand on ouvre/changera de projet, on re-initialise les champs
  useEffect(() => {
    setName(project?.name ?? "");
    setCode(project?.code ?? "");
    setDescription(project?.description ?? "");
    setStartDate(project?.startDate ?? todayStr());
    setEndDate(project?.endDate ?? todayStr());
    setStatus(project?.status ?? "active");
    setProgress(project?.progress ?? 0);
    setPriority((project?.priority as Priority) ?? "");
    setAssigneeIds(project?.assigneeIds ?? []);
    setManagerId((project?.managerId as number) ?? "");
    setErr(null);
    setSaving(false);
  }, [project, open]);

  // 🔁 Recalcul immédiat à chaque modification de dates
  useEffect(() => {
    if (!open) return;
    // Progression et statut selon les heures (08:00 -> 17:00)
    const now = new Date();
    const newProgress = computeProgressAuto(startDate, endDate, now);
    const newStatus = computeStatusAuto(status === "archived" ? "archived" : (project?.status ?? "active"), startDate, endDate, now);
    // Priority: a partir de la valeur utilisateur si précise, sinon "low"
    const currentBase = (priority === "" ? (project?.priority ?? "low") : priority) as Priority;
    const escalated = computePriorityFromProgress(currentBase, newProgress);

    setProgress(newProgress);
    if ((project?.status ?? "active") !== "archived") setStatus(newStatus); // ne pas écraser "archived"
    setPriority(escalated as Priority);
  }, [startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  function validate(): string | null {
    if (!name.trim()) return "Le nom est requis.";
    if (!code.trim()) return "Le code est requis.";
    if (!startDate || !endDate) return "Dates requises.";
    const sd = atLocal(startDate, "08:00").getTime();
    const ed = atLocal(endDate, "17:00").getTime();
    if (sd > ed) return "La date de fin doit être après (ou égale à) la date de début.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || !project) return;
    const v = validate(); if (v) { setErr(v); return; }
    setSaving(true);

    // 🔐 On envoie AUSSI les champs recalculés pour que l’API persiste
    const patch = {
      id: project.id,
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description.trim() || null,
      startDate,
      endDate,
      status,                 // recalculé
      progress,               // recalculé
      assigneeIds,
      managerId: managerId === "" ? null : Number(managerId),
      priority: (priority === "" ? null : (priority as Priority)), // déjà rehaussée si besoin
    };

    await onSave(patch);
    setSaving(false);
    onClose();
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
              <input
                type="date"
                value={startDate}
                onChange={(e)=>setStartDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none"
              />
              <div className="text-[11px] text-slate-500 mt-1">La progression se base sur <b>08:00</b> ce jour.</div>
            </div>
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">Fin (17:00 par défaut)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e)=>setEndDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none"
              />
              <div className="text-[11px] text-slate-500 mt-1">Heure de fin par défaut : <b>17:00</b></div>
            </div>

            {/* Infos calculées en direct */}
            <div className="md:col-span-2 grid gap-2 rounded-xl bg-slate-50/70 ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-600">
                Heures totales&nbsp;: <b>{Math.max(0, Math.round(totalHours))} h</b> • Unité/heure&nbsp;: <b>{unitPerHour ? unitPerHour.toFixed(2) : "—"}%</b>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[12px] text-slate-600">Progression recalculée :</span>
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
              <UserPicker users={users} value={assigneeIds} onChange={setAssigneeIds} disabled={!!locked} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5"><Flame className="w-4 h-4" /> Priorité (optionnel)</label>
              <select
                value={priority === "" ? "" : String(priority)}
                onChange={(e)=>setPriority(e.target.value === "" ? "" : (e.target.value as Priority))}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 outline-none"
              >
                <option value="">— Auto —</option>
                <option value="low">Basse (vert)</option>
                <option value="medium">Moyenne (orange)</option>
                <option value="high">Urgente (rouge)</option>
              </select>
              <div className="text-[11px] text-slate-500 mt-1">
                La priorité peut être <b>rehaussée automatiquement</b> à 50% et 70% selon la progression (elle ne baisse jamais).
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] text-slate-600 mb-1">Description</label>
              <textarea value={description ?? ""} onChange={(e)=>setDescription(e.target.value)} className="w-full min-h-[90px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none resize-y" />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 h-10 rounded-xl ring-1 ring-slate-200 hover:bg-slate-50">Fermer</button>
            {!locked && (
              <button disabled={saving} className={cls("px-4 h-10 rounded-xl text-white", saving ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700")}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

/* --------------------------------- Page ---------------------------------- */

/** Petits types utilitaires pour le fetch */
type ErrorResponse = { error: string };
function hasError(x: unknown): x is ErrorResponse {
  return typeof x === "object" && x !== null && "error" in x && typeof (x as Record<string, unknown>).error === "string";
}

/* fetch JSON robuste et typé */
async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const baseHeaders = new Headers(init?.headers || {});
  if (!baseHeaders.has("Accept")) baseHeaders.set("Accept", "application/json");
  let headers = new Headers(baseHeaders);
  try {
    const t = localStorage.getItem("auth_token");
    if (t) headers.set("Authorization", `Bearer ${t}`);
  } catch {
    // localStorage indisponible : ignorer
  }

  async function parse(res: Response): Promise<unknown> {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try { return await res.json(); } catch { return null; }
    }
    const text = await res.text();
    try { return JSON.parse(text); }
    catch {
      const preview = (text || "").replace(/\s+/g, " ").slice(0, 200);
      return { error: preview || "Réponse non-JSON" };
    }
  }

  let res = await fetch(url, { credentials: "include", ...init, headers });
  let data: unknown = await parse(res);

  if ((res.status === 401 || res.status === 403) && hasError(data) && /token invalide/i.test(data.error)) {
    try { localStorage.removeItem("auth_token"); } catch {}
    headers = new Headers(baseHeaders);
    res = await fetch(url, { credentials: "include", ...init, headers });
    data = await parse(res);
  }

  if (!res.ok) {
    throw new Error(hasError(data) ? data.error : `HTTP ${res.status}`);
  }
  return data as T;
}

/* ---------- Type guards pour éviter tout `any` dans les selects ---------- */
function isProjectStatusOrAll(v: string): v is "all" | ProjectStatus {
  return v === "all" || v === "planned" || v === "active" || v === "done" || v === "archived";
}
function isSortKey(v: string): v is "date" | "name" | "progress" {
  return v === "date" || v === "name" || v === "progress";
}

export default function ProjectsPage() {
  const [users, setUsers] = useState<UserLite[]>([]);
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filtres
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [sort, setSort] = useState<"date" | "name" | "progress">("date");
  const [managerFilter, setManagerFilter] = useState<number | "all">("all");

  // modales
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Project | null>(null);
  const [noteItem, setNoteItem] = useState<Project | null>(null);

  // rafraîchissement visuel chaque minute (progress/priorité/ statut temps-réel)
  const [clock, setClock] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // flags autosync pour PATCH unique
  const autoOnce = useRef<Set<number>>(new Set());

  /* --------------------------- Logique auto & badges ------------------------- */
  function normalizeProject(p: Partial<Project> & Record<string, unknown>): Project {
    return {
      ...(p as Project),
      progress: Math.max(0, Math.min(100, Number((p as Project)?.progress ?? 0))) || 0,
      assignees: Array.isArray(p?.assignees) ? (p.assignees as Project["assignees"]) : [],
      assigneeIds: Array.isArray(p?.assigneeIds) ? (p.assigneeIds as number[]) : [],
      managerId: typeof p?.managerId === "number" ? (p.managerId as number) : ((p?.manager as Project["manager"])?.id ?? null),
      priority: (p?.priority as Priority) ?? null,
    };
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [u, p] = await Promise.all([
          fetchJSON<{ items: UserLite[] }>("/api/users"),
          fetchJSON<{ items: Project[] }>("/api/projects"),
        ]);
        setUsers(u.items || []);
        setItems((p.items || []).map(normalizeProject));
        setErr(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg || "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Projections visuelles (progress temps, priorité & statut auto)
  const visualItems = useMemo(() => {
    const now = new Date(clock);
    return items.map(p => {
      const progressAuto = computeProgressAuto(p.startDate, p.endDate, now);
      const mergedProgress = Math.max(p.progress ?? 0, progressAuto);
      const visualStatus = computeStatusAuto(p.status, p.startDate, p.endDate, now);
      const escalatedPriority = computePriorityFromProgress(p.priority ?? "low", mergedProgress);
      return { ...p, progress: mergedProgress, status: visualStatus, priority: escalatedPriority };
    });
  }, [items, clock]);

  // Sync silencieuse côté API si on a mieux (statut, progression, PRIORITÉ réhaussée)
  useEffect(() => {
    (async () => {
      for (const p of visualItems) {
        if (p.status === "archived") continue;
        if (autoOnce.current.has(p.id)) continue;
        const base = items.find(x => x.id === p.id); if (!base) continue;
        const shouldPatch =
          (base.priority ?? "low") !== (p.priority ?? "low") ||
          base.status !== p.status ||
          (base.progress ?? 0) < (p.progress ?? 0);
        if (!shouldPatch) continue;
        try {
          autoOnce.current.add(p.id);
          const data = await fetchJSON<{ item: Project }>(`/api/projects/${p.id}`, {
            method: "PATCH",
            body: JSON.stringify({ priority: p.priority, status: p.status, progress: p.progress }),
          });
          setItems(arr => arr.map(x => (x.id === p.id ? normalizeProject(data.item) : x)));
        } catch {
          // on ignore les erreurs d'auto-sync
        }
      }
    })();
  }, [visualItems, items]);

  const stats = useMemo(() => {
    const total = visualItems.length;
    const planned = visualItems.filter(d => d.status === "planned").length;
    const active = visualItems.filter(d => d.status === "active").length;
    const done = visualItems.filter(d => d.status === "done").length;
    const archived = visualItems.filter(d => d.status === "archived").length;
    const avg = total ? Math.round(visualItems.reduce((s, d) => s + d.progress, 0) / total) : 0;
    return { total, planned, active, done, archived, avg };
  }, [visualItems]);

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

  /* ---------------------- Création via modale ---------------------- */
  function initialCode() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const rand = Math.floor(Math.random() * 900 + 100);
    return `PRJ-${y}${m}-${rand}`;
  }

  async function createProjectViaModal(payload: {
    name: string; code: string; description: string | null;
    startDate: string; endDate: string;
    assigneeIds: number[];
    managerId: number | "";
    priority: Priority | "";
  }) {
    const body: Record<string, unknown> = {
      name: payload.name,
      code: payload.code,
      description: payload.description,
      startDate: payload.startDate,
      endDate: payload.endDate,
      assigneeIds: payload.assigneeIds,
    };
    if (payload.managerId !== "") body.managerId = Number(payload.managerId);
    if (payload.priority !== "") body.priority = payload.priority;

    const data = await fetchJSON<{ item: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setItems(prev => [normalizeProject(data.item), ...prev]);
  }

  /* --------------------------- Actions ---------------------------- */
  async function saveProject(patch: {
    id: number; name?: string; code?: string; description?: string | null;
    startDate?: string; endDate?: string; status?: ProjectStatus; progress?: number;
    assigneeIds?: number[]; managerId?: number | null; priority?: Priority | null;
  }) {
    const data = await fetchJSON<{ item: Project }>(`/api/projects/${patch.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setItems(arr => arr.map(x => (x.id === patch.id ? normalizeProject(data.item) : x)));
  }

  async function markDone(id: number) {
    const data = await fetchJSON<{ item: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ complete: true }),
    });
    setItems(arr => arr.map(x => x.id === id ? normalizeProject(data.item) : x));
  }

  async function deleteProject(id: number) {
    if (!confirm("Supprimer définitivement ce projet ?")) return;
    try {
      await fetchJSON<unknown>(`/api/projects/${id}`, { method: "DELETE" });
      setItems(arr => arr.filter(x => x.id !== id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(msg || "Suppression impossible");
    }
  }

  async function addNote(id: number, text: string) {
    const data = await fetchJSON<{ note: Note }>(`/api/projects/${id}/notes`, {
      method: "POST", body: JSON.stringify({ text })
    });
    setItems(arr => arr.map(x => x.id === id ? { ...x, notes: [data.note, ...(x.notes || [])] } : x));
  }

  /* ----------------------------- Render ---------------------------- */
  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Projets">
      {/* En-tête dégradé + stats + CTA */}
      <section className="rounded-3xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-500 text-white p-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Projets</h1>
            <p className="text-white/90">
              Progression pilotée par le temps (08:00 → 17:00).&nbsp;
              Priorité rehaussée automatiquement à 50% et 70% de l’avancement.
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

      {/* Filtrer & trier */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 mt-2 mb-2 md:p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div className="text-[13px] text-slate-600">Filtrer et trier</div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Rechercher (nom, code, description, chef)…" className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none" />
            <select
              value={statusFilter}
              onChange={(e)=> setStatusFilter(isProjectStatusOrAll(e.target.value) ? e.target.value : "all")}
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="all">Tous les statuts</option>
              <option value="planned">En attente</option>
              <option value="active">En cours</option>
              <option value="done">Terminé</option>
              <option value="archived">Archivé</option>
            </select>
            <select value={managerFilter === "all" ? "all" : String(managerFilter)} onChange={(e)=>setManagerFilter(e.target.value === "all" ? "all" : Number(e.target.value))} className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
              <option value="all">Tous les chefs</option>
              {users.map(u => (<option key={u.id} value={u.id}>{u.name}</option>))}
            </select>
            <select
              value={sort}
              onChange={(e)=> setSort(isSortKey(e.target.value) ? e.target.value : "date")}
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="date">Tri par date</option>
              <option value="name">Tri par nom</option>
              <option value="progress">Tri par progression</option>
            </select>
          </div>
        </div>
      </section>

      {/* Liste — cartes */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading && <div className="col-span-full text-slate-500">Chargement…</div>}
        {err && !loading && <div className="col-span-full text-red-600">Erreur : {err}</div>}

        {!loading && !err && list.map(p => {
          const locked = p.status === "archived";
          const toneClass =
            p.status === "planned" ? "border-amber-200 bg-amber-50/60" :
            p.status === "active" ? "border-emerald-200 bg-emerald-50/60" :
            p.status === "done" ? "border-indigo-200 bg-indigo-50/60" :
            "border-slate-200 bg-slate-50/60";
          const barColor =
            p.status === "planned" ? ORANGE :
            p.status === "active" ? EMERALD :
            p.status === "done" ? BRAND : SLATE;

          return (
            <div key={p.id} className={cls("rounded-2xl border p-4 hover:shadow-lg transition", toneClass)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: barColor }} />
                    <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                    <Pill tone="indigo">{p.code}</Pill>
                  </div>
                  <div className="text-[12px] text-slate-600 mt-0.5">Du {fmt(p.startDate)} au {fmt(p.endDate)} (17:00)</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone={p.status==="planned"?"orange":p.status==="active"?"emerald":p.status==="done"?"indigo":"slate"}>
                    {p.status==="planned"?"En attente":p.status==="active"?"En cours":p.status==="done"?"Terminé":"Archivé"}
                  </Pill>
                  <PriorityBadge priority={p.priority} />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-white/70 ring-1 ring-slate-200 p-3">
                  <div className="text-[11px] text-slate-500">Chef de projet</div>
                  <div className="font-medium text-slate-900 truncate">{p.manager?.name || "—"}</div>
                </div>
                <div className="rounded-xl bg-white/70 ring-1 ring-slate-200 p-3">
                  <div className="text-[11px] text-slate-500">Progression</div>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={p.progress} color={barColor} />
                    <span className="text-[11px] text-slate-600 min-w-[2.2rem] text-right">{p.progress}%</span>
                  </div>
                </div>
              </div>

              {p.assignees?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.assignees.map(a => {
                    const hue = (a.id * 47) % 360;
                    return (
                      <span key={a.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ring-1"
                        style={{
                          background: `linear-gradient(90deg, hsl(${hue} 70% 97%), hsl(${hue} 70% 94%))`,
                          borderColor: `hsl(${hue} 45% 80%)`,
                          color: `hsl(${hue} 35% 28%)`,
                        }}>
                        <span className="w-4.5 h-4.5 rounded-full grid place-items-center text-[9px] font-semibold text-white"
                          style={{ backgroundColor: `hsl(${hue} 80% 45%)` }}>
                          {a.name.split(/\s+/).map(s => s[0]).join("").slice(0,2).toUpperCase()}
                        </span>
                        {a.name}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-slate-500">Aucun utilisateur assigné</div>
              )}

              {p.description && <div className="mt-3 text-[13px] text-slate-700 line-clamp-3">{p.description}</div>}

              {/* Actions */}
              <div className="mt-3">
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    onClick={()=>setNoteItem(p)}
                    className="inline-flex items-center gap-2 px-3 h-10 rounded-lg ring-1 ring-slate-200 hover:bg-white text-sm"
                    title="Ajouter une note"
                  >
                    <Plus className="w-4 h-4" /> Note
                  </button>
                  <button
                    onClick={()=>!locked && setEditItem(p)}
                    className={cls(
                      "inline-flex items-center gap-2 px-3 h-10 rounded-lg ring-1 ring-slate-200 text-sm",
                      locked ? "opacity-50 cursor-not-allowed" : "hover:bg-white"
                    )}
                    title={locked ? "Projet archivé" : "Modifier"}
                  >
                    <Pencil className="w-4 h-4" /> {locked ? "Verrouillé" : "Modifier"}
                  </button>
                  <button
                    onClick={()=>markDone(p.id)}
                    disabled={p.status === "done" || locked}
                    title={p.status === "done" ? "Déjà terminé" : "Marquer terminé"}
                    className={cls(
                      "inline-flex items-center gap-2 px-3 h-10 rounded-lg text-white text-sm",
                      (p.status === "done" || locked) ? "bg-slate-400 cursor-not-allowed" : "hover:opacity-95"
                    )}
                    style={{ backgroundColor: (p.status === "done" || locked) ? undefined : RED }}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Terminer
                  </button>
                  <button
                    onClick={()=>deleteProject(p.id)}
                    className="inline-flex items-center gap-2 px-3 h-10 rounded-lg ring-1 ring-red-200 hover:bg-red-50 text-sm text-red-700"
                    title="Supprimer définitivement"
                  >
                    <Trash2 className="w-4 h-4" /> Supprimer
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {!loading && !err && list.length === 0 && (
          <div className="col-span-full text-slate-500">Aucun projet.</div>
        )}
      </section>

      {/* Modales */}
      <CreateProjectModal
        open={createOpen}
        onClose={()=>setCreateOpen(false)}
        users={users}
        onCreate={createProjectViaModal}
        initialCode={initialCode()}
      />
      <EditProjectModal
        open={!!editItem}
        onClose={()=>setEditItem(null)}
        project={editItem}
        users={users}
        locked={!!editItem && editItem.status === "archived"}
        onSave={async (patch)=>{ await saveProject(patch); }}
      />
      <NoteModal
        open={!!noteItem}
        onClose={()=>setNoteItem(null)}
        onSubmit={async (text)=>{ if (noteItem) await addNote(noteItem.id, text); }}
      />
    </Shell>
  );
}
