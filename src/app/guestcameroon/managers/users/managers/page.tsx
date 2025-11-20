// app/admin/responsables/page.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "../../../components/Sidebar";
import TopBar from "../../../components/TopBar";
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

type ListResp<T> = { items: T[] };
type JSONError = { error?: string };

/* ---------- Helpers ---------- */
const cls = (...a: Array<string | false | null | undefined>) =>
  a.filter(Boolean).join(" ");

function errorMessage(err: unknown, fallback = "Erreur inconnue"): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return fallback;
}

async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch {
    // ignore SSR/localStorage access issues
  }

  const res = await fetch(url, { credentials: "include", ...init, headers });
  const ct = res.headers.get("content-type") || "";
  let data: unknown = null;

  if (ct.includes("application/json")) {
    try {
      const parsed = (await res.json()) as unknown;
      data = parsed;
    } catch {
      data = null;
    }
  } else {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as unknown;
      data = parsed;
    } catch {
      // Fournit un objet typé pour exposer un message d'erreur exploitable
      const fallbackErr: JSONError = { error: (text || "").slice(0, 200) || "Réponse non-JSON" };
      data = fallbackErr;
    }
  }

  if (!res.ok) {
    const maybeErr = (data ?? {}) as JSONError;
    throw new Error(maybeErr.error ?? `HTTP ${res.status}`);
  }

  return data as T;
}

