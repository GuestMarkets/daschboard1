'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  FolderKanban, UserPlus, UserCircle2, Link2,
  AlertCircle, CheckCircle2, Paperclip, FilePlus2, Crown, Trash2,
  Eye, X, Flame, Plus, Users2, Building2
} from 'lucide-react';
import Shell from '../../../components/Shell';
import Modal from '../../../components/ui/Modal';

/* ===== palette ===== */
const BRAND = '#3157d9';
const RED = '#d4333a';
const ORANGE = '#f59e0b';
const GREEN = '#16a34a';
const GRAY = '#6b7280';
const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

// Helper typé pour injecter la CSS var --brand sans any
type CSSVars = React.CSSProperties & Record<string, string | number | undefined>;
const brandVar = (): CSSVars => ({ ['--brand']: BRAND });

/* ===== types ===== */
type ProjectStatus = 'planned' | 'active' | 'done' | 'archived';
type TeamRoleOnProject = 'owner' | 'contributor' | 'support';
type Priority = 'low' | 'medium' | 'high';

type MeCore = { id: number; name: string; role: 'superAdmin' | 'user'; email: string; status: string; is_admin: boolean };
type MeProfile = {
  department_id: number | null;
  is_department_lead: boolean;
  is_team_lead: boolean;
  managed_project_ids: number[];
  lead_team_ids: number[];
};

type UserLite = { id: number; name: string; email: string };

type Team = {
  id: number; name: string; description: string | null;
  leader_user_id?: number | null; leader_name?: string | null; department_id?: number | null;
};
type TeamMember = { user_id: number; name: string; email: string; role_in_team: 'lead' | 'member' };

type Department = { id: number; name: string; description?: string | null; leader_user_id?: number | null; leader_name?: string | null };
type DepartmentMember = { user_id: number; name: string; email: string; title?: string | null };

type Project = {
  id: number; name: string; code: string; description: string | null;
  start_date?: string | null; end_date?: string | null;
  status: ProjectStatus; progress: number; priority?: Priority | null;
  manager_id?: number | null;
};
type ProjectNote = { id: number; project_id: number; user_id: number | null; text: string; created_at: string };
type ProjectFile = { id: number; project_id: number; user_id: number | null; original_name: string; size_bytes: number; uploaded_at: string };
type ProjectTeamLink = { project_id: number; team_id: number; team_name: string; team_role: TeamRoleOnProject; member_count: number };

