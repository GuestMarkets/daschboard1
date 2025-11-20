// app/admin/responsables/page.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Shell from "../../../components/Shell";
import Modal from "../../../components/ui/Modal";
import {
  Building2,
  Users,
  UserCheck,
  UserX,
  UserPlus,
  Search,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

/* ---------- Types ---------- */
type DeptLite = {
  id: number;
  name: string;
  code: string;
  managerId: number | null;
  managerName: string | null;
  memberCount: number;
};

type UserLite = {
  id: number;
  name: string;
  email: string;
  isManager: boolean;
  departmentId: number | null;
};

type MemberRow = {
  id: number;
  name: string;
  email: string;
  isManager: boolean;
};

/* ---------- Helpers ---------- */
const cls = (...a: Array<string | false | null | undefined>) =>
  a.filter(Boolean).join(" ");

/** Garde de type utilitaire pour manipuler des objets inconnus */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch {
    // ignore
  }

  const res = await fetch(url, { credentials: "include", ...init, headers });
  const ct = res.headers.get("content-type") || "";

  let data: unknown = null;

  if (ct.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      // On fabrique un objet standardisé qui porte un message d'erreur
      data = { error: (text || "").slice(0, 200) || "Réponse non-JSON" };
    }
  }

  if (!res.ok) {
    const errMsg =
      isRecord(data) && typeof data.error === "string"
        ? data.error
        : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return data as T;
}

/* ---------- Tokens couleur (doux & captivants) ---------- */
const tone = {
  // Accent principal (indigo/sky doux)
  accentBg: "bg-gradient-to-br from-indigo-50 via-sky-50 to-white",
  accentRing: "ring-indigo-200",
  accentText: "text-indigo-700",
  accentChip: "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200",

  // Success doux (emerald)
  okChip: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",

  // Warning doux (amber)
  warnText: "text-amber-700",
  warnChip: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",

  // Neutral & surfaces
  card: "bg-white border border-slate-200 shadow-sm",
  cardHover: "hover:shadow-md transition-shadow",
  field:
    "h-9 px-3 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-400 outline-none bg-white",
  pill:
    "text-[12px] px-2 py-0.5 rounded-lg ring-1 ring-slate-200 bg-slate-50 text-slate-600",

  // CTA doux (indigo)
  cta:
    "inline-flex items-center gap-2 h-9 px-3 rounded-lg text-white bg-indigo-500 hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-300",
  ctaDisabled:
    "inline-flex items-center gap-2 h-9 px-3 rounded-lg text-white bg-slate-400 cursor-not-allowed",

  // Secondary button
  secondary:
    "px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300",

  // Danger
  danger: "px-3 h-9 rounded-lg bg-rose-600 text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-300",
};