/* ---------- Page ---------- */
export default function ResponsablesPage() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

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
          fetchJSON<ListResp<DeptLite>>("/api/responsables/departments"),
          fetchJSON<ListResp<UserLite>>("/api/responsables/eligible-managers"),
          fetchJSON<ListResp<UserLite>>("/api/responsables/unassigned-users"),
        ]);
        setDepartments(d.items || []);
        setEligibleManagers(m.items || []);
        setUnassigned(u.items || []);
        setErr(null);
        if ((d.items || []).length && !selDept) {
          setSelDept(d.items![0]);
        }
      } catch (e: unknown) {
        setErr(errorMessage(e));
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
        const data = await fetchJSON<ListResp<MemberRow>>(
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
        fetchJSON<ListResp<UserLite>>("/api/responsables/unassigned-users"),
        fetchJSON<ListResp<MemberRow>>(`/api/responsables/departments/${deptId}/members`),
        fetchJSON<ListResp<DeptLite>>("/api/responsables/departments"),
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
    } catch (e: unknown) {
      alert(errorMessage(e, "Échec de la désignation"));
    } finally {
      setChangingManager(false);
    }
  }

  async function assignUsersToDept() {
    if (!selDept || bulkAssign.length === 0) return;
    try {
      await fetchJSON<unknown>("/api/responsables/assign-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: selDept.id, userIds: bulkAssign }),
      });
      await refreshAfterAssignOrRemove(selDept.id);
      setBulkAssign([]);
    } catch (e: unknown) {
      alert(errorMessage(e, "Échec de l’affectation"));
    }
  }

  async function removeUserFromDept(userId: number) {
    try {
      await fetchJSON<unknown>("/api/responsables/remove-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (selDept) {
        await refreshAfterAssignOrRemove(selDept.id);
      }
    } catch (e: unknown) {
      alert(errorMessage(e, "Échec de la suppression"));
    }
  }

  return (
    <>
      <Sidebar
        activeHref={pathname}
        title="Guest Office"
        subtitle="Responsables"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <div className="lg:pl-64 min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 pt-14 md:pt-[72px]">
        <header className="fixed top-0 left-0 right-0 z-30 w-full backdrop-blur bg-white/70 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-3 sm:px-4">
            <TopBar onOpenSidebar={() => setDrawerOpen(true)} />
          </div>
        </header>

        {/* ===== Content ===== */}
        <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-5 space-y-4 sm:space-y-6">
          {/* Grille responsive: 1 col → 12 cols */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* ----- Colonne 1: Départements (lg:4) ----- */}
            <section className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white">
              {/* sticky header inside card */}
              <div className="sticky top-[72px] lg:top-[88px] z-10 bg-white rounded-t-2xl border-b border-slate-200 px-3 sm:px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-blue-100 text-blue-700">
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
                      className="w-full h-9 pl-7 pr-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
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
                {err && !loading && <div className="text-red-600 text-sm">Erreur : {err}</div>}

                <ul className="space-y-2">
                  {filteredDepts.map((d) => {
                    const active = selDept?.id === d.id;
                    return (
                      <li key={d.id}>
                        <button
                          onClick={() => setSelDept(d)}
                          className={cls(
                            "w-full text-left rounded-xl p-3 ring-1 transition",
                            active
                              ? "bg-blue-50/80 ring-blue-200"
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
                                  <span className="text-emerald-700">Resp. {d.managerName}</span>
                                ) : (
                                  <span className="text-amber-700">Responsable non défini</span>
                                )}
                              </div>
                            </div>
                            <div className="text-[12px] text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 px-2 py-0.5 rounded-lg shrink-0">
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
            <section className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white">
              <div className="sticky top-[72px] lg:top-[88px] z-10 bg-white rounded-t-2xl border-b border-slate-200 px-3 sm:px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-teal-100 text-teal-700">
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
                    <div className="rounded-xl ring-1 ring-slate-200 p-3">
                      <div className="text-[12px] text-slate-500 mb-1">Responsable actuel</div>

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
                            className="w-full min-w-0 max-w-full h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 bg-white outline-none"
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
                          className={cls(
                            "inline-flex items-center gap-1 px-3 h-9 rounded-lg text-white shrink-0",
                            !selectedManagerId || changingManager
                              ? "bg-slate-400 cursor-not-allowed"
                              : "bg-blue-600 hover:bg-blue-700"
                          )}
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
                    <div className="rounded-xl ring-1 ring-slate-200">
                      <div className="px-3 py-2 border-b border-slate-200 text-[12px] text-slate-500">
                        Membres du département
                      </div>
                      <div className="divide-y divide-slate-200">
                        {members.map((m) => (
                          <div
                            key={m.id}
                            className="px-3 py-2 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-slate-900 truncate">{m.name}</div>
                              <div className="text-[12px] text-slate-500 truncate">{m.email}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {m.isManager ? (
                                <span className="text-[11px] bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-2 py-0.5 rounded-lg">
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
                                  className="inline-flex items-center gap-1 h-8 px-2 rounded-lg ring-1 ring-slate-200 hover:bg-rose-50 hover:ring-rose-200 text-sm text-rose-700"
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
            <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white">
              <div className="sticky top-[72px] lg:top-[88px] z-10 bg-white rounded-t-2xl border-b border-slate-200 px-3 sm:px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-violet-100 text-violet-700">
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
                      className="w-full h-9 pl-7 pr-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
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
                            className="accent-blue-600"
                            checked={checked}
                            onChange={(e) => {
                              // ✅ on lit 'checked' AVANT d'appeler setState
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
                  <div className="text-[12px] text-slate-500">
                    {bulkAssign.length} sélectionné{bulkAssign.length > 1 ? "s" : ""}
                  </div>
                  <button
                    disabled={!selDept || bulkAssign.length === 0}
                    onClick={assignUsersToDept}
                    className={cls(
                      "inline-flex items-center gap-2 h-9 px-3 rounded-lg text-white",
                      !selDept || bulkAssign.length === 0
                        ? "bg-slate-400 cursor-not-allowed"
                        : "bg-violet-600 hover:bg-violet-700"
                    )}
                    title={selDept ? `Affecter à ${selDept.name}` : "Choisir un département"}
                  >
                    <UserPlus className="w-4 h-4" />
                    Affecter
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Seuls les utilisateurs non-responsables sans
                  département s’affichent ici.
                </div>
              </div>
            </section>
          </div>
        </main>
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
              className="px-3 h-9 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Annuler
            </button>
            <button
              onClick={async () => {
                if (confirmRemoveUser) await removeUserFromDept(confirmRemoveUser.userId);
                setConfirmRemoveUser(null);
              }}
              className="px-3 h-9 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
            >
              Confirmer
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
