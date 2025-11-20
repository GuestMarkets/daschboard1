"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Shell from "../../components/Shell";
import Modal from "../../../components/ui/Modal";
import {
  FileText,
  Upload,
  Paperclip,
  Send,
  AlertCircle,
  Search,
  Inbox,
  ClipboardEdit,
  Crown,
  UserCog,
  Pencil,
  Eye,
  XCircle,
  CheckCircle2,
  MessageSquareWarning,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* =============================== Types =============================== */
type ReportStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "changes_requested";

type ReportType =
  | "daily"
  | "weekly"
  | "monthly"
  | "incident"
  | "meeting"
  | "other";

type ReportFile = {
  id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at?: string;
};

type ReportComment = {
  id: number;
  user_id: number;
  user_name?: string;
  text: string;
  created_at: string;
};

type RecipientLite = { id: number; name: string };

type Report = {
  id: number;
  title: string;
  type: ReportType;
  summary: string | null;
  periodStart: string;
  periodEnd: string;
  status: ReportStatus;
  files: ReportFile[];
  comments: ReportComment[];
  authorName?: string | null;
  // reçus
  inboxStatus?: ReportStatus | null;
  unread?: boolean;
  readAt?: string | null;
  // envoyés
  recipients?: RecipientLite[];
};

type ProjectLite = { id: number; name: string };
type DepartmentLite = { id: number; name: string };

type CandidateTag = "superAdmin" | "projectManager" | "departmentManager";
type Candidate = { id: number; name: string; tag: CandidateTag };

type ReportStats = {
  total: number;
  draft: number;
  submitted: number;
  under_review: number;
  approved: number;
  rejected: number;
  changes_requested: number;
};

type CreateReportPayload = {
  title: string;
  type: ReportType;
  summary: string | null;
  periodStart: string;
  periodEnd: string;
  projectId: number | null;
  departmentId: number | null;
  recipientIds: number[];
};

type EditReportPatch = {
  id: number;
  title: string;
  summary: string | null;
  periodStart: string;
  periodEnd: string;
};

type ApiList<T> = { items: T[] };
type ApiItem<T> = { item: T };
type ApiFileCreated = { file: ReportFile };

const cls = (...a: Array<string | false | null | undefined>) =>
  a.filter(Boolean).join(" ");
const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0"),
    dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
};

/* =============================== Utils =============================== */
function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch {
    /* ignore */
  }

  const res = await fetch(url, { credentials: "include", ...init, headers });
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  // essaie de parser le corps
  let parsed: unknown = null;
  try {
    if (text && contentType.includes("application/json")) {
      parsed = JSON.parse(text);
    }
  } catch {
    /* ignore parse error */
  }

  if (!res.ok) {
    // sécurise un message en string
    let message = `HTTP ${res.status}`;
    if (parsed && typeof parsed === "object" && parsed !== null) {
      const p = parsed as { error?: unknown; message?: unknown; detail?: unknown };
      const candidate = p.error ?? p.message ?? p.detail;
      if (typeof candidate === "string" && candidate.trim()) {
        message = candidate;
      }
    } else if (text && !contentType.includes("application/json")) {
      // si ce n'est pas du JSON mais du texte, tronque et utilise-le
      message = text.slice(0, 200);
    }
    throw new Error(message); // toujours une string ici
  }

  // si pas de JSON renvoyé, retourne un objet vide typé
  if (parsed == null) return {} as T;
  return parsed as T;
}