/* ===== utils dates (SAFE) ===== */
const fmt = (d?: string | null) => {
  if (!d) return '—';
  const dd = new Date(d);
  return isNaN(dd.getTime()) ? '—' : dd.toLocaleDateString();
};
const isYmd = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toYmd = (s?: string | null) => {
  if (!s) return '';
  if (isYmd(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
/** Retourne une Date valide ou null (ne JAMAIS fallback sur 1970) */
const atLocal = (dateStr?: string | null, hhmm: string = '00:00'): Date | null => {
  const ymd = toYmd(dateStr);
  if (!ymd) return null;
  const [Y, M, D] = ymd.split('-').map(Number);
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  const d = new Date(Y, (M ?? 1) - 1, (D ?? 1), h ?? 0, m ?? 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
};

/* ===== fetch helper (compatible JSON/erreurs) ===== */
async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  headers.set('Accept', 'application/json');
  if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const res = await fetch(url, { credentials: 'include', ...init, headers });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();

  let data: unknown;
  if (ct.includes('application/json')) {
    data = text ? JSON.parse(text) : ({} as unknown);
  } else {
    try {
      data = text ? JSON.parse(text) : ({} as unknown);
    } catch {
      data = { error: (text || '').slice(0, 200) };
    }
  }

  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/* ===== visuals (SAFE) ===== */
function computeStatusAuto(existing: ProjectStatus, start?: string | null, end?: string | null): ProjectStatus {
  if (existing === 'archived') return 'archived';
  const sd = atLocal(start, '08:00');
  const ed = atLocal(end, '17:00');
  if (!sd || !ed) return existing; // dates manquantes : garder le statut API
  const now = new Date();
  if (now < sd) return 'planned';
  if (now > ed) return 'done';
  return 'active';
}
/** salt: utilisé pour forcer un recalcul périodique via useMemo (tick) */
function computeProgressAuto(start?: string | null, end?: string | null, _salt: number = 0): number {
  const sd = atLocal(start, '08:00');
  const ed = atLocal(end, '17:00');
  if (!sd || !ed) return 0; // pas de dates valides => 0% (ne pas forcer 100%)
  const s = sd.getTime();
  const e = ed.getTime();
  // utilise Date.now(), le _salt force juste le recalcul via dépendances, sans modifier le résultat
  void _salt;
  const now = Date.now();
  const total = Math.max(0, e - s);
  if (total === 0) return 100; // même jour/heure exacte (cas théorique)
  const elapsed = Math.min(Math.max(0, now - s), total);
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}
function escalatePriority(cur?: Priority | null, progress = 0): Priority {
  let p: Priority = (cur ?? 'low');
  if (progress >= 50) p = p === 'low' ? 'medium' : 'high';
  if (progress >= 70) p = 'high';
  return p;
}
const StatusPill = ({ s }: { s: ProjectStatus }) => {
  const color = s === 'planned' ? ORANGE : s === 'active' ? GREEN : s === 'done' ? RED : GRAY;
  return <span className="px-2 py-0.5 rounded-full text-[11px] ring-1" style={{ backgroundColor: `${color}14`, color, borderColor: `${color}33` }}>
    {s === 'planned' ? 'En attente' : s === 'active' ? 'En cours' : s === 'done' ? 'Terminé' : 'Archivé'}
  </span>;
};
const PriorityBadge = ({ p }: { p?: Priority | null }) => {
  const map = { low: { label: 'Basse', color: GREEN }, medium: { label: 'Moyenne', color: ORANGE }, high: { label: 'Urgente', color: RED } } as const;
  const { label, color } = map[(p ?? 'low') as keyof typeof map];
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ring-1" style={{ backgroundColor: `${color}12`, color, borderColor: `${color}33` }}>
    <Flame className="w-3.5 h-3.5" /> {label}
  </span>;
};
const ProgressBar = ({ value, color = BRAND }: { value: number; color?: string }) => (
  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
    <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: `linear-gradient(90deg, ${color}, ${color})` }} />
  </div>
);

/* ===== UserPicker ===== */
function UserPicker({ users, value, onChange, disabled = false, placeholder = 'Rechercher…' }: {
  users: UserLite[]; value: number[]; onChange: (ids: number[]) => void; disabled?: boolean; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(u => (u.name + u.email).toLowerCase().includes(s));
  }, [q, users]);
  const toggle = (id: number) => value.includes(id) ? onChange(value.filter(v => v !== id)) : onChange([...value, id]);

  return (
    <div className={cls('rounded-xl ring-1 ring-slate-200 p-2 bg-white/70', disabled && 'opacity-50 pointer-events-none')}>
      <div className="flex items-center gap-2 mb-2">
        <input
          value={q}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          placeholder={placeholder}
          className="text-gray-500 h-9 flex-1 px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none text-sm bg-white"
          style={brandVar()}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.length === 0 ? <span className="text-[12px] text-slate-500">Aucun utilisateur sélectionné.</span> :
          value.map(id => {
            const u = users.find(x => x.id === id); if (!u) return null;
            return (
              <span key={id} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 inline-flex items-center gap-1">
                {u.name}
                <button type="button" onClick={() => toggle(id)} className="hover:text-indigo-900"><X className="w-3 h-3" /></button>
              </span>
            );
          })
        }
      </div>
      <div className="max-h-56 overflow-auto pr-1 space-y-1">
        {filtered.map(u => (
          <label key={u.id} className="flex items-center gap-2 text-[13px] px-2 py-1 rounded-lg hover:bg-slate-50">
            <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} />
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

/* ===== Modales ===== */
function ProjectDetailsModal({
  open, onClose, project, links, notes, files,
  onAddNote, onUploadPdf, onPreview, onDeletePdf,
  visualProgress, visualStatus, visualPriority
}: {
  open: boolean; onClose: () => void;
  project: Project | null;
  links: ProjectTeamLink[]; notes: ProjectNote[]; files: ProjectFile[];
  onAddNote: (text: string) => Promise<void>;
  onUploadPdf: (file: File) => Promise<void>;
  onPreview: (fileId: number) => void;
  onDeletePdf: (fileId: number) => Promise<void>;
  visualProgress: number; visualStatus: ProjectStatus; visualPriority: Priority | null | undefined;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNote(''); setBusy(false); }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={project ? `Projet — ${project.name}` : 'Projet'} size="xl">
      {!project ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Période</div>
              <div className="text-sm text-slate-900">{fmt(project.start_date)} → {fmt(project.end_date)} <span className="text-[11px] text-slate-500">(fin 17:00)</span></div>
            </div>
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Statut</div>
              <div className="text-sm text-slate-900"><StatusPill s={visualStatus} /></div>
            </div>
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Priorité</div>
              <div className="text-sm text-slate-900"><PriorityBadge p={visualPriority ?? 'low'} /></div>
            </div>
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Progression</div>
              <div className="space-y-1">
                <ProgressBar value={visualProgress} />
                <div className="text-[12px] text-slate-600">{visualProgress}%</div>
              </div>
            </div>
          </div>

          {project.description && (
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500">Description</div>
              <div className="text-sm text-slate-800">{project.description}</div>
            </div>
          )}

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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="text-[12px] text-slate-500 mb-2">Notes</div>
              <ul className="space-y-1 mb-2 max-h-56 overflow-auto pr-1">
                {notes.length ? notes.map(n => <li key={n.id} className="text-[13px] text-slate-800">• {n.text}</li>) : <li className="text-[12px] text-slate-500">Aucune note.</li>}
              </ul>
              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
                  className="h-9 flex-1 px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none"
                  placeholder="Ajouter une note…"
                  style={brandVar()}
                />
                <button
                  onClick={async () => { if (!note.trim()) return; setBusy(true); await onAddNote(note.trim()); setNote(''); setBusy(false); }}
                  disabled={!note.trim() || busy}
                  className={cls('h-9 px-3 rounded-lg text-white text-sm', !note.trim() || busy ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-700 hover:bg-indigo-800')}
                >Ajouter</button>
              </div>
            </div>

            <ProjectFilesPanel
              files={files}
              onPreview={(id) => onPreview(id)}
              onUpload={onUploadPdf}
              onDelete={onDeletePdf}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProjectFilesPanel({ files, onPreview, onUpload, onDelete }: {
  files: ProjectFile[];
  onPreview: (fileId: number) => void;
  onUpload: (file: File) => Promise<void>;
  onDelete: (fileId: number) => Promise<void>;
}) {
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-xl ring-1 ring-slate-200 p-3">
      <div className="text-[12px] text-slate-500 mb-2">Fichiers (PDF)</div>
      <ul className="space-y-1 mb-2 max-h-56 overflow-auto pr-1">
        {files.length ? files.map(f => (
          <li key={f.id} className="text-[13px] text-slate-800 flex items-center justify-between gap-2">
            <div className="truncate"><Paperclip className="inline w-3.5 h-3.5 mr-1" />{f.original_name} <span className="text-[11px] text-slate-500">({Math.round((f.size_bytes || 0) / 1024)} Ko)</span></div>
            <div className="flex items-center gap-2">
              <button onClick={() => onPreview(f.id)} className="text-indigo-700 hover:text-indigo-800 text-[12px] inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />Prévisualiser</button>
              <button onClick={async () => { setBusy(true); await onDelete(f.id); setBusy(false); }} disabled={busy} className="text-rose-600 hover:text-rose-700 text-[12px] inline-flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />Supprimer</button>
            </div>
          </li>
        )) : <li className="text-[12px] text-slate-500">Aucun fichier.</li>}
      </ul>

      <div className="flex gap-2 items-center">
        <input type="file" accept="application/pdf" onChange={e => setPdf(e.currentTarget.files?.[0] ?? null)}
          className="block w-full text-[12px] file:mr-2 file:rounded-lg file:bg-slate-100 file:px-2 file:py-1 file:text-[12px] file:text-slate-700" />
        <button
          onClick={async () => { if (!pdf) return; setBusy(true); await onUpload(pdf); setPdf(null); setBusy(false); }}
          disabled={!pdf || busy}
          className={cls('h-9 px-3 rounded-lg text-white text-sm', !pdf || busy ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-700 hover:bg-indigo-800')}
        >Importer</button>
      </div>
    </div>
  );
}

function PdfPreviewModal({ open, onClose, src }: { open: boolean; onClose: () => void; src: string | null }) {
  return (
    <Modal open={open} onClose={onClose} title="Prévisualisation PDF" size="xl">
      {!src ? <div className="text-sm text-slate-500">Aucun fichier.</div> : <div className="h-[70vh]"><iframe src={src} className="w-full h-full rounded-lg ring-1 ring-slate-200" /></div>}
    </Modal>
  );
}

/* ===== PAGE ===== */
export default function ProjectsTeamsPage() {
  const [me, setMe] = useState<MeCore | null>(null);
  const [profile, setProfile] = useState<MeProfile | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [links, setLinks] = useState<ProjectTeamLink[]>([]);
  const [notes, setNotes] = useState<Record<number, ProjectNote[]>>({});
  const [files, setFiles] = useState<Record<number, ProjectFile[]>>({});

  const [teamsLed, setTeamsLed] = useState<Team[]>([]);
  const [teamsMine, setTeamsMine] = useState<Team[]>([]);
  const [membersByTeam, setMembersByTeam] = useState<Record<number, TeamMember[]>>({});
  const [deptMembers, setDeptMembers] = useState<DepartmentMember[]>([]);
  const [departmentsLed, setDepartmentsLed] = useState<Department[]>([]);

  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  const [selProject, setSelProject] = useState<string>('');
  const [selTeam, setSelTeam] = useState<string>('');
  const [selTeamRole, setSelTeamRole] = useState<TeamRoleOnProject>('contributor');

  const [err, setErr] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 60_000); return () => clearInterval(id); }, []);

  useEffect(() => {
    (async () => {
      try {
        // 1) /api/me
        const meRes = await fetchJSON<{ ok: boolean; user: MeCore }>('/api/me');
        if (!meRes.ok) throw new Error('Unauthorized');
        setMe(meRes.user);

        // 2) profil étendu
        const prof = await fetchJSON<MeProfile>('/api/me/profile');
        setProfile(prof);

        // 3) Projets où je suis affecté
        const p = await fetchJSON<{ projects: Project[] }>('/guestmarkets/api/projects/assigned');
        setProjects(p.projects || []);

        // 4) Liens projet<->team
        const l = await fetchJSON<{ items: ProjectTeamLink[] }>('/api/projects-teams/links').catch(() => ({ items: [] as ProjectTeamLink[] }));
        setLinks(l.items || []);

        // 5) Notes + Fichiers par projet
        const nObj: Record<number, ProjectNote[]> = {};
        const fObj: Record<number, ProjectFile[]> = {};
        await Promise.all((p.projects || []).map(async prj => {
          const [n, f] = await Promise.allSettled([
            fetchJSON<{ items: ProjectNote[] }>(`/api/projects/${prj.id}/notes`),
            fetchJSON<{ items: ProjectFile[] }>(`/api/projects/${prj.id}/files`),
          ]);
          nObj[prj.id] = n.status === 'fulfilled' ? (n.value.items || []) : [];
          fObj[prj.id] = f.status === 'fulfilled' ? (f.value.items || []) : [];
        }));
        setNotes(nObj); setFiles(fObj);

        // 6) Equipes que je dirige + leurs membres
        const led = await fetchJSON<{ items: Team[] }>('/api/teams/my-led').catch(() => ({ items: [] as Team[] }));
        setTeamsLed(led.items || []);
        const memObj: Record<number, TeamMember[]> = {};
        await Promise.all((led.items || []).map(async team => {
          const data = await fetchJSON<{ items: TeamMember[] }>(`/api/teams/${team.id}/members`);
          memObj[team.id] = data.items || [];
        }));
        setMembersByTeam(memObj);

        // 7) Toutes mes équipes (membre)
        const mine = await fetchJSON<{ items: Team[] }>('/api/teams/my').catch(() => ({ items: [] as Team[] }));
        setTeamsMine(mine.items || []);

        // 8) Départements que je dirige + membres de MON département
        const deps = await fetchJSON<{ items: Department[] }>('/api/departments/my-led').catch(() => ({ items: [] as Department[] }));
        setDepartmentsLed(deps.items || []);
        if (prof.department_id) {
          const ms = await fetchJSON<{ items: DepartmentMember[] }>(`/api/departments/${prof.department_id}/members`).catch(() => ({ items: [] as DepartmentMember[] }));
          setDeptMembers(ms.items || []);
        } else {
          setDeptMembers([]);
        }

        setErr(null);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setErr(message || 'Erreur serveur');
      }
    })();
  }, []);

  /* === alignement avec l’autre page === */
  const visualProjects = useMemo(() => {
    return projects.map(p => {
      const auto = computeProgressAuto(p.start_date, p.end_date, tick);         // recalcul toutes les minutes
      const merged = Math.max(Number(p.progress || 0), auto);                   // garder au moins la progression stockée
      const status = computeStatusAuto(p.status, p.start_date, p.end_date);     // garde le statut API si dates invalides
      const priority = escalatePriority(p.priority ?? 'low', merged);
      return { ...p, progress: merged, status, priority };
    });
  }, [projects, tick]);

  const linksByProject = useMemo(() => {
    const map: Record<number, ProjectTeamLink[]> = {};
    links.forEach(l => { (map[l.project_id] ||= []).push(l); });
    return map;
  }, [links]);

  const managedIds = useMemo(() => new Set(profile?.managed_project_ids || []), [profile]);
  const leadTeamIds = useMemo(() => new Set(profile?.lead_team_ids || []), [profile]);

  const stats = useMemo(() => ({
    totalTeamsAll: teamsMine.length,
    totalTeamsLed: teamsLed.length,
    totalProjectsAll: visualProjects.length,
    totalProjectsManaged: managedIds.size,
  }), [teamsMine, teamsLed, visualProjects, managedIds]);

  // Membres du département qui ne sont dans AUCUNE de mes équipes
  const departmentMembersNotInAnyTeam: UserLite[] = useMemo(() => {
    if (!deptMembers.length) return [];
    const allMembers = new Set<number>();
    Object.values(membersByTeam).forEach(arr => arr.forEach(m => allMembers.add(m.user_id)));
    return deptMembers
      .filter(m => !allMembers.has(m.user_id))
      .map(m => ({ id: m.user_id, name: m.name, email: m.email }));
  }, [deptMembers, membersByTeam]);

  async function linkTeamToProject() {
    if (!profile) return;
    const pid = Number(selProject), tid = Number(selTeam);
    if (!pid || !tid) return;
    if (!leadTeamIds.has(tid) || !managedIds.has(pid)) { alert("Action réservée au chef d’équipe ET chef du projet."); return; }
    await fetchJSON(`/api/projects/${pid}/teams`, { method: 'POST', body: JSON.stringify({ teamId: tid, teamRole: selTeamRole }) });
    const l = await fetchJSON<{ items: ProjectTeamLink[] }>('/api/projects-teams/links');
    setLinks(l.items || []);
    setSelTeam('');
  }

  async function addMembersToTeam(teamId: number, userIds: number[]) {
    await fetchJSON(`/api/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ userIds, role: 'member' }) });
    const mem = await fetchJSON<{ items: TeamMember[] }>(`/api/teams/${teamId}/members`);
    setMembersByTeam(s => ({ ...s, [teamId]: mem.items || [] }));
  }

  async function addNoteToProject(pid: number, text: string) {
    await fetchJSON(`/api/projects/${pid}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
    const n = await fetchJSON<{ items: ProjectNote[] }>(`/api/projects/${pid}/notes`);
    setNotes(s => ({ ...s, [pid]: n.items || [] }));
  }

  async function uploadPdfToProject(pid: number, file: File) {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`/api/projects/${pid}/files/upload`, { method: 'POST', body: fd, credentials: 'include' });
    if (!res.ok) { const msg = await res.text(); throw new Error(msg || 'Échec upload'); }
    const f = await fetchJSON<{ items: ProjectFile[] }>(`/api/projects/${pid}/files`);
    setFiles(s => ({ ...s, [pid]: f.items || [] }));
  }

  async function deletePdfFromProject(pid: number, fileId: number) {
    await fetchJSON(`/api/projects/${pid}/files/${fileId}`, { method: 'DELETE' });
    const f = await fetchJSON<{ items: ProjectFile[] }>(`/api/projects/${pid}/files`);
    setFiles(s => ({ ...s, [pid]: f.items || [] }));
  }

  function openPdf(pid: number, fileId: number) { setPdfSrc(`/api/projects/${pid}/files/${fileId}/content`); setPdfOpen(true); }

  /* ===== render ===== */
  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Projets & Équipes">
      {/* Bandeau stats */}
      <section className="rounded-3xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-500 text-white p-5 mb-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Vue d’ensemble</h1>
            <p className="text-white/90">Vos équipes et projets (chef ou membre).</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">Équipes (toutes)</div><div className="text-xl font-bold">{stats.totalTeamsAll}</div></div>
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">Équipes (je suis chef)</div><div className="text-xl font-bold">{stats.totalTeamsLed}</div></div>
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">Projets (tous)</div><div className="text-xl font-bold">{stats.totalProjectsAll}</div></div>
          <div className="rounded-2xl bg-white/10 px-4 py-3"><div className="text-[12px]">Projets (je suis chef)</div><div className="text-xl font-bold">{stats.totalProjectsManaged}</div></div>
        </div>
      </section>

      {/* Création d’équipe (rattachée à MON département) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Users2 className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm md:text-base font-semibold text-slate-900">Créer une équipe</h2>
          </div>
        </div>
        <CreateTeamInline onCreate={async ({ name, description }) => {
          await fetchJSON('/api/teams', { method: 'POST', body: JSON.stringify({ name, description, leaderUserId: me?.id || null }) });
          // refresh mes équipes
          const [mine, led] = await Promise.all([
            fetchJSON<{ items: Team[] }>('/api/teams/my'),
            fetchJSON<{ items: Team[] }>('/api/teams/my-led')
          ]);
          setTeamsMine(mine.items || []);
          setTeamsLed(led.items || []);
        }} disabled={!profile?.department_id} />
        {!profile?.department_id && <div className="text-[12px] text-slate-500 mt-1">Vous devez appartenir à un département pour créer une équipe.</div>}
      </section>

      {err && <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"><AlertCircle className="w-4 h-4" />{err}</div>}

      {/* === Affectations / Liaisons === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Ajouter des membres */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <UserPlus className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm md:text-base font-semibold text-slate-900">Ajouter des membres à une de mes équipes</h2>
          </div>
          {teamsLed.length === 0 ? (
            <div className="text-sm text-slate-500">Vous ne dirigez aucune équipe.</div>
          ) : (
            <AddMembersPanel
              teamsLed={teamsLed}
              candidates={departmentMembersNotInAnyTeam}
              onAdd={addMembersToTeam}
            />
          )}
        </section>

        {/* Lier équipe ↔ projet */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Link2 className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm md:text-base font-semibold text-slate-900">Lier une de mes équipes à un de MES projets</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="block text:[12px] text-slate-600 mb-1">Projet (dont je suis chef)</label>
              <select
                value={selProject}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelProject(e.target.value)}
                className="text-gray-700 h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none"
                style={brandVar()}>
                <option value="">— Choisir —</option>
                {visualProjects.filter(p => managedIds.has(p.id)).map(p => (
                  <option key={p.id} value={String(p.id)}>{p.code} — {p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text:[12px] text-slate-600 mb-1">Équipe (que je dirige)</label>
              <select
                value={selTeam}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelTeam(e.target.value)}
                className="text-gray-700 h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none"
                style={brandVar()}>
                <option value="">— Choisir —</option>
                {teamsLed.map(t => (<option key={t.id} value={String(t.id)}>{t.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text:[12px] text-slate-600 mb-1">Rôle</label>
              <select
                value={selTeamRole}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelTeamRole(e.target.value as TeamRoleOnProject)}
                className="text-gray-700 h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none"
                style={brandVar()}>
                <option value="owner">Propriétaire</option>
                <option value="contributor">Contributeur</option>
                <option value="support">Support</option>
              </select>
            </div>
            <div className="md:col-span-3 flex justify-end">
              <button onClick={linkTeamToProject}
                disabled={!selProject || !selTeam}
                className={cls('h-9 px-3 rounded-lg text-white text-sm inline-flex items-center gap-1',
                  !selProject || !selTeam ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-700 hover:bg-indigo-800')}>
                <CheckCircle2 className="w-4 h-4" /> Lier
              </button>
            </div>
          </div>
        </section>

        {/* Notes & PDF rapides */}
        <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <FilePlus2 className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm md:text-base font-semibold text-slate-900">Notes & PDF (rapide)</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="md:col-span-2">
              <label className="block text-[12px] text-slate-600 mb-1">Projet</label>
              <select
                value={selProject}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelProject(e.target.value)}
                className="text-gray-600 h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none"
                style={brandVar()}>
                <option value="">— Choisir —</option>
                {visualProjects.map(p => (<option key={p.id} value={String(p.id)}>{p.code} — {p.name}</option>))}
              </select>
            </div>

            <div className="md:col-span-2 rounded-xl ring-1 ring-slate-200 p-2">
              <div className="text-[12px] text-slate-500 mb-1">Nouvelle note</div>
              <QuickNote pid={selProject ? Number(selProject) : 0} onAdd={async txt => { if (!selProject) return; await addNoteToProject(Number(selProject), txt); }} />
            </div>

            <div className="md:col-span-2 rounded-xl ring-1 ring-slate-200 p-2">
              <div className="text-[12px] text-slate-500 mb-1">Ajouter un PDF</div>
              <QuickPdf pid={selProject ? Number(selProject) : 0} onUpload={async f => { if (!selProject) return; await uploadPdfToProject(Number(selProject), f); }} />
            </div>
          </div>
        </section>
      </div>

      {/* Départements que je dirige */}
      {departmentsLed.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm md:text-base font-semibold text-slate-900">Membres du/des département(s) que je dirige</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {departmentsLed.map(dep => <DepartmentMembersCard key={dep.id} department={dep} />)}
          </div>
        </section>
      )}

      {/* Listes d'équipes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Users2 className="w-4 h-4 text-indigo-700" />
              <h2 className="text-sm md:text-base font-semibold text-slate-900">Mes équipes (je suis chef)</h2>
            </div>
          </div>
          <div className="divide-y divide-slate-200">
            {teamsLed.map(t => {
              const members = membersByTeam[t.id] || [];
              return (
                <div key={t.id} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate flex items-center gap-1">
                        {t.name}
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-200">
                          <Crown className="w-3.5 h-3.5" />
                          {t.leader_name || 'Chef'}
                        </span>
                      </div>
                      <div className="text-[12px] text-slate-500 truncate">{t.description || '—'}</div>
                    </div>
                    <div className="text-[12px] bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 rounded-lg px-2 py-0.5">
                      {members.length} membre{members.length > 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {members.slice(0, 8).map(m => (
                      <div key={m.user_id} className="text-[13px] text-slate-700 truncate">• {m.name} <span className="text-[11px] text-slate-500">({m.role_in_team})</span></div>
                    ))}
                    {members.length === 0 && <div className="text-[12px] text-slate-500">Aucun membre.</div>}
                  </div>
                </div>
              );
            })}
            {teamsLed.length === 0 && <div className="py-2 text-sm text-slate-500">Vous ne dirigez aucune équipe.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <UserCircle2 className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm md:text-base font-semibold text-slate-900">Mes équipes (toutes)</h2>
          </div>
          <div className="space-y-3">
            {teamsMine.map(t => (
              <div key={t.id} className="rounded-xl ring-1 ring-slate-200 p-3 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{t.name}</div>
                    <div className="text-[12px] text-slate-500 truncate">{t.description || '—'}</div>
                  </div>
                  {t.leader_user_id === me?.id ? (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-200">
                      <Crown className="w-3.5 h-3.5" /> Chef
                    </span>
                  ) : (
                    <div className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 ring-1 ring-slate-200">Membre</div>
                  )}
                </div>
              </div>
            ))}
            {teamsMine.length === 0 && <div className="text-sm text-slate-500">Aucune équipe.</div>}
          </div>
        </section>
      </div>

      {/* Projets */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-4 mt-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <FolderKanban className="w-4 h-4 text-indigo-700" />
            <h2 className="text-sm md:text-base font-semibold text-slate-900">Mes projets</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visualProjects.map(p => {
              const l = linksByProject[p.id] || [];
              const n = notes[p.id] || [];
              const f = files[p.id] || [];
              const tone = p.status === 'planned' ? ORANGE : p.status === 'active' ? GREEN : p.status === 'done' ? RED : GRAY;

              return (
                <div key={p.id} className="rounded-xl ring-1 ring-slate-200 p-3 bg-white hover:shadow-md transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate flex items-center gap-1">
                        {p.name}
                        {managedIds.has(p.id) && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-200">
                            <Crown className="w-3.5 h-3.5" /> Chef
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-slate-500">
                        Code {p.code} • {fmt(p.start_date)} → {fmt(p.end_date)} <span className="text-[11px]">(fin 17:00)</span>
                      </div>
                    </div>
                    <div className="flex items-end gap-2 flex-col">
                      <StatusPill s={p.status} />
                      <PriorityBadge p={p.priority ?? 'low'} />
                      <button onClick={() => setDetailProject(p)} className="text-gray-500 h-8 px-2 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-[12px]">
                        Détails
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1">
                    <ProgressBar value={Number(p.progress || 0)} color={tone} />
                    <div className="text-[12px] text-slate-600">{Number(p.progress || 0)}%</div>
                  </div>

                  <div className="mt-2">
                    <div className="text-[12px] text-slate-500 mb-1">Équipes liées</div>
                    <div className="flex flex-wrap gap-1">
                      {l.map(x => (
                        <span key={`${x.team_id}-${x.team_role}`} className="text-[11px] px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200">
                          {x.team_name} — {x.team_role} • {x.member_count}
                        </span>
                      ))}
                      {l.length === 0 && <span className="text-[12px] text-slate-500">Aucune équipe.</span>}
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <div className="text-[12px] text-slate-500 mb-1">Notes</div>
                      <ul className="space-y-1">
                        {n.slice(0, 3).map(it => <li key={it.id} className="text-[13px] text-slate-700">• {it.text}</li>)}
                        {n.length === 0 && <li className="text-[12px] text-slate-500">Aucune note.</li>}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[12px] text-slate-500 mb-1">Fichiers</div>
                      <ul className="space-y-1">
                        {f.slice(0, 3).map(it => (
                          <li key={it.id} className="text-[13px] text-slate-700 flex items-center gap-1">
                            <Paperclip className="w-3.5 h-3.5" /> {it.original_name}
                          </li>
                        ))}
                        {f.length === 0 && <li className="text-[12px] text-slate-500">Aucun fichier.</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}

            {visualProjects.length === 0 && (
              <div className="text-sm text-slate-500 col-span-full">Aucun projet.</div>
            )}
          </div>
        </section>
      </div>

      {/* Modales */}
      <ProjectDetailsModal
        open={!!detailProject}
        onClose={() => setDetailProject(null)}
        project={detailProject}
        links={detailProject ? (linksByProject[detailProject.id] || []) : []}
        notes={detailProject ? (notes[detailProject.id] || []) : []}
        files={detailProject ? (files[detailProject.id] || []) : []}
        onAddNote={async text => { if (detailProject) await addNoteToProject(detailProject.id, text); }}
        onUploadPdf={async file => { if (detailProject) await uploadPdfToProject(detailProject.id, file); }}
        onPreview={fileId => { if (!detailProject) return; openPdf(detailProject.id, fileId); }}
        onDeletePdf={async fileId => { if (!detailProject) return; await deletePdfFromProject(detailProject.id, fileId); }}
        visualProgress={detailProject ? (visualProjects.find(v => v.id === detailProject.id)?.progress ?? Number(detailProject.progress || 0)) : 0}
        visualStatus={detailProject ? (visualProjects.find(v => v.id === detailProject.id)?.status ?? detailProject.status) : 'planned'}
        visualPriority={detailProject ? (visualProjects.find(v => v.id === detailProject.id)?.priority ?? 'low') : 'low'}
      />

      <PdfPreviewModal open={pdfOpen} onClose={() => setPdfOpen(false)} src={pdfSrc} />
    </Shell>
  );
}

/* ===== sous-composants ===== */
function DepartmentMembersCard({ department }: { department: Department }) {
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/departments/${department.id}/members`, { credentials: 'include' });
        const j: unknown = await r.json().catch(() => ({ items: [] as DepartmentMember[] }));
        setMembers((j as { items?: DepartmentMember[] }).items || []);
      } catch {
        // noop
      }
    })();
  }, [department.id]);
  return (
    <div className="rounded-xl ring-1 ring-slate-200 p-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate flex items-center gap-1">
            {department.name}
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-200">
              <Crown className="w-3.5 h-3.5" /> {department.leader_name || 'Chef'}
            </span>
          </div>
          <div className="text-[12px] text-slate-500 truncate">{department.description || '—'}</div>
        </div>
        <div className="text-[12px] bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 rounded-lg px-2 py-0.5">
          {members.length} membre{members.length > 1 ? 's' : ''}
        </div>
      </div>
      <ul className="mt-2 space-y-1 max-h-48 overflow-auto pr-1">
        {members.length ? members.map(m => (
          <li key={m.user_id} className="text-[13px] text-slate-700 truncate">• {m.name} <span className="text-[11px] text-slate-500">— {m.email}</span></li>
        )) : <li className="text-[12px] text-slate-500">Aucun membre.</li>}
      </ul>
    </div>
  );
}

function AddMembersPanel({
  teamsLed, candidates, onAdd
}: { teamsLed: Team[]; candidates: UserLite[]; onAdd: (teamId: number, userIds: number[]) => Promise<void> }) {
  const [selTeam, setSelTeam] = useState<string>('');
  const [selected, setSelected] = useState<number[]>([]);
  return (
    <div className="grid grid-cols-1 gap-2">
      <div>
        <label className="block text-[12px] text-slate-600 mb-1">Équipe (que je dirige)</label>
        <select
          value={selTeam}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setSelTeam(e.target.value); setSelected([]); }}
          className="text-gray-600 h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] bg-white outline-none"
          style={brandVar()}>
          <option value="">— Choisir —</option>
          {teamsLed.map(t => (
            <option key={t.id} value={String(t.id)}>{t.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[12px] text-slate-600 mb-1">Membres de mon département (sans équipe)</label>
        <UserPicker users={candidates} value={selected} onChange={setSelected} disabled={!selTeam} />
      </div>
      <div className="flex justify-end">
        <button onClick={() => selTeam && selected.length && onAdd(Number(selTeam), selected)}
          disabled={!selTeam || selected.length === 0}
          className={cls('h-9 px-3 rounded-lg text-white text-sm inline-flex items-center gap-1',
            !selTeam || selected.length === 0 ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-700 hover:bg-indigo-800')}>
          <CheckCircle2 className="w-4 h-4" /> Valider
        </button>
      </div>
    </div>
  );
}

function CreateTeamInline({ onCreate, disabled }: { onCreate: (payload: { name: string; description?: string; }) => Promise<void>; disabled?: boolean }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <div className={cls("grid grid-cols-1 md:grid-cols-3 gap-2", disabled && "opacity-60")}>
      <input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="Nom de l’équipe"
        className="text-gray-500 h-9 w-full px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none"
        disabled={disabled} style={brandVar()} />
      <input value={desc} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDesc(e.target.value)} placeholder="Description (optionnel)"
        className="text-gray-500 h-9 w-full px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none"
        disabled={disabled} style={brandVar()} />
      <div className="flex justify-end">
        <button
          onClick={async () => { if (!name.trim() || disabled) return; setBusy(true); await onCreate({ name: name.trim(), description: desc.trim() || undefined }); setName(''); setDesc(''); setBusy(false); }}
          disabled={disabled || !name.trim() || busy}
          className={cls('h-9 px-3 rounded-lg text-white text-sm inline-flex items-center gap-1',
            (disabled || !name.trim() || busy) ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-700 hover:bg-indigo-800')}
        >
          <Plus className="w-4 h-4" /> Créer
        </button>
      </div>
    </div>
  );
}

function QuickNote({ pid, onAdd }: { pid: number | 0; onAdd: (txt: string) => Promise<void> }) {
  const [txt, setTxt] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        value={txt}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTxt(e.target.value)}
        className="text-gray-600 h-9 flex-1 px-3 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-[--brand] outline-none"
        placeholder={pid ? 'Votre note…' : "Choisir un projet d’abord"} disabled={!pid} style={brandVar()} />
      <button onClick={async () => { if (!pid || !txt.trim()) return; setBusy(true); await onAdd(txt.trim()); setTxt(''); setBusy(false); }}
        disabled={!pid || !txt.trim() || busy}
        className={cls('text-gray-600 h-9 px-3 rounded-lg text-white text-sm', (!pid || !txt.trim() || busy) ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-700 hover:bg-indigo-800')}>
        Ajouter
      </button>
    </div>
  );
}
function QuickPdf({ pid, onUpload }: { pid: number | 0; onUpload: (file: File) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2">
      <input type="file" accept="application/pdf" onChange={e => setFile(e.currentTarget.files?.[0] ?? null)}
        className="block w-full text-[12px] file:mr-2 file:rounded-lg file:bg-slate-100 file:px-2 file:py-1 file:text-[12px] file:text-slate-700" disabled={!pid} />
      <button onClick={async () => { if (!file || !pid) return; setBusy(true); await onUpload(file); setFile(null); setBusy(false); }}
        disabled={!file || !pid || busy}
        className={cls('h-9 px-3 rounded-lg text-white text-sm', (!file || !pid || busy) ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-700 hover:bg-indigo-800')}>
        Importer
      </button>
    </div>
  );
}
