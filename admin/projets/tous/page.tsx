"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Shell from "../../../components/Shell";
import Modal from "../../../components/ui/Modal";
import {
  FolderKanban, Users, UserPlus, UserCircle2, Link2, Plus, AlertCircle,
  CheckCircle2, Paperclip, FilePlus2, BadgeCheck, Eye, Crown, Trash2, Save, X, PencilLine, Flame
} from "lucide-react";

/* ================== Palette & helpers ================== */
const BRAND = "#3157d9";
const RED = "#d4333a";
const ORANGE = "#f59e0b";
const GREEN = "#16a34a";
const GRAY = "#6b7280";

type CSSBrandVar = React.CSSProperties & { ["--brand"]?: string };
const brandStyle: CSSBrandVar = { ["--brand"]: BRAND };

const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");

const fmt = (d?: string | null) => {
  if (!d) return "—";
  const dd = new Date(d);
  return isNaN(dd.getTime()) ? "—" : dd.toLocaleDateString();
};
function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function isYYYYMMDD(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function normalizeDateStr(s?: string | null, fallbackToToday = true): string {
  if (typeof s === "string") {
    if (isYYYYMMDD(s)) return s;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  }
  return fallbackToToday ? todayStr() : "";
}
/** Construit une Date locale en prenant l'heure HH:MM souhaitée (par défaut 17:00 pour la fin). */
function atLocal(dateStr?: string | null, hhmm: string = "00:00"): Date {
  const base = normalizeDateStr(dateStr, true);
  const [Y, M, D] = base.split("-").map(Number);
  const [h, m] = (hhmm || "00:00").split(":").map(n => Number.isFinite(Number(n)) ? Number(n) : 0);
  return new Date(Y, (M ?? 1) - 1, D ?? 1, h ?? 0, m ?? 0, 0, 0);
}

/* ================== Types ================== */
type RoleInTeam = "lead" | "member";
type TeamRoleOnProject = "owner" | "contributor" | "support";
type ProjectStatus = "planned" | "active" | "done" | "archived";
type Priority = "low" | "medium" | "high";

type UserLite = { id: number; name: string; email: string };
type Team = {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  leader_user_id?: number | null;
  leader_name?: string | null;
  leader_email?: string | null;
};
type TeamMember = { user_id: number; name: string; email: string; role_in_team: RoleInTeam };
type Project = {
  id: number; name: string; code: string; description: string | null;
  start_date?: string | null; end_date?: string | null; status: ProjectStatus; progress: number;
  priority?: Priority | null;
};
type ProjectNote = { id: number; project_id: number; user_id: number | null; text: string; created_at: string };
type ProjectFile = {
  id: number; project_id: number; user_id: number | null;
  storage_path: string | null; original_name: string; mime_type: string; size_bytes: number; uploaded_at: string
};
type ProjectTeamLink = { project_id: number; team_id: number; team_name: string; team_role: TeamRoleOnProject; member_count: number };
type TeamProjectLink = { project_id: number; project_code: string; project_name: string; team_role: TeamRoleOnProject };
type Me = { id: number; name: string; role: "superadmin"|"admin"|"user" };

/* ================== fetch JSON robuste ================== */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch {
    // localStorage indisponible (SSR/sandbox) — silencieux
  }

  const res = await fetch(url, { credentials: "include", redirect: "follow", ...init, headers });

  // Détection des réponses HTML (ex: redirection vers page, 404 SSR, etc.)
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const isHtml = ct.includes("text/html");
  const isJson = ct.includes("application/json");

  if (isHtml) {
    const html = await res.text();
    // extrait une “preview” courte pour l’UI
    const preview = html.replace(/\s+/g, " ").slice(0, 200);
    const msg = `Réponse HTML reçue depuis ${res.url} (probable redirection ou endpoint incorrect). Aperçu: ${preview}`;
    throw new Error(msg);
  }

  let data: unknown = null;
  if (isJson) {
    data = await res.json().catch(() => null as unknown);
  } else {
    const txt = await res.text();
    try { data = JSON.parse(txt) as unknown; }
    catch { data = { error: (txt||"").slice(0,200) || "Réponse non-JSON" }; }
  }

  // @ts-expect-error data pourrait contenir {error:string}
  if (!res.ok) throw new Error((data && (data as { error?: string }).error) || `HTTP ${res.status}`);

  return data as T;
}

/* ================== Logique statut / progression / priorité ================== */
/** Statut auto en tenant compte de 17:00 comme heure de fin par défaut. */
function computeStatusAuto(
  existing: ProjectStatus,
  startDate?: string | null,
  endDate?: string | null,
  nowParam?: Date
): ProjectStatus {
  if (existing === "archived") return "archived";
  const now = nowParam ?? new Date();
  const sd = atLocal(startDate, "00:00");
  const ed = atLocal(endDate, "17:00");
  if (now < sd) return "planned";
  if (now > ed) return "done";
  return "active";
}

/** Progression auto basée sur le temps (début 00:00, fin 17:00). Renvoie un pourcentage 0..100. */
function computeProgressAuto(
  startDate?: string | null,
  endDate?: string | null,
  nowParam?: Date
): number {
  const start = atLocal(startDate, "00:00");
  const end = atLocal(endDate, "17:00");
  const now = nowParam ?? new Date();
  const totalMs = Math.max(0, end.getTime() - start.getTime());
  if (totalMs === 0) return 100;
  const elapsedMs = Math.min(Math.max(0, now.getTime() - start.getTime()), totalMs);
  const pct = Math.round((elapsedMs / totalMs) * 100);
  return Math.max(0, Math.min(100, pct));
}

/** Priorité auto qui s'applique TOUJOURS (réhausse à 50% et 70%). */
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

const PriorityBadge = ({ p }: { p?: Priority | null }) => {
  const map: Record<Priority | "low", { label: string; color: string }> = {
    low: { label: "Basse",   color: GREEN },
    medium: { label: "Moyenne", color: ORANGE },
    high: { label: "Urgente", color: RED },
  };
  const { label, color } = map[p ?? "low"];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ring-1"
      style={{ backgroundColor: `${color}12`, color, borderColor: `${color}33` }}>
      <Flame className="w-3.5 h-3.5" /> {label}
    </span>
  );
};

