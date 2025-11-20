// app/admin/departements/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Shell from "../../components/Shell";
import Modal from "../../components/ui/Modal";
import { Building2, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import type { Company } from "../../../../lib/company";

/* -------------------- Types -------------------- */
type DeptStatus = "active" | "archived";
type DeptColor = "blue" | "indigo" | "emerald" | "slate";

export interface Department {
  id: number | string;
  name: string;
  code: string;
  manager: string | null; // alias manager_name
  manager_id: number | null;
  memberCount: number;
  status: DeptStatus;
  color: DeptColor;
  description: string | null;
  createdAt: string; // ISO (dateStrings depuis pool)
  updatedAt: string; // ISO
  company: Company; // dérivé côté API
  notes?: { id: number | string; text: string; createdAt: string; author?: string | null }[];
}

type DeptNote = NonNullable<Department["notes"]>[number];

type UserLite = {
  id: number;
  name: string;
  email: string;
  company: Company;
  is_manager: 0 | 1;
};

/** --- Types des payloads API --- */
type ApiList<T> = { items: T[] };
type ApiItem<T> = { item: T };
type ApiErrorShape = { error?: string };

type ApiDepartment = {
  id: number | string;
  name: string;
  code: string;
  manager_name?: string | null;
  manager_id?: number | null;
  member_count?: number;
  status: DeptStatus;
  color: DeptColor;
  description?: string | null;
  created_at: string;
  updated_at: string;
  company?: Company;
};

type ApiNote = {
  id: number | string;
  text: string;
  createdAt: string;
  author?: string | null;
};

/* -------------------- Helpers -------------------- */
const cls = (...a: Array<string | false | null | undefined>) =>
  a.filter(Boolean).join(" ");
const fmt = (d: string) => new Date(d).toLocaleDateString();

const FALLBACK_COMPANY = "Other" as Company;

function isApiErrorShape(x: unknown): x is ApiErrorShape {
  return typeof x === "object" && x !== null && "error" in x;
}

async function fetchJSON<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const res = await fetch(url, { credentials: "include", ...init, headers });
  const ct = res.headers.get("content-type") || "";
  let data: unknown = null;

  if (ct.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = { error: "JSON invalide renvoyé par le serveur" };
    }
  } else {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      const preview = (text || "").replace(/\s+/g, " ").slice(0, 200);
      data = { error: preview || "Réponse non-JSON" };
    }
  }

  if (!res.ok) {
    const msg = isApiErrorShape(data) && data.error ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

const Badge = ({
  tone = "blue",
  children,
}: {
  tone?: "blue" | "gray" | "green" | "indigo";
  children: React.ReactNode;
}) => {
  const map = {
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    gray: "bg-slate-100 text-slate-700 ring-slate-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  } as const;
  return (
    <span className={cls("px-2 py-1 rounded-lg text-xs ring-1", map[tone])}>
      {children}
    </span>
  );
};

/* -------- Code auto depuis le nom + anticollision -------- */
function generateDeptCode(name: string) {
  const n = name.trim();
  if (!n) return "";
  const parts = n.split(/\s+|&|-/).filter(Boolean);
  let raw = parts.slice(0, 3).map((p) => p[0]).join("");
  if (!raw) raw = n.slice(0, 3);
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
}
function ensureUniqueCode(code: string, existing: string[]) {
  if (!code) return code;
  if (!existing.includes(code)) return code;
  let i = 2;
  while (existing.includes(code + i)) i++;
  return code + i;
}

/* -------------------- Util pour la liste (hors composant) -------------------- */
function derivedList(
  arr: Department[],
  query: string,
  cf: Company | "all",
  s: "name" | "members" | "created"
) {
  let out = arr.slice();
  if (cf !== "all") out = out.filter((d) => d.company === cf);
  if (query.trim()) {
    const t = query.trim().toLowerCase();
    out = out.filter(
      (d) =>
        d.name.toLowerCase().includes(t) ||
        d.code.toLowerCase().includes(t) ||
        (d.manager || "").toLowerCase().includes(t)
    );
  }
  out.sort((a, b) => {
    if (s === "name") return a.name.localeCompare(b.name);
    if (s === "members") return (b.memberCount || 0) - (a.memberCount || 0);
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
  return out;
}

/* -------------------- Modales -------------------- */
function EditDeptModal({
  open,
  onClose,
  dept,
  onSave,
  existingCodes,
  managersByCompany,
  companies,
}: {
  open: boolean;
  onClose: () => void;
  dept: Department | null; // null = création
  onSave: (payload: {
    id?: number | string;
    name: string;
    code: string;
    color: DeptColor;
    description: string | null;
    manager_id: number | null;
    company: Company;
  }) => Promise<void>;
  existingCodes: string[];
  managersByCompany: Record<Company, UserLite[]>;
  companies: Company[];
}) {
  const [name, setName] = useState(dept?.name ?? "");
  const [code, setCode] = useState(dept?.code ?? "");
  const [color, setColor] = useState<DeptColor>(
    (dept?.color as DeptColor) ?? "blue"
  );
  const [desc, setDesc] = useState(dept?.description ?? "");
  const [company, setCompany] = useState<Company>(
    (dept?.company as Company) ?? "Guest Markets"
  );
  const [managerId, setManagerId] = useState<number | null>(
    dept?.manager_id ?? null
  );
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Regénère le code en création uniquement
  useEffect(() => {
    if (!dept) {
      const gen = generateDeptCode(name);
      setCode(ensureUniqueCode(gen, existingCodes));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  useEffect(() => {
    if (dept) {
      setName(dept.name);
      setCode(dept.code);
      setColor(dept.color);
      setDesc(dept.description ?? "");
      setCompany((dept.company as Company) ?? "Guest Markets");
      setManagerId(dept.manager_id ?? null);
    } else {
      setName("");
      setCode("");
      setColor("blue");
      setDesc("");
      setCompany("Guest Markets");
      setManagerId(null);
    }
    setErr(null);
    setSaving(false);
  }, [dept, open]);

  const managerOptions = useMemo(
    () => managersByCompany[company] || [],
    [company, managersByCompany]
  );

  function validate() {
    if (!name.trim()) return "Le nom est requis.";
    if (!code.trim()) return "Le code est requis.";
    if (!company) return "L’entreprise est requise.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }
    setSaving(true);
    await onSave({
      id: dept?.id,
      name: name.trim(),
      code: code.trim().toUpperCase(),
      color,
      description: desc.trim() || null,
      manager_id: managerId,
      company,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={dept ? "Modifier le département" : "Créer un département"}
      size="lg"
    >
      <form onSubmit={submit} className="space-y-3">
        {err && (
          <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">
            {err}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Nom</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">Code</label>
            <input
              value={code}
              readOnly
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-slate-50 text-slate-700 outline-none"
            />
            <div className="text-[11px] text-slate-500 mt-0.5">
              Généré automatiquement (anticollision).
            </div>
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">
              Entreprise
            </label>
            <select
              value={company}
              onChange={(e) => setCompany(e.target.value as Company)}
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">
              Responsable
            </label>
            <select
              value={managerId ?? ""}
              onChange={(e) =>
                setManagerId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full h-10 px-3 rounded-xl ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">— Aucun —</option>
              {managerOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.email}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Liste filtrée selon l’entreprise.
            </div>
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 mb-1">
              Couleur
            </label>
            <div className="flex items-center gap-2">
              {(["blue", "indigo", "emerald", "slate"] as DeptColor[]).map(
                (c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setColor(c)}
                    className={cls(
                      "w-9 h-9 rounded-xl ring-2",
                      color === c ? "ring-indigo-500" : "ring-slate-200",
                      "grid place-items-center bg-white"
                    )}
                    title={c}
                  >
                    <span
                      className={cls("inline-block w-2.5 h-2.5 rounded-full", {
                        blue: "bg-blue-600",
                        indigo: "bg-indigo-600",
                        emerald: "bg-emerald-600",
                        slate: "bg-slate-600",
                      }[c])}
                    />
                  </button>
                )
              )}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[12px] text-slate-600 mb-1">
              Description
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full min-h-[90px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            disabled={saving}
            className={cls(
              "px-4 h-9 rounded-lg text-white",
              saving ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"
            )}
          >
            {saving ? "Enregistrement…" : dept ? "Enregistrer" : "Créer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------- Petite modale "Note" -------------------- */
function NoteQuick({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (t: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Ajouter une note" size="md">
      <div className="space-y-3">
        {err && (
          <div className="text-sm px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700">
            {err}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full min-h-[120px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y"
          placeholder="Votre note ou remarque…"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            onClick={async () => {
              setErr(null);
              if (!text.trim()) {
                setErr("La note est vide.");
                return;
              }
              setSaving(true);
              try {
                await onSubmit(text.trim());
                setText("");
                onClose();
              } catch (e) {
                const msg = e instanceof Error ? e.message : "Erreur inconnue";
                setErr(msg);
              } finally {
                setSaving(false);
              }
            }}
            className={cls(
              "px-4 h-9 rounded-lg text-white",
              saving ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"
            )}
          >
            {saving ? "Ajout…" : "Ajouter"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------- Page -------------------- */
export default function DepartmentsPage() {
  // Données
  const [items, setItems] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Entreprises
  const [companies, setCompanies] = useState<Company[]>([
    "Guest Markets",
    "Guest Cameroon",
  ]);
  const [companyFilter, setCompanyFilter] = useState<Company | "all">("all");

  // Managers par entreprise
  const INITIAL_MANAGERS_BY_COMPANY = {
    "Guest Markets": [] as UserLite[],
    "Guest Cameroon": [] as UserLite[],
    Other: [] as UserLite[],
  } satisfies Record<Company, UserLite[]>;

  const [managersByCompany, setManagersByCompany] =
    useState<Record<Company, UserLite[]>>(INITIAL_MANAGERS_BY_COMPANY);

  // Modales
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [noteDept, setNoteDept] = useState<Department | null>(null);

  // Recherche/tri
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "members" | "created">("name");

  // Chargement initial
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // Entreprises
        try {
          const data = await fetchJSON<ApiList<Company>>("/api/companies");
          if (data?.items?.length) setCompanies(data.items);
        } catch {
          // silencieux (endpoint optionnel)
        }

        // Managers par entreprise
        for (const c of ["Guest Markets", "Guest Cameroon"] as Company[]) {
          const data = await fetchJSON<ApiList<UserLite>>(
            `/api/users?company=${encodeURIComponent(c)}`
          );
          setManagersByCompany((prev) => ({ ...prev, [c]: data.items }));
        }

        // Départements
        const data = await fetchJSON<ApiList<ApiDepartment>>("/api/departments");
        const normalized = (data.items || []).map(normalizeDept);
        setItems(normalized);
        setErr(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erreur inconnue";
        setErr(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const existingCodes = useMemo(() => items.map((i) => i.code), [items]);

  const list = useMemo(
    () => derivedList(items, q, companyFilter, sort),
    [items, q, companyFilter, sort]
  );

  function normalizeDept(d: ApiDepartment): Department {
    return {
      id: d.id,
      name: d.name,
      code: d.code,
      manager: d.manager_name ?? null,
      manager_id: d.manager_id ?? null,
      memberCount: d.member_count ?? 0,
      status: d.status,
      color: d.color,
      description: d.description ?? null,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      company: d.company ?? FALLBACK_COMPANY,
      notes: [],
    };
  }

  async function createOrSave(payload: {
    id?: number | string;
    name: string;
    code: string;
    color: DeptColor;
    description: string | null;
    manager_id: number | null;
    company: Company;
  }) {
    if (!payload.id) {
      // Création
      const res = await fetchJSON<ApiItem<ApiDepartment>>("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          code: payload.code,
          color: payload.color,
          description: payload.description,
          manager_id: payload.manager_id,
        }),
      });
      const d = normalizeDept(res.item);
      setItems((prev) => [d, ...prev]);
    } else {
      // Edition
      const res = await fetchJSON<ApiItem<ApiDepartment>>(
        `/api/departments/${payload.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            code: payload.code,
            color: payload.color,
            description: payload.description,
            manager_id: payload.manager_id,
          }),
        }
      );
      const d = normalizeDept(res.item);
      const old = items.find((x) => x.id === payload.id);
      d.company = old?.company || payload.company; // conserve l'entreprise
      setItems((arr) => arr.map((x) => (x.id === payload.id ? d : x)));
    }
  }

  async function removeDept(d: Department) {
    if (!confirm(`Supprimer le département « ${d.name} » ?`)) return;
    await fetchJSON<unknown>(`/api/departments/${d.id}`, { method: "DELETE" });
    setItems((arr) => arr.filter((x) => x.id !== d.id));
  }

  async function addNote(id: number | string, text: string) {
    const data = await fetchJSON<{ note: ApiNote }>(
      `/api/departments/${id}/notes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }
    );
    const note: DeptNote = {
      id: data.note.id,
      text: data.note.text,
      createdAt: data.note.createdAt,
      author: data.note.author ?? null,
    };
    setItems((arr) =>
      arr.map((x) => (x.id === id ? { ...x, notes: [note, ...(x.notes ?? [])] } : x))
    );
  }

  const EMPTY_DEPT_FOR_CREATE: Department = {
    id: "", // id falsy => la modale passera dept=null à EditDeptModal
    name: "",
    code: "",
    manager: null,
    manager_id: null,
    memberCount: 0,
    status: "active",
    color: "blue",
    description: null,
    createdAt: "",
    updatedAt: "",
    company: companies[0] ?? FALLBACK_COMPANY,
    notes: [],
  };

  /* -------------------- Render (avec Shell) -------------------- */
  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Départements">
      {/* En-tête + stats */}
      <section className="mb-2 rounded-3xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-500 text-white p-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Départements
            </h1>
            <p className="text-white/90">
              Structurez vos équipes par entreprise, en un coup d’œil.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditDept(EMPTY_DEPT_FOR_CREATE)} // id vide ⇒ création
              className="px-4 h-10 rounded-xl bg-white text-indigo-700 font-semibold hover:bg-slate-50"
            >
              + Créer un département
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-2xl bg-white/10 px-4 py-3">
            <div className="text-[12px]">Total</div>
            <div className="text-xl font-bold">{list.length}</div>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3">
            <div className="text-[12px]">Actifs</div>
            <div className="text-xl font-bold">
              {list.filter((d) => d.status === "active").length}
            </div>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3">
            <div className="text-[12px]">Archivés</div>
            <div className="text-xl font-bold">
              {list.filter((d) => d.status === "archived").length}
            </div>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3">
            <div className="text-[12px]">Effectif moyen</div>
            <div className="text-xl font-bold">
              {list.length
                ? Math.round(
                  list.reduce((s, d) => s + (d.memberCount || 0), 0) /
                  list.length
                )
                : 0}
            </div>
          </div>
        </div>
      </section>

      {/* Filtrer & trier */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3 md:p-3 m-2 md:m-1">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div className="text-[13px] text-slate-600">Filtrer et trier</div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher (nom, code, responsable)…"
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <select
              value={companyFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const v = e.target.value;
                setCompanyFilter(v === "all" ? "all" : (v as Company));
              }}
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="all">Toutes les entreprises</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const v = e.target.value as "name" | "members" | "created";
                setSort(v);
              }}
              className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="name">Tri par nom</option>
              <option value="members">Tri par effectif</option>
              <option value="created">Tri par création</option>
            </select>
          </div>
        </div>
      </section>

      {/* Liste */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-2">
        {loading && (
          <div className="col-span-full text-slate-500">Chargement…</div>
        )}
        {err && !loading && (
          <div className="col-span-full text-red-600">Erreur : {err}</div>
        )}

        {!loading &&
          !err &&
          list.map((d) => (
            <div
              key={d.id}
              className={cls(
                "rounded-2xl border p-4 hover:shadow-lg transition",
                d.color === "indigo" && "border-indigo-200 bg-indigo-50/60",
                d.color === "blue" && "border-blue-200 bg-blue-50/60",
                d.color === "emerald" && "border-emerald-200 bg-emerald-50/60",
                d.color === "slate" && "border-slate-200 bg-slate-50/60"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cls(
                        "inline-block w-2.5 h-2.5 rounded-full",
                        {
                          indigo: "bg-indigo-600",
                          blue: "bg-blue-600",
                          emerald: "bg-emerald-600",
                          slate: "bg-slate-600",
                        }[d.color]
                      )}
                    />
                    <div className="font-semibold text-slate-900 truncate">
                      {d.name}
                    </div>
                    <Badge tone="gray">{d.code}</Badge>
                  </div>
                  <div className="text:[12px] text-slate-500 mt-0.5">
                    Créé le {fmt(d.createdAt)}
                  </div>
                </div>
                <Badge tone="indigo">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5" />
                    {d.company}
                  </span>
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-white/70 ring-1 ring-slate-200 p-3">
                  <div className="text-[11px] text-slate-500">Responsable</div>
                  <div className="font-medium text-slate-900 truncate">
                    {d.manager || "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-white/70 ring-1 ring-slate-200 p-3">
                  <div className="text-[11px] text-slate-500">Effectif</div>
                  <div className="font-medium text-slate-900">
                    {d.memberCount}
                  </div>
                </div>
              </div>

              {d.description && (
                <div className="mt-3 text-[13px] text-slate-700 line-clamp-3">
                  {d.description}
                </div>
              )}

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  onClick={() => setNoteDept(d)}
                  className="inline-flex items-center gap-2 px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-white text-sm"
                  title="Ajouter une note"
                >
                  <MessageSquarePlus className="w-4 h-4" /> Note
                </button>
                <button
                  onClick={() => setEditDept(d)}
                  className="inline-flex items-center gap-2 px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-white text-sm"
                  title="Modifier"
                >
                  <Pencil className="w-4 h-4" /> Modifier
                </button>
                <button
                  onClick={() => removeDept(d)}
                  className="inline-flex items-center gap-2 px-3 h-9 rounded-lg text-white bg-red-600 hover:bg-red-700 text-sm"
                  title="Supprimer"
                >
                  <Trash2 className="w-4 h-4" /> Supprimer
                </button>
              </div>

              {(d.notes?.length ?? 0) > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <div className="text-[12px] text-slate-500 mb-1">
                    Dernières notes
                  </div>
                  <ul className="space-y-1 text-[13px] text-slate-700">
                    {(d.notes ?? []).slice(0, 2).map((n) => (
                      <li key={n.id} className="line-clamp-2">
                        • {n.text}
                      </li>
                    ))}
                    {(d.notes?.length ?? 0) > 2 && (
                      <li className="text-[12px] text-slate-500">
                        +{(d.notes?.length ?? 0) - 2} autre(s)…
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          ))}

        {!loading && !err && list.length === 0 && (
          <div className="col-span-full text-slate-500">Aucun département.</div>
        )}
      </section>

      {/* Modales */}
      <EditDeptModal
        open={!!editDept}
        onClose={() => setEditDept(null)}
        dept={editDept && (editDept.id ? editDept : null)}
        onSave={createOrSave}
        existingCodes={existingCodes}
        managersByCompany={managersByCompany}
        companies={companies}
      />

      {noteDept && (
        <NoteQuick
          open={!!noteDept}
          onClose={() => setNoteDept(null)}
          onSubmit={async (text) => {
            await addNote(noteDept.id, text);
            setNoteDept(null);
          }}
        />
      )}
    </Shell>
  );
}