/* =============================== En-tête Stats =============================== */
function StatsBar({
  scope,
  stats,
}: {
  scope: "sent" | "received";
  stats: Partial<ReportStats>;
}) {
  return (
    <section className="rounded-3xl bg-gradient-to-r from-indigo-600 via-fuchsia-500 to-emerald-500 text-white p-5">
      <div className="flex items-center gap-2">
        {scope === "sent" ? <Send className="w-6 h-6" /> : <Inbox className="w-6 h-6" />}
        <h1 className="text-2xl md:text-3xl font-semibold">
          Rapports {scope === "sent" ? "envoyés" : "reçus"}
        </h1>
      </div>
      <p className="text-white/90 mt-1">
        Ouverture côté destinataire = statut <b>En revue</b>.
      </p>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-6 gap-2">
        {([
          ["Total", stats.total ?? 0],
          ["Brouillons", stats.draft ?? 0],
          ["Soumis", stats.submitted ?? 0],
          ["En revue", stats.under_review ?? 0],
          ["Approuvés", stats.approved ?? 0],
          ["Rejetés / Corr.", (stats.rejected ?? 0) + (stats.changes_requested ?? 0)],
        ] as const).map(([label, val]) => (
          <div key={label} className="rounded-2xl bg-white/10 px-4 py-3">
            <div className="text-[12px]">{label}</div>
            <div className="text-xl font-bold">{val}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* =============================== Recipient badges (sent) =============================== */
const tonePool = [
  "bg-rose-50 text-rose-700 ring-rose-200",
  "bg-amber-50 text-amber-800 ring-amber-200",
  "bg-emerald-50 text-emerald-800 ring-emerald-200",
  "bg-sky-50 text-sky-800 ring-sky-200",
  "bg-indigo-50 text-indigo-800 ring-indigo-200",
  "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200",
] as const;

/* =============================== Sélecteur destinataires =============================== */
function RecipientPicker({
  candidates,
  value,
  onChange,
}: {
  candidates: Candidate[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const tags: Record<
    CandidateTag,
    { label: string; tone: string; Icon: LucideIcon }
  > = {
    superAdmin: {
      label: "Super admin",
      tone: "bg-violet-50 text-violet-800 ring-violet-200",
      Icon: Crown,
    },
    projectManager: {
      label: "Chef de projet",
      tone: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      Icon: UserCog,
    },
    departmentManager: {
      label: "Chef de département",
      tone: "bg-amber-50 text-amber-800 ring-amber-200",
      Icon: UserCog,
    },
  };

  function toggle(id: number) {
    value.includes(id)
      ? onChange(value.filter((v) => v !== id))
      : onChange([...value, id]);
  }

  return (
    <div className="rounded-xl ring-1 ring-slate-200 p-2 bg-white/70">
      <div className="text-[12px] text-slate-600 mb-2">Envoyer à</div>
      <div className="flex flex-wrap gap-1.5">
        {candidates.length === 0 ? (
          <span className="text-[12px] text-slate-500">Aucun destinataire possible.</span>
        ) : (
          candidates.map((c) => {
            const active = value.includes(c.id);
            const { label, tone, Icon } = tags[c.tag];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={cls(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ring-1",
                  tone,
                  active ? "ring-2 ring-offset-1" : "opacity-80"
                )}
                title={label}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="font-medium">{c.name}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">{value.length} destinataire(s)</div>
    </div>
  );
}

/* =============================== Modale création =============================== */
function ReportCreateModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateReportPayload, file?: File | null) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ReportType>("daily");
  const [summary, setSummary] = useState("");
  const [periodStart, setPeriodStart] = useState(todayStr());
  const [periodEnd, setPeriodEnd] = useState(todayStr());
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [projectId, setProjectId] = useState<number | "">("");
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [depts, setDepts] = useState<DepartmentLite[]>([]);
  const [file, setFile] = useState<File | null>(null);
  // destinataires
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [recipientIds, setRecipientIds] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [p, d] = await Promise.all([
          fetchJSON<ApiList<ProjectLite>>("/guestmarkets/api/projects/lite").catch(
            () => ({ items: [] })
          ),
          fetchJSON<ApiList<DepartmentLite>>("/guestmarkets/api/departments/lite").catch(
            () => ({ items: [] })
          ),
        ]);
        setProjects(p.items || []);
        setDepts(d.items || []);
      } catch {
        setProjects([]);
        setDepts([]);
      }
    })();
  }, [open]);

  useEffect(() => {
    // auto dates
    if (type === "daily") {
      const t = todayStr();
      setPeriodStart(t);
      setPeriodEnd(t);
    }
    if (type === "monthly") {
      const [y, m] = month.split("-").map(Number);
      const start = new Date(y, m - 1, 1),
        end = new Date(y, m, 0),
        today = new Date();
      const cap = end > today ? today : end;
      setPeriodStart(start.toISOString().slice(0, 10));
      setPeriodEnd(cap.toISOString().slice(0, 10));
    }
  }, [type, month]);

  const refreshCandidates = useCallback(
    async (pid: number | "", did: number | "") => {
      try {
        const qs = new URLSearchParams();
        if (pid !== "") qs.set("projectId", String(pid));
        if (did !== "") qs.set("departmentId", String(did));
        const { candidates } = await fetchJSON<{ candidates: Candidate[] }>(
          `/guestmarkets/api/reports/candidates?${qs.toString()}`
        );
        setCandidates(candidates || []);
        const allowed = new Set((candidates || []).map((c) => c.id));
        const keep = recipientIds.filter((id) => allowed.has(id));
        setRecipientIds(keep.length ? keep : Array.from(allowed));
      } catch {
        setCandidates([]);
        setRecipientIds([]);
      }
    },
    [recipientIds]
  );

  useEffect(() => {
    if (!open) return;
    void refreshCandidates(projectId, departmentId);
  }, [open, projectId, departmentId, refreshCandidates]);

  function validWeekly(a: string, b: string) {
    const da = new Date(a),
      db = new Date(b);
    const diff = Math.round((db.getTime() - da.getTime()) / 86400000) + 1;
    return diff === 7 && db <= new Date();
  }
  function validMonthly(a: string, b: string) {
    const da = new Date(a),
      db = new Date(b);
    const diff = Math.round((db.getTime() - da.getTime()) / 86400000) + 1;
    const last = new Date(da.getFullYear(), da.getMonth() + 1, 0).getDate();
    return diff === last && db <= new Date();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) return setErr("Titre requis");
    if (type === "weekly" && !validWeekly(periodStart, periodEnd))
      return setErr("Hebdomadaire : exactement 7 jours et pas au-delà d’aujourd’hui.");
    if (type === "monthly" && !validMonthly(periodStart, periodEnd))
      return setErr("Mensuel : exactement le mois sélectionné (30/31 jours) et pas au-delà d’aujourd’hui.");
    if (recipientIds.length === 0) return setErr("Sélectionnez au moins un destinataire.");

    setSaving(true);
    try {
      await onSubmit(
        {
          title: title.trim(),
          type,
          summary: summary.trim() || null,
          periodStart,
          periodEnd,
          projectId: projectId === "" ? null : Number(projectId),
          departmentId: departmentId === "" ? null : Number(departmentId),
          recipientIds,
        },
        file
      );
      onClose();
      // reset
      setTitle("");
      setType("daily");
      setSummary("");
      const t = todayStr();
      setPeriodStart(t);
      setPeriodEnd(t);
      setProjectId("");
      setDepartmentId("");
      setFile(null);
      setCandidates([]);
      setRecipientIds([]);
    } catch (errUnknown: unknown) {
      const msg = errUnknown instanceof Error ? errUnknown.message : "Erreur inconnue";
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouveau rapport" size="lg">
      <form onSubmit={submit} className="space-y-3">
        {err && (
          <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">
            <AlertCircle className="w-4 h-4 inline mr-1" /> {err}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Titre</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-800"
            />
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ReportType)}
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-800"
            >
              <option value="daily">Journalier</option>
              <option value="weekly">Hebdomadaire</option>
              <option value="monthly">Mensuel</option>
              <option value="incident">Incident</option>
              <option value="meeting">Compte-rendu</option>
              <option value="other">Autre</option>
            </select>
          </div>

          {type === "daily" && (
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] text-slate-600 mb-1">Date</label>
                <input
                  type="date"
                  value={periodStart}
                  disabled
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-slate-50 text-slate-500 text-sm"
                />
              </div>
            </div>
          )}

          {type === "weekly" && (
            <>
              <div>
                <label className="block text-[12px] text-slate-600 mb-1">Période — début</label>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-[12px] text-slate-600 mb-1">Période — fin</label>
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
              </div>
            </>
          )}

          {type === "monthly" && (
            <>
              <div>
                <label className="block text-[12px] text-slate-600 mb-1">Mois</label>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
              </div>
              <div className="grid content-end text-[12px] text-slate-600">
                De <b>{periodStart}</b> à <b>{periodEnd}</b>
              </div>
            </>
          )}

          {(type === "incident" || type === "meeting" || type === "other") && (
            <>
              <div>
                <label className="block text-[12px] text-slate-600 mb-1">Période — début</label>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-[12px] text-slate-600 mb-1">Période — fin</label>
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Projet (facultatif)</label>
            <select
              value={projectId === "" ? "" : String(projectId)}
              onChange={(e) =>
                setProjectId(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-800"
            >
              <option value="">— Aucun —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">
              Département (facultatif)
            </label>
            <select
              value={departmentId === "" ? "" : String(departmentId)}
              onChange={(e) =>
                setDepartmentId(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-800"
            >
              <option value="">— Aucun —</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <RecipientPicker
              candidates={candidates}
              value={recipientIds}
              onChange={setRecipientIds}
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-[12px] text-slate-600 mb-1">Résumé</label>
            <textarea
              value={summary ?? ""}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full min-h-[90px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y text-sm text-slate-800"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5">
              <Paperclip className="w-4 h-4" /> Pièce jointe (PDF)
            </label>
            <label className="flex items-center justify-center w-full h-10 rounded-xl ring-1 ring-slate-200 bg-white text-sm text-gray-700 cursor-pointer hover:bg-slate-50">
              <span>{file ? file.name : "Sélectionner un fichier"}</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
            <div className="text-[11px] text-slate-500 mt-1">
              Optionnel : peut être ajouté après création.
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 rounded-xl ring-1 ring-slate-200 hover:bg-slate-50 text-slate-700"
          >
            Annuler
          </button>
          <button
            disabled={saving}
            className={cls(
              "px-4 h-10 rounded-xl text-white font-semibold",
              saving ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"
            )}
          >
            {saving ? "Création…" : "Créer le rapport"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* =============================== Modale édition =============================== */
function ReportEditModal({
  open,
  onClose,
  report,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  report: Report | null;
  onSave: (patch: EditReportPatch) => Promise<void>;
}) {
  const r = report;
  const disabled = !r || !["draft", "changes_requested"].includes(r.status);

  const [title, setTitle] = useState(r?.title || "");
  const [summary, setSummary] = useState(r?.summary || "");
  const [periodStart, setPeriodStart] = useState(r?.periodStart || todayStr());
  const [periodEnd, setPeriodEnd] = useState(r?.periodEnd || todayStr());
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(r?.title || "");
    setSummary(r?.summary || "");
    setPeriodStart(r?.periodStart || todayStr());
    setPeriodEnd(r?.periodEnd || todayStr());
    setErr(null);
    setSaving(false);
  }, [open, r?.id, r?.title, r?.summary, r?.periodStart, r?.periodEnd]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!r) return;
    setErr(null);
    if (!title.trim()) return setErr("Titre requis");
    setSaving(true);
    try {
      await onSave({
        id: r.id,
        title: title.trim(),
        summary: summary.trim() || null,
        periodStart,
        periodEnd,
      });
      onClose();
    } catch (errUnknown: unknown) {
      const msg = errUnknown instanceof Error ? errUnknown.message : "Erreur";
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={disabled ? "Consulter le brouillon" : "Modifier le brouillon"}
      size="lg"
    >
      {!r ? null : (
        <form
          onSubmit={submit}
          className={cls("space-y-3", disabled && "opacity-60 pointer-events-none")}
        >
          {err && (
            <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">
              <AlertCircle className="w-4 h-4 inline mr-1" /> {err}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">Titre</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none text-sm"
              />
            </div>
            <div className="grid content-end text-[12px] text-slate-600">
              Statut : <b>{r.status}</b>
            </div>
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">
                Période — début
              </label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-[12px] text-slate-600 mb-1">
                Période — fin
              </label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[12px] text-slate-600 mb-1">Résumé</label>
              <textarea
                value={summary ?? ""}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full min-h-[90px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 outline-none resize-y text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-10 rounded-xl ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Fermer
            </button>
            {!disabled && (
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

/* =============================== Modale Détails (reçu) =============================== */
function ReportDetailModal({
  open,
  onClose,
  reportId,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  reportId: number | null;
  onAction: (action: "approved" | "rejected" | "changes_requested", message?: string) => Promise<void>;
}) {
  const [item, setItem] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [acting, setActing] = useState<ReportStatus | null>(null);

  useEffect(() => {
    (async () => {
      if (!open || !reportId) return;
      try {
        setLoading(true);
        setErr(null);
        const { item } = await fetchJSON<ApiItem<Report>>(
          `/guestmarkets/api/reports/${reportId}`
        );
        setItem(item);
      } catch (errUnknown: unknown) {
        const msg = errUnknown instanceof Error ? errUnknown.message : "Erreur";
        setErr(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, reportId]);

  async function runAction(action: "approved" | "rejected" | "changes_requested") {
    try {
      setActing(action);
      await onAction(action, message.trim() || undefined);
      onClose();
    } finally {
      setActing(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Détails du rapport" size="lg">
      {!item ? (
        <div className="text-slate-500 text-sm">
          {loading ? "Chargement…" : err ?? "—"}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl bg-gradient-to-r from-sky-600 via-indigo-500 to-emerald-500 text-white p-4">
            <div className="text-lg font-semibold">{item.title}</div>
            <div className="text-[12px] text-white/90">
              {item.type} • {item.periodStart} → {item.periodEnd}
            </div>
            <div className="text-[12px] text-white/90 mt-1">
              Auteur : {item.authorName ?? "—"}
            </div>
          </div>

          {item.summary && (
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
              <div className="text-[11px] text-slate-500 mb-1">Résumé</div>
              <div className="text-[13px] text-slate-800 whitespace-pre-wrap">
                {item.summary}
              </div>
            </div>
          )}

          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
            <div className="text-[11px] text-slate-500 mb-1">Pièces jointes</div>
            <div className="flex flex-wrap gap-1">
              {item.files.length ? (
                item.files.map((f) => (
                  <a
                    key={f.id}
                    className="text-slate-500 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 ring-1 ring-slate-200 text-[12px] hover:bg-slate-200"
                    href={`/guestmarkets/api/reports/files/${f.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText className="text-slate-500 w-3.5 h-3.5" /> {f.original_name}
                  </a>
                ))
              ) : (
                <span className="text-[12px] text-slate-500">Aucune pièce.</span>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
            <label className="block text-[12px] text-slate-600 mb-1 flex items-center gap-1.5">
              <ClipboardEdit className="w-4 h-4" /> Motif / corrections (si pertinent)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full min-h-[80px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y text-sm"
            />
          </div>

          {/* Actions de décision */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => runAction("changes_requested")}
              disabled={acting !== null}
              className={cls(
                "h-9 px-3 rounded-lg text-white text-sm inline-flex items-center gap-1",
                acting === "changes_requested" ? "bg-amber-400 cursor-wait" : "bg-amber-500 hover:bg-amber-600"
              )}
              title="Demander des corrections"
            >
              <MessageSquareWarning className="w-4 h-4" />
              {acting === "changes_requested" ? "Envoi…" : "Corrections"}
            </button>
            <button
              onClick={() => runAction("rejected")}
              disabled={acting !== null}
              className={cls(
                "h-9 px-3 rounded-lg text-white text-sm inline-flex items-center gap-1",
                acting === "rejected" ? "bg-rose-400 cursor-wait" : "bg-rose-600 hover:bg-rose-700"
              )}
              title="Rejeter"
            >
              <XCircle className="w-4 h-4" />
              {acting === "rejected" ? "Envoi…" : "Rejeter"}
            </button>
            <button
              onClick={() => runAction("approved")}
              disabled={acting !== null}
              className={cls(
                "h-9 px-3 rounded-lg text-white text-sm inline-flex items-center gap-1",
                acting === "approved" ? "bg-emerald-400 cursor-wait" : "bg-emerald-600 hover:bg-emerald-700"
              )}
              title="Approuver"
            >
              <CheckCircle2 className="w-4 h-4" />
              {acting === "approved" ? "Envoi…" : "Approuver"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* =============================== Page =============================== */
export default function ReportsPage() {
  const [scope, setScope] = useState<"sent" | "received">("sent");
  const [items, setItems] = useState<Report[]>([]);
  const [stats, setStats] = useState<Partial<ReportStats>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ReportStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ReportType>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Report | null>(null);

  const [uploadFor, setUploadFor] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [detailId, setDetailId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([
        fetchJSON<ApiList<Report>>(`/guestmarkets/api/reports?scope=${scope}`),
        fetchJSON<Partial<ReportStats>>(`/guestmarkets/api/reports/stats?scope=${scope}`),
      ]);
      setItems(list.items || []);
      setStats(st || {});
      setErr(null);
    } catch (errUnknown: unknown) {
      const msg = errUnknown instanceof Error ? errUnknown.message : "Erreur chargement";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const list = useMemo(() => {
    let arr = items.slice();
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter(
        (r) =>
          r.title.toLowerCase().includes(s) ||
          (r.summary ?? "").toLowerCase().includes(s)
      );
    }
    if (statusFilter !== "all") {
      arr = arr.filter(
        (r) =>
          (scope === "received" ? r.inboxStatus || r.status : r.status) === statusFilter
      );
    }
    if (typeFilter !== "all") {
      arr = arr.filter((r) => r.type === typeFilter);
    }
    return arr;
  }, [items, q, statusFilter, typeFilter, scope]);

  async function create(payload: CreateReportPayload, file?: File | null) {
    let fileName: string | undefined,
      fileContent: string | undefined,
      mimeType: string | undefined;
    if (file) {
      mimeType = file.type || "application/pdf";
      const buf = await file.arrayBuffer();
      fileName = file.name;
      fileContent = arrayBufferToBase64(buf);
    }
    await fetchJSON<unknown>(`/guestmarkets/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, fileName, fileContent, mimeType }),
    });
    setScope("sent");
    await refresh();
  }

  async function saveEdit(patch: EditReportPatch) {
    await fetchJSON<unknown>(`/guestmarkets/api/reports/${patch.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await refresh();
  }

  async function submitReport(id: number) {
    await fetchJSON<unknown>(`/guestmarkets/api/reports/${id}/submit`, {
      method: "POST",
    });
    await refresh();
  }

  async function uploadPdf(reportId: number, file: File) {
    const fd = new FormData();
    fd.set("file", file);
    const data = await fetchJSON<ApiFileCreated>(
      `/guestmarkets/api/reports/${reportId}/files`,
      { method: "POST", body: fd }
    );
    setItems((prev) =>
      prev.map((r) => (r.id === reportId ? { ...r, files: [data.file, ...(r.files || [])] } : r))
    );
  }

  async function actOnReport(
    action: "approved" | "rejected" | "changes_requested",
    message?: string
  ) {
    if (!detailId) return;
    await fetchJSON<unknown>(`/guestmarkets/api/reports/${detailId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, message }),
    });
    setDetailId(null);
    await refresh();
  }

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Rapports">
      <StatsBar scope={scope} stats={stats} />

      {/* Toolbar */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 mt-3 mb-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
            <button
              onClick={() => setScope("sent")}
              className={cls(
                "px-3 h-9 rounded-lg text-sm",
                scope === "sent" ? "bg-indigo-600 text-white" : "text-slate-700"
              )}
            >
              Envoyés
            </button>
            <button
              onClick={() => setScope("received")}
              className={cls(
                "px-3 h-9 rounded-lg text-sm",
                scope === "received" ? "bg-fuchsia-600 text-white" : "text-slate-700"
              )}
            >
              Reçus
            </button>
          </div>

          <div className="relative ml-0 lg:ml-3">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un rapport…"
              className="text-gray-700 h-9 pl-7 pr-2 rounded-lg ring-1 ring-slate-200 focus:ring-indigo-500 outline-none text-sm"
            />
          </div>

          <div className="flex gap-2 lg:ml-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ReportStatus | "all")}
              className="text-gray-700 h-9 px-2 rounded-lg ring-1 ring-slate-200 bg-white text-sm"
            >
              <option value="all">Tous statuts</option>
              <option value="draft">Brouillon</option>
              <option value="submitted">Soumis</option>
              <option value="under_review">En revue</option>
              <option value="approved">Approuvé</option>
              <option value="rejected">Rejeté</option>
              <option value="changes_requested">Corrections demandées</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ReportType | "all")}
              className="text-gray-700 h-9 px-2 rounded-lg ring-1 ring-slate-200 bg-white text-sm"
            >
              <option value="all">Tous types</option>
              <option value="daily">Journalier</option>
              <option value="weekly">Hebdo</option>
              <option value="monthly">Mensuel</option>
              <option value="incident">Incident</option>
              <option value="meeting">Compte-rendu</option>
              <option value="other">Autre</option>
            </select>
            <button
              onClick={() => setCreateOpen(true)}
              className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
            >
              + Nouveau
            </button>
          </div>
        </div>
      </section>

      {/* Liste */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {loading && <div className="col-span-full text-sm text-slate-500">Chargement…</div>}
        {err && !loading && (
          <div className="col-span-full text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            <AlertCircle className="w-4 h-4 inline mr-1" /> {err}
          </div>
        )}

        {!loading &&
          list.map((r, idx) => (
            <div
              key={r.id}
              className={cls(
                "rounded-2xl border p-3 transition bg-white",
                scope === "received" && r.unread ? "ring-2 ring-fuchsia-400" : "hover:shadow-md"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{r.title}</div>
                  <div className="text-[12px] text-slate-500">
                    {r.type} • {r.periodStart} → {r.periodEnd}
                  </div>
                  {scope === "received" ? (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      De : {r.authorName ?? "—"}
                    </div>
                  ) : r.recipients?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.recipients.map((u, i) => {
                        const tone = tonePool[(u.id + i + idx) % tonePool.length];
                        return (
                          <span
                            key={u.id}
                            className={cls(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ring-1",
                              tone
                            )}
                          >
                            {u.name}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 mt-1">Aucun destinataire.</div>
                  )}
                </div>
                <span
                  className={cls(
                    "px-2 py-0.5 rounded-md text-[11px] ring-1",
                    (scope === "received" ? r.inboxStatus : r.status) === "approved"
                      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                      : (scope === "received" ? r.inboxStatus : r.status) === "rejected"
                      ? "bg-rose-50 text-rose-700 ring-rose-200"
                      : (scope === "received" ? r.inboxStatus : r.status) === "changes_requested"
                      ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : (scope === "received" ? r.inboxStatus : r.status) === "under_review"
                      ? "bg-indigo-50 text-indigo-800 ring-indigo-200"
                      : (scope === "received" ? r.inboxStatus : r.status) === "submitted"
                      ? "bg-sky-50 text-sky-800 ring-sky-200"
                      : "bg-slate-100 text-slate-700 ring-slate-200"
                  )}
                >
                  {scope === "received" ? r.inboxStatus || r.status : r.status}
                </span>
              </div>

              {r.summary && (
                <div className="mt-2 text-[13px] text-slate-700 line-clamp-3">{r.summary}</div>
              )}

              {/* Fichiers */}
              <div className="mt-2">
                <div className="text-[12px] text-slate-500 mb-1">Pièces jointes</div>
                <div className="text-slate-500 flex flex-wrap gap-1">
                  {r.files.map((f) => (
                    <a
                      key={f.id}
                      className="text-slate-700 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 ring-1 ring-slate-200 text-[12px] hover:bg-slate-200"
                      href={`/guestmarkets/api/reports/files/${f.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileText className="text-slate-700 w-3.5 h-3.5" /> {f.original_name}
                    </a>
                  ))}
                  {r.files.length === 0 && (
                    <span className="text-[12px] text-slate-500">Aucune pièce.</span>
                  )}
                </div>

                {scope === "sent" && (r.status === "draft" || r.status === "changes_requested") && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !uploadFor) return;
                        await uploadPdf(uploadFor, file);
                        if (fileRef.current) fileRef.current.value = "";
                        setUploadFor(null);
                      }}
                    />
                    <button
                      onClick={() => {
                        setUploadFor(r.id);
                        fileRef.current?.click();
                      }}
                      className="text-slate-500  h-8 px-2 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-[12.5px] inline-flex items-center gap-1"
                    >
                      <Upload className="w-4 h-4" /> Joindre un PDF
                    </button>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-3 flex justify-end gap-1.5">
                {scope === "sent" ? (
                  r.status === "draft" || r.status === "changes_requested" ? (
                    <>
                      <button
                        onClick={() => {
                          setEditItem(r);
                          setEditOpen(true);
                        }}
                        className="h-8 px-2.5 rounded-lg bg-amber-500 text-white text-[12.5px] hover:bg-amber-600 inline-flex items-center gap-1"
                      >
                        <Pencil className="w-4 h-4" /> Modifier
                      </button>
                      <button
                        onClick={() => submitReport(r.id)}
                        className="h-8 px-2.5 rounded-lg bg-indigo-600 text-white text-[12.5px] hover:bg-indigo-700 inline-flex items-center gap-1"
                      >
                        <Send className="w-4 h-4" /> Soumettre
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDetailId(r.id)}
                      className="h-8 px-2.5 rounded-lg bg-slate-800 text-white text-[12.5px] hover:bg-slate-900 inline-flex items-center gap-1"
                    >
                      <Eye className="w-4 h-4" /> Détails
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => setDetailId(r.id)}
                    className="h-8 px-2.5 rounded-lg bg-fuchsia-600 text-white text-[12.5px] hover:bg-fuchsia-700 inline-flex items-center gap-1"
                  >
                    <Search className="w-4 h-4" /> Détails / Décider
                  </button>
                )}
              </div>
            </div>
          ))}
        {!loading && list.length === 0 && (
          <div className="col-span-full text-sm text-slate-500">Aucun rapport.</div>
        )}
      </section>

      {/* Modales */}
      <ReportCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={create}
      />
      <ReportEditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        report={editItem}
        onSave={saveEdit}
      />
      <ReportDetailModal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        reportId={detailId}
        onAction={actOnReport}
      />
    </Shell>
  );
}