const StatusPill = ({ s }: { s: ProjectStatus }) => {
  const color = s==="planned"?ORANGE: s==="active"?GREEN: s==="done"?RED: GRAY;
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] ring-1"
      style={{ backgroundColor: `${color}14`, color, borderColor: `${color}33` }}>
      {s==="planned"?"En attente":s==="active"?"En cours":s==="done"?"Terminé":"Archivé"}
    </span>
  );
};

const ProgressBar = ({ value, color=BRAND }: { value: number; color?: string }) => (
  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
    <div className="h-full" style={{ background: `linear-gradient(90deg, ${color}, ${color})`, width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

/* ================== Sélecteur Utilisateurs ================== */
function UserPicker({
  users, value, onChange, disabled, placeholder="Rechercher un utilisateur…"
}: {
  users: UserLite[];
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(u => (u.name+u.email).toLowerCase().includes(s));
  }, [users, q]);

  function toggle(id: number) {
    if (value.includes(id)) onChange(value.filter(v=>v!==id));
    else onChange([...value, id]);
  }

  return (
    <div className={cls("rounded-xl ring-1 ring-slate-200 p-2 bg-white/70", disabled && "opacity-50 pointer-events-none")}>
      <div className="flex items-center gap-2 mb-2">
        <input
          value={q} onChange={e=>setQ(e.target.value)}
          className="h-9 flex-1 px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none text-sm bg-white"
          placeholder={placeholder}
          style={brandStyle}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.length===0 ? (
          <span className="text-[12px] text-slate-500">Aucun utilisateur sélectionné.</span>
        ) : value.map(id => {
          const u = users.find(x=>x.id===id);
          if (!u) return null;
          return (
            <span key={id} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 inline-flex items-center gap-1">
              {u.name}
              <button type="button" onClick={()=>toggle(id)} className="hover:text-indigo-900"><X className="w-3 h-3" /></button>
            </span>
          );
        })}
      </div>
      <div className="max-h-56 overflow-auto pr-1 space-y-1">
        {filtered.map(u => (
          <label key={u.id} className="flex items-center gap-2 text-[13px] px-2 py-1 rounded-lg hover:bg-slate-50">
            <input type="checkbox" checked={value.includes(u.id)} onChange={()=>toggle(u.id)} />
            <span className="truncate">
              <span className="font-medium text-slate-800">{u.name}</span>
              <span className="text-[11px] text-slate-500 ml-1">— {u.email}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ================== UI utils ================== */
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-[12px] text-slate-600 mb-1">
    {label}
    <div className="mt-1">{children}</div>
  </label>
);

/* ================== Modales ================== */
function ProjectDetailsModal({
  open, onClose, project, links, notes, files,
  onAddNote, onUploadPdf, onPreview, onDeletePdf,
  visualProgress, visualStatus, visualPriority, totalHours
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  links: ProjectTeamLink[];
  notes: ProjectNote[];
  files: ProjectFile[];
  onAddNote: (text: string) => Promise<void>;
  onUploadPdf: (file: File) => Promise<void>;
  onPreview: (fileId: number) => void;
  onDeletePdf: (fileId: number) => Promise<void>;
  visualProgress: number;
  visualStatus: ProjectStatus;
  visualPriority: Priority | null | undefined;
  totalHours: number;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(()=>{ setNote(""); setSending(false); }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={project ? `Projet — ${project.name}` : "Projet"} size="xl">
      {!project ? null : (
        <div className="space-y-4">
          {/* Période + Statut + Priorité + Progression */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Période du projet</div>
              <div className="text-sm text-slate-900">
                {fmt(project.start_date)} → {fmt(project.end_date)} <span className="text-[11px] text-slate-500">(fin 17:00)</span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">Durée totale ~ {Math.round(totalHours)} h</div>
            </div>
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Statut</div>
              <div className="text-sm text-slate-900"><StatusPill s={visualStatus} /></div>
            </div>
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Priorité</div>
              <div className="text-sm text-slate-900"><PriorityBadge p={visualPriority ?? "low"} /></div>
            </div>
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Progression</div>
              <div className="space-y-1">
                <ProgressBar value={Number(visualProgress || 0)} />
                <div className="text-[12px] text-slate-600">{Number(visualProgress || 0)}%</div>
              </div>
            </div>
          </div>

          {project.description && (
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Description</div>
              <div className="text-sm text-slate-800">{project.description}</div>
            </div>
          )}

          {/* Équipes */}
          <div className="rounded-xl ring-1 ring-slate-200 p-3">
            <div className="text-[12px] text-slate-500 mb-1">Équipes liées</div>
            <div className="flex flex-wrap gap-1">
              {links.length ? links.map(l => (
                <span key={`${l.team_id}-${l.team_role}`} className="text-[11px] px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200">
                  {l.team_name} — {l.team_role} • {l.member_count}
                </span>
              )) : <span className="text-[12px] text-slate-500">Aucune équipe.</span>}
            </div>
          </div>

          {/* Notes & PDFs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Notes */}
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500 mb-2">Notes</div>
              <ul className="space-y-1 mb-2 max-h-56 md:max-h-48 overflow-auto pr-1">
                {notes.length ? notes.map(n => <li key={n.id} className="text-[13px] text-slate-800">• {n.text}</li>) : <li className="text-[12px] text-slate-500">Aucune note.</li>}
              </ul>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input value={note} onChange={(e)=>setNote(e.target.value)} className="h-9 flex-1 px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none"
                       placeholder="Ajouter une note…" style={brandStyle} />
                <button
                  onClick={async ()=>{ if(!note.trim()) return; setSending(true); await onAddNote(note.trim()); setNote(""); setSending(false); }}
                  disabled={!note.trim() || sending}
                  className={cls("h-9 px-3 rounded-lg text-white text-sm w-full sm:w-auto", !note.trim()||sending ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-700 hover:bg-indigo-800")}
                >
                  Ajouter
                </button>
              </div>
            </div>

            {/* Fichiers (superadmin: supprimer / ajouter) */}
            <ProjectFilesPanel
              files={files}
              onPreview={onPreview}
              onUpload={async f => { await onUploadPdf(f); }}
              onDelete={onDeletePdf}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProjectFilesPanel({
  files, onPreview, onUpload, onDelete
}: {
  files: ProjectFile[];
  onPreview: (fileId: number) => void;
  onUpload: (file: File) => Promise<void>;
  onDelete: (fileId: number) => Promise<void>;
}) {
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    (async () => {
      try { const m = await fetchJSON<Me>("/api/me"); setMe(m); } catch { setMe(null); }
    })();
  }, []);

  const canManage = me?.role === "superadmin";

  return (
    <div className="rounded-xl ring-1 ring-slate-200 p-3">
      <div className="text-[12px] text-slate-500 mb-2">Fichiers (PDF)</div>
      <ul className="space-y-1 mb-2 max-h-56 md:max-h-48 overflow-auto pr-1">
        {files.length ? files.map(f => (
          <li key={f.id} className="text-[13px] text-slate-800 flex items-center justify-between gap-2">
            <div className="truncate">
              <Paperclip className="inline w-3.5 h-3.5 mr-1" />
              {f.original_name} <span className="text-[11px] text-slate-500">({Math.round((f.size_bytes||0)/1024)} Ko)</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>onPreview(f.id)} className="text-indigo-700 hover:text-indigo-800 text-[12px] inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />Prévisualiser</button>
              {canManage && (
                <button onClick={async ()=>{ setBusy(true); await onDelete(f.id); setBusy(false); }}
                        className="text-rose-600 hover:text-rose-700 text-[12px] inline-flex items-center gap-1 disabled:opacity-60"
                        disabled={busy}>
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer
                </button>
              )}
            </div>
          </li>
        )) : <li className="text-[12px] text-slate-500">Aucun fichier.</li>}
      </ul>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <input
          type="file" accept="application/pdf"
          onChange={(e)=> setSelectedPdf(e.currentTarget.files?.[0] ?? null)}
          className="block w-full text-[12px] file:mr-2 file:rounded-lg file:bg-slate-100 file:px-2 file:py-1 file:text-[12px] file:text-slate-700"
          disabled={!canManage}
        />
        <button
          onClick={async ()=>{ if(!selectedPdf || !canManage) return; setBusy(true); await onUpload(selectedPdf); setSelectedPdf(null); (document.activeElement as HTMLElement | null)?.blur(); setBusy(false); }}
          disabled={!selectedPdf || !canManage || busy}
          className={cls("h-9 px-3 rounded-lg text-white text-sm w-full sm:w-auto", !selectedPdf || !canManage || busy ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-700 hover:bg-indigo-800")}
        >
          Importer
        </button>
      </div>
      {!canManage && <div className="text-[11px] text-slate-500 mt-1">Seul le superadmin peut ajouter ou supprimer des PDF.</div>}
    </div>
  );
}

function TeamDetailsModal({
  open, onClose, team, members, projects,
  users,
  onRemoveMember,
  onSaveTeam,
  onDeleteTeam
}: {
  open: boolean;
  onClose: () => void;
  team: Team | null;
  members: TeamMember[];
  projects: TeamProjectLink[];
  users: UserLite[];
  onRemoveMember: (userId: number) => Promise<void>;
  onSaveTeam: (payload: { name: string; description: string | null; leaderUserId: number | null }) => Promise<void>;
  onDeleteTeam: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState<string>("");
  const [leaderId, setLeaderId] = useState<string>(""); // string state
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!team) return;
    setName(team.name || "");
    setDesc(team.description || "");
    setLeaderId(team.leader_user_id ? String(team.leader_user_id) : "");
  }, [team]);

  return (
    <Modal open={open} onClose={onClose} title={team ? `Équipe — ${team.name}` : "Équipe"} size="lg">
      {!team ? null : (
        <div className="space-y-4">
          {/* Edition infos */}
          <div className="rounded-xl ring-1 ring-slate-200 p-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-[12px] text-slate-500 mb-1">Informations</div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button
                  onClick={async ()=>{ 
                    setBusy(true); 
                    await onSaveTeam({ 
                      name, 
                      description: (desc ?? "").trim() || null, 
                      leaderUserId: leaderId ? Number(leaderId) : null 
                    }); 
                    setBusy(false); 
                  }}
                  className={cls("h-8 px-3 rounded-lg text-white text-[12px] inline-flex items-center gap-1 justify-center", busy ? "bg-slate-400 cursor-not-allowed":"bg-indigo-700 hover:bg-indigo-800")}
                  disabled={busy}
                ><Save className="w-4 h-4" /> Enregistrer</button>

                <button
                  onClick={()=>setConfirmDelete(true)}
                  className="h-8 px-3 rounded-lg text-white bg-rose-600 hover:bg-rose-700 text-[12px] inline-flex items-center gap-1 justify-center"
                ><Trash2 className="w-4 h-4" /> Supprimer</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <Field label="Nom de l’équipe">
                <input value={name} onChange={(e)=>setName(e.target.value)} className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none" style={brandStyle}/>
              </Field>
              <Field label="Chef d’équipe">
                <select value={leaderId} onChange={(e)=>setLeaderId(e.target.value)}
                        className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none" style={brandStyle}>
                  <option value="">— Aucun —</option>
                  {users.map(u => (<option key={u.id} value={String(u.id)}>{u.name}</option>))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description">
                  <input value={desc} onChange={(e)=>setDesc(e.target.value)} className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none" placeholder="Facultatif" style={brandStyle}/>
                </Field>
              </div>
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 p-3">
            <div className="text-[12px] text-slate-500 mb-1">Membres</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-64 md:max-h-56 overflow-auto pr-1">
              {members.length ? members.map(m => (
                <div key={m.user_id} className="text-[13px] text-slate-800 truncate flex items-center justify-between gap-2">
                  <div className="truncate">• {m.name} <span className="text-[11px] text-slate-500">({m.role_in_team})</span></div>
                  <button
                    onClick={()=>onRemoveMember(m.user_id)}
                    className="text-rose-600 hover:text-rose-700 text-[12px] inline-flex items-center gap-1"
                    title="Retirer du groupe"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Retirer
                  </button>
                </div>
              )) : <div className="text-[12px] text-slate-500">Aucun membre.</div>}
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 p-3">
            <div className="text-[12px] text-slate-500 mb-1">Projets liés</div>
            <div className="space-y-1 max-h-64 md:max-h-56 overflow-auto pr-1">
              {projects.length ? projects.map(p => (
                <div key={p.project_id} className="text-[13px] text-slate-800 truncate">
                  • {p.project_code} — {p.project_name} <span className="text-[11px] text-slate-500">({p.team_role})</span>
                </div>
              )) : <div className="text-[12px] text-slate-500">Aucun projet lié.</div>}
            </div>
          </div>

          {confirmDelete && (
            <div className="rounded-xl ring-1 ring-rose-200 bg-rose-50 p-3">
              <div className="text-sm text-rose-700 mb-2">Voulez-vous vraiment supprimer cette équipe ? Cette action est irréversible.</div>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={()=>setConfirmDelete(false)} className="h-8 px-3 rounded-lg ring-1 ring-slate-300 hover:bg-slate-50 text-[12px]">Annuler</button>
                <button onClick={async ()=>{ await onDeleteTeam(); }} className="h-8 px-3 rounded-lg text-white bg-rose-600 hover:bg-rose-700 text-[12px] inline-flex items-center gap-1"><Trash2 className="w-4 h-4" /> Supprimer</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function PdfPreviewModal({ open, onClose, src }: { open: boolean; onClose: () => void; src: string | null }) {
  return (
    <Modal open={open} onClose={onClose} title="Prévisualisation PDF" size="xl">
      {!src ? <div className="text-sm text-slate-500">Aucun fichier.</div> : (
        <div className="h-[70vh]">
          <iframe src={src} className="w-full h-full rounded-lg ring-1 ring-slate-200" />
        </div>
      )}
    </Modal>
  );
}

/* ================== Page ================== */
export default function ProjectsTeamsPage() {
  /* --- Data --- */
  const [users, setUsers] = useState<UserLite[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamMembers, setTeamMembers] = useState<Record<number, TeamMember[]>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectTeams, setProjectTeams] = useState<ProjectTeamLink[]>([]);
  const [projectNotes, setProjectNotes] = useState<Record<number, ProjectNote[]>>({});
  const [projectFiles, setProjectFiles] = useState<Record<number, ProjectFile[]>>({});

  /* détails modales */
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [detailTeam, setDetailTeam] = useState<Team | null>(null);
  const [teamProjects, setTeamProjects] = useState<TeamProjectLink[]>([]);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /* --- Création / Edition Team --- */
  const [tName, setTName] = useState("");
  const [tDesc, setTDesc] = useState("");
  const [tLeader, setTLeader] = useState<string>(""); // string
  const [tUsersToAdd, setTUsersToAdd] = useState<number[]>([]);

  /* --- Affectations --- */
  const [selTeam, setSelTeam] = useState<string>("");         // string
  const [selUsersToAdd, setSelUsersToAdd] = useState<number[]>([]);
  const [selProject, setSelProject] = useState<string>("");   // string
  const [selProjectTeam, setSelProjectTeam] = useState<string>(""); // string
  const [selTeamRole, setSelTeamRole] = useState<TeamRoleOnProject>("contributor");

  /* Tick pour progression/priorité dynamiques (temps réel) */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 60_000); // recalcul chaque 60s
    return () => window.clearInterval(id);
  }, []);

  /* SSE ref pour cleanup */
  const sseRef = useRef<EventSource | null>(null);
  const autoOnce = useRef<Set<string>>(new Set()); // clé minute

  /* --- Chargement initial + SSE --- */
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [u, t, p, links] = await Promise.all([
          fetchJSON<{ items: UserLite[] }>("/api/projects-teams/users-lite"),
          fetchJSON<{ items: Team[] }>("/api/teams"),
          fetchJSON<{ items: Project[] }>("/api/projects"),
          fetchJSON<{ items: ProjectTeamLink[] }>("/api/projects-teams/links"),
        ]);
        setUsers(u.items || []);
        setTeams(t.items || []);
        setProjects(p.items || []);
        setProjectTeams(links.items || []);

        const tm: Record<number, TeamMember[]> = {};
        await Promise.all((t.items || []).map(async (team) => {
          const data = await fetchJSON<{ items: TeamMember[] }>(`/api/teams/${team.id}/members`);
          tm[team.id] = data.items || [];
        }));
        setTeamMembers(tm);

        const notesObj: Record<number, ProjectNote[]> = {};
        const filesObj: Record<number, ProjectFile[]> = {};
        await Promise.all((p.items || []).map(async (prj) => {
          const [n, f] = await Promise.all([
            fetchJSON<{ items: ProjectNote[] }>(`/api/projects/${prj.id}/notes`),
            fetchJSON<{ items: ProjectFile[] }>(`/api/projects/${prj.id}/files`),
          ]);
          notesObj[prj.id] = n.items || [];
          filesObj[prj.id] = f.items || [];
        }));
        setProjectNotes(notesObj); setProjectFiles(filesObj);

        setErr(null);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    })();

    // --- Abonnement SSE (temps réel serveur) ---
    try {
      const es = new EventSource("/api/projects-teams/stream", { withCredentials: true });
      sseRef.current = es;

      const parseAnd = <T,>(data: string, fn: (v: T)=>void) => { try { fn(JSON.parse(data) as T); } catch { /* ignore */ } };

      es.addEventListener("users", (e: Event) => {
        const me = e as MessageEvent;
        parseAnd<{items:UserLite[]}>(me.data, d => setUsers(d.items||[]));
      });
      es.addEventListener("teams", (e: Event) => {
        const me = e as MessageEvent;
        parseAnd<{items:Team[]}>(me.data, d => setTeams(d.items||[]));
      });
      es.addEventListener("teamMembers", (e: Event) => {
        const me = e as MessageEvent;
        parseAnd<{teamId:number, items:TeamMember[]}>(me.data, d => setTeamMembers(s=>({ ...s, [d.teamId]: d.items||[] })));
      });
      es.addEventListener("projects", (e: Event) => {
        const me = e as MessageEvent;
        parseAnd<{items:Project[]}>(me.data, d => setProjects(d.items||[]));
      });
      es.addEventListener("projectTeams", (e: Event) => {
        const me = e as MessageEvent;
        parseAnd<{items:ProjectTeamLink[]}>(me.data, d => setProjectTeams(d.items||[]));
      });
      es.addEventListener("projectNotes", (e: Event) => {
        const me = e as MessageEvent;
        parseAnd<{projectId:number, items:ProjectNote[]}>(me.data, d => setProjectNotes(s=>({ ...s, [d.projectId]: d.items||[] })));
      });
      es.addEventListener("projectFiles", (e: Event) => {
        const me = e as MessageEvent;
        parseAnd<{projectId:number, items:ProjectFile[]}>(me.data, d => setProjectFiles(s=>({ ...s, [d.projectId]: d.items||[] })));
      });
    } catch {
      /* no-op */
    }

    return () => { sseRef.current?.close(); sseRef.current = null; };
  }, []);

  /* ---- Visual compute (progress+priority+status) ---- */
  const visualProjects = useMemo(() => {
    // utilisation de tick (via offset 0) pour satisfaire linter et déclencher recalcul
    const now = new Date(Date.now() + tick * 0);
    return projects.map(p => {
      const autoProgress = computeProgressAuto(p.start_date, p.end_date, now);
      const mergedProgress = Math.max(Number(p.progress || 0), autoProgress);
      const escalatedPriority = computePriorityFromProgress(p.priority ?? "low", mergedProgress);
      const autoStatusByDates = computeStatusAuto(p.status, p.start_date, p.end_date, now);
      const visualStatus: ProjectStatus = mergedProgress >= 100 ? "done" : autoStatusByDates;

      return { ...p, progress: mergedProgress, status: visualStatus, priority: escalatedPriority };
    });
  }, [projects, tick]); // recalcul chaque minute grâce à tick

  // Persist (patch minute) si progression / priorité / statut changent
  useEffect(() => {
    (async () => {
      for (const p of visualProjects) {
        if (p.status === "archived") continue;
        const base = projects.find(x => x.id === p.id);
        if (!base) continue;

        const changed =
          (base.priority ?? "low") !== (p.priority ?? "low") ||
          base.status !== p.status ||
          (Number(base.progress || 0) < Number(p.progress || 0));

        // Empêche les PATCH multiples la même minute
        const key = `${p.id}:${Math.floor(Date.now()/60000)}`;
        if (!changed || autoOnce.current.has(key)) continue;

        try {
          autoOnce.current.add(key);
          await fetchJSON(`/api/projects/${p.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              priority: p.priority,
              status: p.status,
              progress: p.progress,
            }),
          });
        } catch {
          /* ignore */
        }
      }
    })();
  }, [visualProjects, projects]);

  const teamsWithCounts = useMemo(() => (
    teams.map(t => ({ ...t, count: (teamMembers[t.id] || []).length }))
  ), [teams, teamMembers]);

  const linksByProject = useMemo(() => {
    const m: Record<number, ProjectTeamLink[]> = {};
    projectTeams.forEach(l => { (m[l.project_id] ||= []).push(l); });
    return m;
  }, [projectTeams]);

  /* ================== Actions ================== */

  // --- Team CRUD / Members ---
  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!tName.trim()) return;
    const data = await fetchJSON<{ item: Team }>("/api/teams", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tName.trim(), description: tDesc.trim() || null, leaderUserId: tLeader ? Number(tLeader) : undefined }),
    });
    const newTeam = data.item;
    setTeams([newTeam, ...teams]);
    if (tUsersToAdd.length) {
      await fetchJSON(`/api/teams/${newTeam.id}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: tUsersToAdd, role: "member" as RoleInTeam }),
      });
      const mem = await fetchJSON<{ items: TeamMember[] }>(`/api/teams/${newTeam.id}/members`);
      setTeamMembers(s => ({ ...s, [newTeam.id]: mem.items || [] }));
    }
    setTName(""); setTDesc(""); setTLeader(""); setTUsersToAdd([]);
  }

  async function updateTeam(teamId: number, payload: { name?: string; description?: string|null; leaderUserId?: number|null }) {
    await fetchJSON(`/api/teams/${teamId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const mem = await fetchJSON<{ items: TeamMember[] }>(`/api/teams/${teamId}/members`);
    setTeamMembers(s => ({ ...s, [teamId]: mem.items || [] }));
    const all = await fetchJSON<{ items: Team[] }>("/api/teams");
    setTeams(all.items || []);
  }

  async function deleteTeam(teamId: number) {
    await fetchJSON(`/api/teams/${teamId}`, { method: "DELETE" });
    setTeams(teams.filter(t=>t.id!==teamId));
    const tm = { ...teamMembers }; delete tm[teamId]; setTeamMembers(tm);
  }

  async function addMembersToTeam() {
    if (!selTeam || selUsersToAdd.length === 0) return;
    await fetchJSON(`/api/teams/${Number(selTeam)}/members`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: selUsersToAdd, role: "member" as RoleInTeam }),
    });
    const data = await fetchJSON<{ items: TeamMember[] }>(`/api/teams/${Number(selTeam)}/members`);
    setTeamMembers(s => ({ ...s, [Number(selTeam)]: data.items || [] }));
    setSelUsersToAdd([]);
  }

  async function removeMemberFromTeam(teamId: number, userId: number) {
    await fetchJSON(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
    const data = await fetchJSON<{ items: TeamMember[] }>(`/api/teams/${teamId}/members`);
    setTeamMembers(s => ({ ...s, [teamId]: data.items || [] }));
  }

  // --- Liens Projet/Équipe ---
  async function linkTeamToProject() {
    if (!selProject || !selProjectTeam) return;
    await fetchJSON(`/api/projects/${Number(selProject)}/teams`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: Number(selProjectTeam), teamRole: selTeamRole }),
    });
    const links = await fetchJSON<{ items: ProjectTeamLink[] }>("/api/projects-teams/links");
    setProjectTeams(links.items || []);
  }

  async function addNoteToProject(pid: number, text: string) {
    const n = await fetchJSON<{ note: ProjectNote }>(`/api/projects/${pid}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    setProjectNotes(s => ({ ...s, [pid]: [n.note, ...(s[pid] || [])] }));
  }

  async function uploadPdfToProject(pid: number, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const headers: HeadersInit = {};
    try { const t = localStorage.getItem("auth_token"); if (t) headers["Authorization"] = `Bearer ${t}`; } catch { /* ignore */ }
    const res = await fetch(`/api/projects/${pid}/files/upload`, { method: "POST", body: fd, headers, credentials: "include" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Échec upload");
    const f = await fetchJSON<{ items: ProjectFile[] }>(`/api/projects/${pid}/files`);
    setProjectFiles(s => ({ ...s, [pid]: f.items || [] }));
  }

  async function deletePdfFromProject(pid: number, fileId: number) {
    await fetchJSON(`/api/projects/${pid}/files/${fileId}`, { method: "DELETE" });
    const f = await fetchJSON<{ items: ProjectFile[] }>(`/api/projects/${pid}/files`);
    setProjectFiles(s => ({ ...s, [pid]: f.items || [] }));
  }

  function openProjectDetails(p: Project) { setDetailProject(p); }
  async function openTeamDetails(t: Team) {
    setDetailTeam(t);
    const tp = await fetchJSON<{ items: TeamProjectLink[] }>(`/api/teams/${t.id}/projects`);
    setTeamProjects(tp.items || []);
  }

  function openPdf(pid: number, fileId: number) {
    setPdfSrc(`/api/projects/${pid}/files/${fileId}/content`);
    setPdfOpen(true);
  }

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Projets & Équipes">
      <main className="space-y-6">
        {err && <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"><AlertCircle className="w-4 h-4" /> {err}</div>}
        {loading && !err && <div className="text-sm text-slate-500">Chargement…</div>}

        {/* ======== Ligne 1 : Création équipe ======== */}
        <div className="grid grid-cols-1 gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-indigo-700" />
              <h2 className="text-sm md:text-base font-semibold text-slate-900">Créer une équipe</h2>
            </div>
            <form onSubmit={createTeam} className="grid grid-cols-1 md:grid-cols-6 gap-2">
              <div className="md:col-span-2">
                <Field label="Nom">
                  <input value={tName} onChange={(e)=>setTName(e.target.value)} className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none" placeholder="Ex. Backend" style={brandStyle} />
                </Field>
              </div>
              <div className="md:col-span-3">
                <Field label="Description">
                  <input value={tDesc} onChange={(e)=>setTDesc(e.target.value)} className="h-9 w-full px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none" placeholder="Facultatif" style={brandStyle} />
                </Field>
              </div>
              <div className="md:col-span-1">
                <Field label="Chef d’équipe (optionnel)">
                  <select value={tLeader} onChange={(e)=>setTLeader(e.target.value)}
                          className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none" style={brandStyle}>
                    <option value="">— Aucun —</option>
                    {users.map(u => (<option key={u.id} value={String(u.id)}>{u.name}</option>))}
                  </select>
                </Field>
              </div>

              <div className="md:col-span-6">
                <Field label="Ajouter des membres (facultatif)">
                  <UserPicker users={users} value={tUsersToAdd} onChange={setTUsersToAdd} />
                </Field>
              </div>

              <div className="md:col-span-1 md:col-start-6 flex items-end">
                <button className="h-9 w-full rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-sm inline-flex items-center justify-center gap-1">
                  <Plus className="w-4 h-4" /> Créer
                </button>
              </div>
            </form>
          </section>
        </div>

        {/* ======== Ligne 2 : Affectations ======== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Ajouter des membres à une équipe */}
          <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <UserPlus className="w-4 h-4 text-indigo-700" />
              <h2 className="text-sm md:text-base font-semibold text-slate-900">Ajouter des membres à une équipe</h2>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Field label="Équipe">
                <select value={selTeam} onChange={(e)=>setSelTeam(e.target.value)}
                  className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none" style={brandStyle}>
                  <option value="">— Choisir —</option>
                  {teamsWithCounts.map(t => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name}{t.leader_user_id ? " ⭐" : ""} ({t.count})
                    </option>))}
                </select>
              </Field>
              <Field label="Utilisateurs">
                <UserPicker users={users} value={selUsersToAdd} onChange={setSelUsersToAdd} disabled={!selTeam}/>
              </Field>
              <div className="flex justify-end">
                <button onClick={addMembersToTeam}
                        disabled={!selTeam || selUsersToAdd.length===0}
                        className={cls("h-9 px-3 rounded-lg text-white text-sm inline-flex items-center gap-1",
                          !selTeam || selUsersToAdd.length===0 ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-700 hover:bg-indigo-800")}>
                  <BadgeCheck className="w-4 h-4" /> Valider
                </button>
              </div>
            </div>
          </section>

          {/* Lier une équipe à un projet */}
          <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="w-4 h-4 text-indigo-700" />
              <h2 className="text-sm md:text-base font-semibold text-slate-900">Lier une équipe à un projet</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Field label="Projet">
                <select value={selProject} onChange={(e)=>setSelProject(e.target.value)}
                  className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none" style={brandStyle}>
                  <option value="">— Choisir —</option>
                  {visualProjects.map(p => (<option key={p.id} value={String(p.id)}>{p.code} — {p.name}</option>))}
                </select>
              </Field>
              <Field label="Équipe">
                <select value={selProjectTeam} onChange={(e)=>setSelProjectTeam(e.target.value)}
                  className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none" style={brandStyle}>
                  <option value="">— Choisir —</option>
                  {teams.map(t => (<option key={t.id} value={String(t.id)}>{t.name}</option>))}
                </select>
              </Field>
              <Field label="Rôle">
                <select value={selTeamRole} onChange={(e)=>setSelTeamRole(e.target.value as TeamRoleOnProject)}
                        className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none" style={brandStyle}>
                  <option value="owner">Propriétaire</option>
                  <option value="contributor">Contributeur</option>
                  <option value="support">Soutien</option>
                </select>
              </Field>
              <div className="md:col-span-3 flex justify-end">
                <button onClick={linkTeamToProject}
                        disabled={!selProject || !selProjectTeam}
                        className={cls("h-9 px-3 rounded-lg text-white text-sm inline-flex items-center gap-1",
                          !selProject || !selProjectTeam ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-700 hover:bg-indigo-800")}>
                  <CheckCircle2 className="w-4 h-4" /> Lier
                </button>
              </div>
            </div>
          </section>

          {/* Notes/Fichiers rapides */}
          <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <FilePlus2 className="w-4 h-4 text-indigo-700" />
              <h2 className="text-sm md:text-base font-semibold text-slate-900">Notes & PDF (rapide)</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Field label="Projet">
                <select value={selProject} onChange={(e)=>setSelProject(e.target.value)}
                  className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none" style={brandStyle}>
                  <option value="">— Choisir —</option>
                  {visualProjects.map(p => (<option key={p.id} value={String(p.id)}>{p.code} — {p.name}</option>))}
                </select>
              </Field>

              <div className="md:col-span-2 rounded-xl ring-1 ring-slate-200 p-2">
                <div className="text-[12px] text-slate-500 mb-1">Nouvelle note</div>
                <QuickNote
                  pid={selProject ? Number(selProject) : 0}
                  onAdd={async (txt) => {
                    if (!selProject) return;
                    await addNoteToProject(Number(selProject), txt);
                  }}
                />
              </div>

              <div className="md:col-span-2 rounded-xl ring-1 ring-slate-200 p-2">
                <div className="text-[12px] text-slate-500 mb-1">Ajouter un PDF</div>
                <QuickPdf
                  pid={selProject ? Number(selProject) : 0}
                  disabled={!selProject}
                  onUpload={async (file) => {
                    if (!selProject) return;
                    await uploadPdfToProject(Number(selProject), file);
                  }}
                />
              </div>
            </div>
          </section>
        </div>

        {/* ======== Ligne 3 : Listes ======== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Équipes */}
          <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <UserCircle2 className="w-4 h-4 text-indigo-700" />
                <h2 className="text-sm md:text-base font-semibold text-slate-900">Équipes</h2>
              </div>
            </div>
            <div className="divide-y divide-slate-200">
              {teamsWithCounts.map(t => (
                <div key={t.id} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate flex items-center gap-1">
                        {t.name}
                        {t.leader_user_id ? (
                          <span title={t.leader_name || "Chef d'équipe"} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-200">
                            <Crown className="w-3.5 h-3.5" />
                            {t.leader_name || "Chef"}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[12px] text-slate-500 truncate">{t.description || "—"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[12px] bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 rounded-lg px-2 py-0.5">
                        {t.count} membre{t.count>1?"s":""}
                      </div>
                      <button onClick={()=>openTeamDetails(t)} className="h-8 px-2 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-[12px]">
                        <span className="inline-flex items-center gap-1"><PencilLine className="w-4 h-4" /> Détails</span>
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {(teamMembers[t.id]||[]).slice(0,6).map(m => (
                      <div key={m.user_id} className="text-[13px] text-slate-700 truncate">
                        • {m.name} <span className="text-[11px] text-slate-500">({m.role_in_team})</span>
                      </div>
                    ))}
                    {(teamMembers[t.id]||[]).length===0 && (<div className="text-[12px] text-slate-500">Aucun membre.</div>)}
                  </div>
                </div>
              ))}
              {(teamsWithCounts.length===0) && (<div className="py-2 text-sm text-slate-500">Aucune équipe.</div>)}
            </div>
          </section>

          {/* Projets */}
          <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <FolderKanban className="w-4 h-4 text-indigo-700" />
              <h2 className="text-sm md:text-base font-semibold text-slate-900">Projets</h2>
            </div>
            <div className="space-y-3">
              {visualProjects.map(p => {
                const links = linksByProject[p.id] || [];
                const notes = projectNotes[p.id] || [];
                const files = projectFiles[p.id] || [];
                const statusColor =
                  p.status === "planned" ? ORANGE :
                  p.status === "active" ? GREEN :
                  p.status === "done" ? RED : GRAY;

                // durée visible (approx) pour info
                const start = atLocal(p.start_date, "00:00");
                const end = atLocal(p.end_date, "17:00");
                const totalHours = Math.max(0, (end.getTime() - start.getTime()) / 36e5);

                return (
                  <div key={p.id} className="rounded-xl ring-1 ring-slate-200 p-3 bg-white hover:shadow-md transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                        <div className="text-[12px] text-slate-500">
                          Code {p.code} • {fmt(p.start_date)} → {fmt(p.end_date)} <span className="text-[11px]">(fin 17:00 • ~{Math.round(totalHours)} h)</span>
                        </div>
                      </div>
                      <div className="flex items-end gap-2 flex-col">
                        <StatusPill s={p.status} />
                        <PriorityBadge p={p.priority ?? "low"} />
                        <button onClick={()=>openProjectDetails(p)} className="h-8 px-2 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-[12px]">Détails</button>
                      </div>
                    </div>

                    <div className="mt-2 space-y-1">
                      <ProgressBar value={Number(p.progress||0)} color={statusColor} />
                      <div className="text-[12px] text-slate-600">{Number(p.progress||0)}%</div>
                    </div>

                    <div className="mt-2">
                      <div className="text-[12px] text-slate-500 mb-1">Équipes liées</div>
                      <div className="flex flex-wrap gap-1">
                        {links.map(l => (
                          <span key={`${l.team_id}-${l.team_role}`} className="text-[11px] px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200">
                            {l.team_name} — {l.team_role} • {l.member_count}
                          </span>
                        ))}
                        {links.length===0 && <span className="text-[12px] text-slate-500">Aucune équipe.</span>}
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div>
                        <div className="text-[12px] text-slate-500 mb-1">Notes</div>
                        <ul className="space-y-1">
                          {notes.slice(0,3).map(n => (<li key={n.id} className="text-[13px] text-slate-700">• {n.text}</li>))}
                          {notes.length===0 && <li className="text-[12px] text-slate-500">Aucun note.</li>}
                        </ul>
                      </div>
                      <div>
                        <div className="text-[12px] text-slate-500 mb-1">Fichiers</div>
                        <ul className="space-y-1">
                          {files.slice(0,3).map(f => (
                            <li key={f.id} className="text-[13px] text-slate-700 flex items-center gap-1">
                              <Paperclip className="w-3.5 h-3.5" /> {f.original_name}
                            </li>
                          ))}
                          {files.length===0 && <li className="text-[12px] text-slate-500">Aucun fichier.</li>}
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })}
              {visualProjects.length===0 && (<div className="text-sm text-slate-500">Aucun projet.</div>)}
            </div>
          </section>
        </div>
      </main>

      {/* Modales */}
      <ProjectDetailsModal
        open={!!detailProject}
        onClose={()=>setDetailProject(null)}
        project={detailProject}
        links={detailProject ? (linksByProject[detailProject.id] || []) : []}
        notes={detailProject ? (projectNotes[detailProject.id] || []) : []}
        files={detailProject ? (projectFiles[detailProject.id] || []) : []}
        onAddNote={async (text)=>{ if(detailProject) await addNoteToProject(detailProject.id, text); }}
        onUploadPdf={async (file)=>{ if(detailProject) await uploadPdfToProject(detailProject.id, file); }}
        onPreview={(fileId)=> { if (!detailProject) return; openPdf(detailProject.id, fileId); }}
        onDeletePdf={async (fileId)=>{ if(!detailProject) return; await deletePdfFromProject(detailProject.id, fileId); }}
        visualProgress={detailProject ? (visualProjects.find(v=>v.id===detailProject.id)?.progress ?? Number(detailProject.progress||0)) : 0}
        visualStatus={detailProject ? (visualProjects.find(v=>v.id===detailProject.id)?.status ?? detailProject.status) : "planned"}
        visualPriority={detailProject ? (visualProjects.find(v=>v.id===detailProject.id)?.priority ?? "low") : "low"}
        totalHours={detailProject ? Math.max(0, (atLocal(detailProject.start_date,"00:00").getTime() - atLocal(detailProject.end_date,"17:00").getTime())/36e5)*-1 : 0}
      />

      <TeamDetailsModal
        open={!!detailTeam}
        onClose={()=>setDetailTeam(null)}
        team={detailTeam}
        members={detailTeam ? (teamMembers[detailTeam.id] || []) : []}
        projects={teamProjects}
        users={users}
        onRemoveMember={async (userId)=>{ if(!detailTeam) return; await removeMemberFromTeam(detailTeam.id, userId); }}
        onSaveTeam={async (payload)=>{ if(!detailTeam) return; await updateTeam(detailTeam.id, payload); }}
        onDeleteTeam={async ()=>{ if(!detailTeam) return; await deleteTeam(detailTeam.id); setDetailTeam(null); }}
      />

      <PdfPreviewModal open={pdfOpen} onClose={()=>setPdfOpen(false)} src={pdfSrc} />
    </Shell>
  );
}

/* ========== Petits composants contrôlés pour la zone "Notes & PDF (rapide)" ========== */
function QuickNote({ pid, onAdd }: { pid: number | ""; onAdd: (txt: string)=>Promise<void> }) {
  const [txt, setTxt] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      <input value={txt} onChange={(e)=>setTxt(e.target.value)} className="h-9 flex-1 px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none" placeholder={pid ? "Votre note…" : "Choisir un projet d’abord"} disabled={!pid} style={brandStyle}/>
      <button
        onClick={async ()=>{ if(!pid || !txt.trim()) return; setBusy(true); await onAdd(txt.trim()); setTxt(""); setBusy(false); }}
        disabled={!pid || !txt.trim() || busy}
        className={cls("h-9 px-3 rounded-lg text-white text-sm w-full sm:w-auto", !pid || !txt.trim() || busy ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-700 hover:bg-indigo-800")}
      >
        <Plus className="w-4 h-4 inline mr-1" />
      </button>
    </div>
  );
}

function QuickPdf({ pid, disabled, onUpload }: { pid: number | ""; disabled?: boolean; onUpload: (file: File)=>Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      <input
        type="file" accept="application/pdf" disabled={disabled}
        onChange={(e)=> setFile(e.currentTarget.files?.[0] ?? null)}
        className="block w-full text-[12px] file:mr-2 file:rounded-lg file:bg-slate-100 file:px-2 file:py-1 file:text-[12px] file:text-slate-700"
      />
      <button
        onClick={async ()=>{ if(!file || !pid) return; setBusy(true); await onUpload(file); setFile(null); setBusy(false); }}
        disabled={!file || !pid || busy}
        className={cls("h-9 px-3 rounded-lg text-white text-sm w-full sm:w-auto", (!file || !pid || busy) ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-700 hover:bg-indigo-800")}
      >
        Importer
      </button>
    </div>
  );
}