/* ---------- Page ---------- */
export default function ResponsablesPage() {
  // Data
  const [departments, setDepartments] = useState<DeptLite[]>([]);
  const [eligibleManagers, setEligibleManagers] = useState<UserLite[]>([]);
  const [unassigned, setUnassigned] = useState<UserLite[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [selDept, setSelDept] = useState<DeptLite | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [qDept, setQDept] = useState("");
  const [qUnassigned, setQUnassigned] = useState("");
  const [bulkAssign, setBulkAssign] = useState<number[]>([]);
  const [changingManager, setChangingManager] = useState(false);
  const [selectedManagerId, setSelectedManagerId] = useState<number | "">("");

  const [confirmRemoveUser, setConfirmRemoveUser] = useState<{
    userId: number;
    name: string;
    deptName: string;
  } | null>(null);

  // load everything
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [d, m, u] = await Promise.all([
          fetchJSON<{ items: DeptLite[] }>("/api/responsables/departments"),
          fetchJSON<{ items: UserLite[] }>("/api/responsables/eligible-managers"),
          fetchJSON<{ items: UserLite[] }>("/api/responsables/unassigned-users"),
        ]);
        setDepartments(d.items || []);
        setEligibleManagers(m.items || []);
        setUnassigned(u.items || []);
        setErr(null);
        if ((d.items || []).length && !selDept) {
          setSelDept(d.items![0]);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur inconnue");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load members of selected department
  useEffect(() => {
    (async () => {
      if (!selDept) {
        setMembers([]);
        return;
      }
      try {
        const data = await fetchJSON<{ items: MemberRow[] }>(
          `/api/responsables/departments/${selDept.id}/members`
        );
        setMembers(data.items || []);
      } catch {
        setMembers([]);
      }
    })();
  }, [selDept]);

  const filteredDepts = useMemo(() => {
    if (!qDept.trim()) return departments;
    const s = qDept.trim().toLowerCase();
    return departments.filter(
      (d) =>
        d.name.toLowerCase().includes(s) ||
        d.code.toLowerCase().includes(s) ||
        (d.managerName || "").toLowerCase().includes(s)
    );
  }, [departments, qDept]);

  const filteredUnassigned = useMemo(() => {
    if (!qUnassigned.trim()) return unassigned;
    const s = qUnassigned.trim().toLowerCase();
    return unassigned.filter(
      (u) => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
    );
  }, [unassigned, qUnassigned]);

  const refreshAfterAssignOrRemove = useCallback(
    async (deptId: number) => {
      const [u2, mem, d2] = await Promise.all([
        fetchJSON<{ items: UserLite[] }>("/api/responsables/unassigned-users"),
        fetchJSON<{ items: MemberRow[] }>(`/api/responsables/departments/${deptId}/members`),
        fetchJSON<{ items: DeptLite[] }>("/api/responsables/departments"),
      ]);
      setUnassigned(u2.items || []);
      setMembers(mem.items || []);
      setDepartments(d2.items || []);
      const found = d2.items?.find((x) => x.id === deptId) || null;
      setSelDept(found);
    },
    []
  );

  async function setManagerForDept() {
    if (!selDept || !selectedManagerId) return;
    setChangingManager(true);
    try {
      await fetchJSON<{ department: DeptLite }>("/api/responsables/assign-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: selDept.id, userId: Number(selectedManagerId) }),
      });
      await refreshAfterAssignOrRemove(selDept.id);
      setSelectedManagerId("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la désignation");
    } finally {
      setChangingManager(false);
    }
  }

  async function assignUsersToDept() {
    if (!selDept || bulkAssign.length === 0) return;
    try {
      await fetchJSON("/api/responsables/assign-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: selDept.id, userIds: bulkAssign }),
      });
      await refreshAfterAssignOrRemove(selDept.id);
      setBulkAssign([]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l’affectation");
    }
  }

  async function removeUserFromDept(userId: number) {
    try {
      await fetchJSON("/api/responsables/remove-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (selDept) {
        await refreshAfterAssignOrRemove(selDept.id);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de la suppression");
    }
  }

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Responsables">
      {/* Bandeau subtil en dégradé pour dynamiser la page */}
      <div
        className={cls(
          "rounded-2xl mb-4 p-4 ring-1",
          tone.accentBg,
          tone.accentRing
        )}
        aria-hidden
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/70 ring-1 ring-slate-200">
            <Building2 className="w-4 h-4 text-slate-700" />
          </span>
          <div>
            <p className={cls("text-sm font-medium", tone.accentText)}>
              Gestion des responsables & affectations
            </p>
            <p className="text-[12px] text-slate-600">
              Définissez les responsables, organisez les équipes et gardez une vue claire par département.
            </p>
          </div>
        </div>
      </div>

      {/* ===== Content ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ----- Colonne 1: Départements (lg:4) ----- */}
        <section className={cls("lg:col-span-4 rounded-2xl", tone.card, tone.cardHover)}>
          {/* sticky header inside card */}
          <div className="sticky top-[72px] lg:top-[88px] z-10 bg-white/95 backdrop-blur rounded-t-2xl border-b border-slate-200 px-3 sm:px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-sky-100 text-sky-700 ring-1 ring-sky-200">
                <Building2 className="w-4 h-4" />
              </span>
              <h2 className="text-sm font-semibold text-slate-900">Départements</h2>
            </div>
            <div className="mt-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={qDept}
                  onChange={(e) => setQDept(e.target.value)}
                  placeholder="Rechercher…"
                  className={cls("w-full pl-7 pr-2", tone.field)}
                />
              </div>
            </div>
          </div>

          <div className="px-3 sm:px-4 py-3 space-y-2 max-h-[48vh] sm:max-h-[56vh] lg:max-h-[calc(100vh-220px)] overflow-y-auto">
            {loading && (
              <div className="text-slate-500 text-sm" aria-live="polite">
                Chargement…
              </div>
            )}
            {err && !loading && <div className="text-rose-600 text-sm">Erreur : {err}</div>}

            <ul className="space-y-2">
              {filteredDepts.map((d) => {
                const active = selDept?.id === d.id;
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => setSelDept(d)}
                      className={cls(
                        "w-full text-left rounded-xl p-3 ring-1 transition group",
                        active
                          ? "bg-indigo-50/80 ring-indigo-200"
                          : "bg-white ring-slate-200 hover:bg-slate-50"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {d.name}
                          </div>
                          <div className="text-[12px] text-slate-500">
                            {d.code} •{" "}
                            {d.managerName ? (
                              <span className={cls("font-medium", tone.okChip.replace("ring-1 ", ""))}>
                                Resp. {d.managerName}
                              </span>
                            ) : (
                              <span className={tone.warnText}>Responsable non défini</span>
                            )}
                          </div>
                        </div>
                        <div className={cls("text-[12px] px-2 py-0.5 rounded-lg shrink-0", tone.accentChip)}>
                          {d.memberCount} membre{d.memberCount > 1 ? "s" : ""}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
              {!loading && !err && filteredDepts.length === 0 && (
                <li className="text-sm text-slate-500">Aucun département.</li>
              )}
            </ul>
          </div>
        </section>

        {/* ----- Colonne 2: Responsable & membres (lg:5) ----- */}
        <section className={cls("lg:col-span-5 rounded-2xl", tone.card, tone.cardHover)}>
          <div className="sticky top-[72px] lg:top-[88px] z-10 bg-white/95 backdrop-blur rounded-t-2xl border-b border-slate-200 px-3 sm:px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
                <UserCheck className="w-4 h-4" />
              </span>
              <h2 className="text-sm font-semibold text-slate-900">
                Responsable & membres{" "}
                {selDept ? <span className="text-slate-500 text-sm">• {selDept.name}</span> : null}
              </h2>
            </div>
          </div>

          <div className="px-3 sm:px-4 py-3 space-y-3 max-h-[48vh] sm:max-h-[56vh] lg:max-h-[calc(100vh-220px)] overflow-y-auto">
            {!selDept && <div className="text-sm text-slate-500">Sélectionnez un département.</div>}

            {selDept && (
              <>
                {/* Responsable */}
                <div className="rounded-xl ring-1 ring-slate-200 p-3 bg-slate-50/40">
                  <div className="text-[12px] text-slate-600 mb-1">Responsable actuel</div>

                  {/* grid responsive */}
                  <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] sm:items-center gap-2">
                    <div className="font-medium text-slate-900 min-w-0">
                      <span className="truncate block">
                        {selDept?.managerName || "Non défini"}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <select
                        value={selectedManagerId}
                        onChange={(e) =>
                          setSelectedManagerId(e.target.value ? Number(e.target.value) : "")
                        }
                        className={cls("w-full min-w-0 max-w-full", tone.field)}
                      >
                        <option value="">— Choisir un responsable —</option>
                        {eligibleManagers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.email})
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      disabled={!selectedManagerId || changingManager}
                      onClick={setManagerForDept}
                      className={!selectedManagerId || changingManager ? tone.ctaDisabled : tone.cta}
                      title="Désigner le responsable"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Valider
                    </button>
                  </div>

                  <div className="text-[12px] text-slate-500 mt-1">
                    Changer de responsable <b>réaffecte automatiquement</b> l’ancien responsable en simple membre.
                  </div>
                </div>

                {/* Membres */}
                <div className="rounded-xl ring-1 ring-slate-200 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-200 text-[12px] text-slate-600 bg-white">
                    Membres du département
                  </div>
                  <div className="divide-y divide-slate-200">
                    {members.map((m) => (
                      <div
                        key={m.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50/60"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-slate-900 truncate">{m.name}</div>
                          <div className="text-[12px] text-slate-500 truncate">{m.email}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {m.isManager ? (
                            <span className={cls("text-[11px] px-2 py-0.5 rounded-lg", tone.warnChip)}>
                              Responsable
                            </span>
                          ) : (
                            <button
                              onClick={() =>
                                setConfirmRemoveUser({
                                  userId: m.id,
                                  name: m.name,
                                  deptName: selDept.name,
                                })
                              }
                              className="inline-flex items-center gap-1 h-8 px-2 rounded-lg ring-1 ring-slate-200 hover:bg-rose-50 hover:ring-rose-200 text-sm text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                              title="Retirer du département"
                            >
                              <UserX className="w-4 h-4" /> Retirer
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {members.length === 0 && (
                      <div className="px-3 py-3 text-[13px] text-slate-500">Aucun membre.</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ----- Colonne 3: Utilisateurs sans département (lg:3) ----- */}
        <section className={cls("lg:col-span-3 rounded-2xl", tone.card, tone.cardHover)}>
          <div className="sticky top-[72px] lg:top-[88px] z-10 bg-white/95 backdrop-blur rounded-t-2xl border-b border-slate-200 px-3 sm:px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-200">
                <Users className="w-4 h-4" />
              </span>
              <h2 className="text-sm font-semibold text-slate-900">
                Utilisateurs sans département
              </h2>
            </div>
            <div className="mt-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={qUnassigned}
                  onChange={(e) => setQUnassigned(e.target.value)}
                  placeholder="Rechercher…"
                  className={cls("w-full pl-7 pr-2", tone.field)}
                />
              </div>
            </div>
          </div>

          <div className="px-3 sm:px-4 py-3 max-h-[48vh] sm:max-h-[56vh] lg:max-h-[calc(100vh-260px)] overflow-y-auto">
            <ul className="space-y-1 pr-0.5">
              {filteredUnassigned.map((u) => {
                const checked = bulkAssign.includes(u.id);
                return (
                  <li key={u.id}>
                    {/* ⚠️ Fix: ne JAMAIS lire e.currentTarget.checked dans un setter */}
                    <label className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-indigo-500"
                        checked={checked}
                        onChange={(e) => {
                          const isChecked = (e.target as HTMLInputElement).checked;
                          setBulkAssign((prev) =>
                            isChecked ? [...prev, u.id] : prev.filter((x) => x !== u.id)
                          );
                        }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-slate-900 truncate">{u.name}</div>
                        <div className="text-[12px] text-slate-500 truncate">{u.email}</div>
                      </div>
                    </label>
                  </li>
                );
              })}
              {filteredUnassigned.length === 0 && (
                <li className="text-[13px] text-slate-500 px-1">Personne à afficher.</li>
              )}
            </ul>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-[12px] text-slate-600">
                {bulkAssign.length} sélectionné{bulkAssign.length > 1 ? "s" : ""}
              </div>
              <button
                disabled={!selDept || bulkAssign.length === 0}
                onClick={assignUsersToDept}
                className={!selDept || bulkAssign.length === 0 ? tone.ctaDisabled : tone.cta}
                title={selDept ? `Affecter à ${selDept.name}` : "Choisir un département"}
              >
                <UserPlus className="w-4 h-4" />
                Affecter
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Seuls les utilisateurs non-responsables sans
              département s’affichent ici.
            </div>
          </div>
        </section>
      </div>

      {/* Confirmation retirer un membre */}
      <Modal
        open={!!confirmRemoveUser}
        onClose={() => setConfirmRemoveUser(null)}
        title="Retirer du département"
        size="sm"
      >
        <div className="space-y-3 text-sm">
          <p>
            Retirer <b>{confirmRemoveUser?.name}</b> du département{" "}
            <b>« {confirmRemoveUser?.deptName} »</b> ?
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setConfirmRemoveUser(null)}
              className={tone.secondary}
            >
              Annuler
            </button>
            <button
              onClick={async () => {
                if (confirmRemoveUser) await removeUserFromDept(confirmRemoveUser.userId);
                setConfirmRemoveUser(null);
              }}
              className={tone.danger}
            >
              Confirmer
            </button>
          </div>
        </div>
      </Modal>
    </Shell>
  );
}
