// app/admin/users/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import { usePathname } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import TopBar from "../../components/TopBar";
import Modal from "../../components/ui/Modal";
import {
  Mail,
  Shield,
  UserCog,
  AlertCircle,
  ChevronDown,
  Power,
  Shuffle,
} from "lucide-react";

/* ---------------- Types ---------------- */
type AccountStatus = "active" | "suspended";
type Role = "user" | "admin" | "superAdmin";

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role | string;
  isManager: boolean;
  status: AccountStatus | "disabled";
  createdAt: string;
  updatedAt: string;
};

type Category = "Guest Markets" | "Guest Cameroon" | "Autre";

/* ---------------- Helpers ---------------- */
const cls = (...a: Array<string | false | null | undefined>) =>
  a.filter(Boolean).join(" ");

function getCategory(email: string): Category {
  const domain = (email.split("@")[1] || "").toLowerCase();
  if (domain.includes("guestmarkets")) return "Guest Markets";
  if (domain.includes("guestcameroon") || domain.includes("guestcameroun"))
    return "Guest Cameroon";
  return "Autre";
}
const roleLabel = (r: Role) =>
  r === "superAdmin" ? "SA" : r === "admin" ? "Admin" : "User";
const statusLabel = (s: AccountStatus) => (s === "active" ? "Actif" : "Susp");

async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      credentials: "include",
      ...init,
      headers,
      signal: controller.signal,
    });

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
        const preview = (text || "").replace(/\s+/g, " ").slice(0, 200);
        data = { error: preview || "Réponse non-JSON (probable redirection HTML)" };
      }
    }

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      if (
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error?: unknown }).error === "string"
      ) {
        msg = (data as { error?: string }).error ?? msg;
      }
      throw new Error(msg);
    }

    return data as T;
  } finally {
    clearTimeout(id);
  }
}

/* ---------------- Mini UI ---------------- */
const Badge = ({
  tone = "blue",
  children,
}: {
  tone?: "blue" | "gray" | "green" | "amber" | "red" | "indigo" | "teal";
  children: React.ReactNode;
}) => {
  const map = {
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    gray: "bg-slate-100 text-slate-700 ring-slate-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    teal: "bg-teal-50 text-teal-700 ring-teal-200",
  } as const;
  return (
    <span className={cls("px-2 py-0.5 rounded-md text-[11px] ring-1", map[tone])}>
      {children}
    </span>
  );
};

function RoleMenu({
  current,
  onSelect,
}: {
  current: Role;
  onSelect: (r: Role) => void;
}) {
  const options: { value: Role; label: string }[] = [
    { value: "user", label: "User" },
    { value: "admin", label: "Admin" },
    { value: "superAdmin", label: "SA" },
  ];
  return (
    <div className="w-40 rounded-lg border border-slate-200 bg-white shadow-lg p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={cls(
            "w-full text-left px-2.5 py-2 rounded-md text-sm hover:bg-slate-50",
            current === opt.value && "bg-slate-100"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Click-away ---------------- */
function useClickAway<T extends HTMLElement>(onAway: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onAway();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onAway]);
  return ref;
}

/* ---------------- Modale Message Rapide ---------------- */
function QuickMessageModal({
  open,
  onClose,
  recipient,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  recipient: UserRow | null;
  onSend: (payload: {
    recipientId: number;
    subject?: string;
    body: string;
  }) => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setSubject("");
    setBody("");
    setErr(null);
    setSending(false);
  }, [open, recipient]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Message à ${recipient?.name ?? ""}`}
      size="md"
    >
      <div className="space-y-2">
        {err && (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-1.5 text-sm">
            <AlertCircle className="w-4 h-4" /> {err}
          </div>
        )}

        <div>
          <label className="block text-[11px] text-slate-600 mb-1">
            Objet (optionnel)
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full h-9 px-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            placeholder="Ex. Info rapide"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-600 mb-1">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full min-h-[120px] px-3 py-2 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none resize-y text-sm"
            placeholder="Votre message…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1.5">
          <button
            onClick={onClose}
            className="px-3 h-8 rounded-md ring-1 ring-slate-200 hover:bg-slate-50 text-sm"
          >
            Annuler
          </button>
          <button
            onClick={async () => {
              if (!recipient) return;
              if (!body.trim()) {
                setErr("Le message est vide.");
                return;
              }
              setErr(null);
              setSending(true);
              try {
                await onSend({
                  recipientId: recipient.id,
                  subject: subject.trim() || undefined,
                  body: body.trim(),
                });
                onClose();
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : "Échec de l’envoi.");
              } finally {
                setSending(false);
              }
            }}
            className={cls(
              "px-3 h-8 rounded-md text-white text-sm",
              sending
                ? "bg-slate-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
            )}
          >
            {sending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------ Périmètres (constante module) ------------ */
const ALL_SCOPES = [
  "tasks",
  "meetings",
  "objectives",
  "schedules",
  "departments",
  "projects",
  "teams",
  "project_members",
  "team_members",
  "project_notes",
  "project_files",
] as const;

/* ---------------- Modale Réaffectation Globale ---------------- */
function GlobalReassignModal({
  open,
  onClose,
  users,
  onReassign,
}: {
  open: boolean;
  onClose: () => void;
  users: UserRow[];
  onReassign: (payload: {
    fromUserId: number;
    toUserId: number;
    scopes: string[];
    dryRun?: boolean;
  }) => Promise<{ counts?: Record<string, number> } | void>;
}) {
  const [fromId, setFromId] = useState<number | "">("");
  const [toId, setToId] = useState<number | "">("");
  const [dryRun, setDryRun] = useState(true);
  const [selectAll, setSelectAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, number> | null>(null);

  const [scopes, setScopes] = useState<string[]>([...ALL_SCOPES]);

  useEffect(() => {
    if (!open) {
      setFromId("");
      setToId("");
      setDryRun(true);
      setSelectAll(true);
      setScopes([...ALL_SCOPES]);
      setBusy(false);
      setErr(null);
      setDone(null);
    }
  }, [open]);

  function toggleScope(s: string) {
    if (scopes.includes(s)) setScopes(scopes.filter((x) => x !== s));
    else setScopes([...scopes, s]);
  }

  return (
    <Modal open={open} onClose={onClose} title="Réaffectation globale" size="lg">
      <div className="space-y-3">
        {err && (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-1.5 text-sm">
            <AlertCircle className="w-4 h-4" /> {err}
          </div>
        )}

        <div className="rounded-lg ring-1 ring-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <b>Attention :</b> transfère en masse les affectations sélectionnées d’un
          utilisateur vers un autre. Utilise <i>Dry-run</i> pour simuler.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-slate-600 mb-1">Depuis (source)</label>
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value ? Number(e.target.value) : "")}
              className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-blue-600 bg-white outline-none"
            >
              <option value="">— Choisir —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-600 mb-1">Vers (destination)</label>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value ? Number(e.target.value) : "")}
              className="h-9 w-full px-2 rounded-lg ring-1 ring-slate-300 focus:ring-2 focus:ring-blue-600 bg-white outline-none"
            >
              <option value="">— Choisir —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id} disabled={fromId === u.id}>
                  {u.name} — {u.email}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-lg ring-1 ring-slate-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] text-slate-600">Périmètres</div>
            <label className="text-[13px] flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={(e) => {
                  setSelectAll(e.target.checked);
                  setScopes(e.target.checked ? [...ALL_SCOPES] : []);
                }}
              />
              Tout
            </label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="text-[13px] flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={() => toggleScope(s)}
                />
                {s}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-[13px] flex items-center gap-2">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            Dry-run (simulation)
          </label>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 h-9 rounded-md ring-1 ring-slate-200 hover:bg-slate-50 text-sm"
            >
              Annuler
            </button>
            <button
              onClick={async () => {
                if (!fromId || !toId || fromId === toId) {
                  setErr("Choisis deux utilisateurs différents.");
                  return;
                }
                if (scopes.length === 0) {
                  setErr("Sélectionne au moins un périmètre.");
                  return;
                }
                setErr(null);
                setBusy(true);
                try {
                  const res = await onReassign({
                    fromUserId: Number(fromId),
                    toUserId: Number(toId),
                    scopes,
                    dryRun,
                  });
                  const counts = res?.counts ?? null;
                  setDone(counts);
                  if (!dryRun) setTimeout(() => onClose(), 800);
                } catch (e: unknown) {
                  setErr(e instanceof Error ? e.message : "Échec réaffectation");
                } finally {
                  setBusy(false);
                }
              }}
              className={cls(
                "px-3 h-9 rounded-md text-white text-sm inline-flex items-center gap-2",
                busy ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
              )}
              disabled={busy}
            >
              <Shuffle className="w-4 h-4" />
              {dryRun ? "Simuler" : "Réaffecter"}
            </button>
          </div>
        </div>

        {done && (
          <div className="rounded-lg ring-1 ring-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm font-medium text-emerald-800 mb-1">
              Résultat {dryRun ? "de la simulation" : "de la réaffectation"}
            </div>
            <ul className="text-[13px] text-emerald-900 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              {Object.entries(done).map(([k, v]) => (
                <li key={k}>• {k} : {v}</li>
              ))}
              {Object.keys(done).length === 0 && <li>Aucun changement détecté.</li>}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ----------------- Lignes & Cartes ----------------- */
type UserWithCat = UserRow & { category: Category };

type RowCommonProps = {
  u: UserWithCat;
  onUpdate: (
    id: number,
    patch: Partial<Pick<UserRow, "role" | "isManager" | "status">>
  ) => Promise<void>;
  openRoleForId: number | null;
  setOpenRoleForId: (id: number | null) => void;
  onMessage: (u: UserRow) => void;
};

const DesktopRow = memo(function DesktopRow({
  u,
  onUpdate,
  openRoleForId,
  setOpenRoleForId,
  onMessage,
}: RowCommonProps) {
  const isRoleMenuOpen = openRoleForId === u.id;
  const closeMenu = () =>
    setOpenRoleForId(isRoleMenuOpen ? null : openRoleForId);
  const menuRef = useClickAway<HTMLDivElement>(closeMenu);
  const isActive = u.status === "active";

  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2">
        <div className="font-medium text-slate-900">{u.name}</div>
        <div className="text-[11px] text-slate-500">ID #{u.id}</div>
      </td>
      <td className="px-3 py-2">
        <div className="text-slate-800">{u.email}</div>
        <div className="mt-1">
          <Badge
            tone={
              u.category === "Guest Markets"
                ? "blue"
                : u.category === "Guest Cameroon"
                ? "amber"
                : "gray"
            }
          >
            {u.category}
          </Badge>
        </div>
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center text-sm font-medium text-slate-800">
          {roleLabel((u.role as Role) || "user")}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="text-sm text-slate-800">{u.isManager ? "Oui" : "Non"}</span>
      </td>
      <td className="px-3 py-2">
        <span
          className={cls(
            "text-sm font-medium",
            isActive ? "text-emerald-700" : "text-amber-700"
          )}
        >
          {statusLabel(isActive ? "active" : "suspended")}
        </span>
      </td>

      <td className="px-3 py-2 text-right relative">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onMessage(u)}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md ring-1 ring-slate-200 hover:bg-slate-50"
            title="Message rapide"
          >
            <Mail className="w-4 h-4" /> Message
          </button>

          <button
            onClick={() => onUpdate(u.id, { isManager: !u.isManager })}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            title={u.isManager ? "Destituer" : "Nommer responsable"}
          >
            <UserCog className="w-4 h-4" /> {u.isManager ? "Destituer" : "Nommer"}
          </button>

          <button
            onClick={() =>
              onUpdate(u.id, { status: isActive ? "suspended" : "active" })
            }
            className={cls(
              "inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-white hover:opacity-95",
              isActive ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"
            )}
            title={isActive ? "Désactiver l’utilisateur" : "Activer l’utilisateur"}
          >
            <Power className="w-4 h-4" />
            {isActive ? "Désactiver" : "Activer"}
          </button>

          <div className="relative">
            <button
              onClick={() => setOpenRoleForId(isRoleMenuOpen ? null : u.id)}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              title="Changer le rôle"
            >
              <Shield className="w-4 h-4" />
              <span>Rôle</span>
              <ChevronDown className="w-4 h-4 opacity-90" />
            </button>
            {isRoleMenuOpen && (
              <div ref={menuRef} className="absolute right-0 mt-2 z-20">
                <RoleMenu
                  current={(u.role as Role) || "user"}
                  onSelect={async (newRole) => {
                    setOpenRoleForId(null);
                    if (newRole !== u.role) await onUpdate(u.id, { role: newRole });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
});

const MobileCard = memo(function MobileCard({
  u,
  onUpdate,
  openRoleForId,
  setOpenRoleForId,
  onMessage,
}: RowCommonProps) {
  const isRoleMenuOpen = openRoleForId === u.id;
  const closeMenu = () =>
    setOpenRoleForId(isRoleMenuOpen ? null : openRoleForId);
  const menuRef = useClickAway<HTMLDivElement>(closeMenu);
  const isActive = u.status === "active";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-slate-900">{u.name}</div>
          <div className="text-[11px] text-slate-500">{u.email}</div>
          <div className="mt-1">
            <Badge
              tone={
                u.category === "Guest Markets"
                  ? "blue"
                  : u.category === "Guest Cameroon"
                  ? "amber"
                  : "gray"
              }
            >
              {u.category}
            </Badge>
          </div>
        </div>
        <Badge tone={isActive ? "green" : "amber"}>
          {statusLabel(isActive ? "active" : "suspended")}
        </Badge>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="block text-[11px] text-slate-600">Rôle</span>
          <span className="font-medium text-slate-800">
            {roleLabel((u.role as Role) || "user")}
          </span>
        </div>
        <div>
          <span className="block text-[11px] text-slate-600">Responsable</span>
          <span className="font-medium text-slate-800">
            {u.isManager ? "Oui" : "Non"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <span className="text-sm text-slate-700">Statut :</span>
          <span
            className={cls(
              "text-sm font-medium",
              isActive ? "text-emerald-700" : "text-amber-700"
            )}
          >
            {statusLabel(isActive ? "active" : "suspended")}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => onMessage(u)}
          className="inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-md ring-1 ring-slate-200 hover:bg-slate-50 text-[13px]"
        >
          <Mail className="w-4 h-4" /> Msg
        </button>

        <button
          onClick={() =>
            onUpdate(u.id, { status: isActive ? "suspended" : "active" })
          }
          className={cls(
            "inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-md text-white text-[13px]",
            isActive ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"
          )}
        >
          <Power className="w-4 h-4" />
          {isActive ? "Désactiver" : "Activer"}
        </button>

        <div className="relative">
          <button
            onClick={() => setOpenRoleForId(isRoleMenuOpen ? null : u.id)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-[13px]"
          >
            <Shield className="w-4 h-4" /> Rôle
            <ChevronDown className="w-4 h-4 opacity-90" />
          </button>
          {isRoleMenuOpen && (
            <div ref={menuRef} className="absolute right-0 mt-2 z-20">
              <RoleMenu
                current={(u.role as Role) || "user"}
                onSelect={async (newRole) => {
                  setOpenRoleForId(null);
                  if (newRole !== u.role) await onUpdate(u.id, { role: newRole });
                }}
              />
            </div>
          )}
        </div>

        <button
          onClick={() => onUpdate(u.id, { isManager: !u.isManager })}
          className="inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 text-[13px]"
        >
          <UserCog className="w-4 h-4" /> {u.isManager ? "Destituer" : "Nommer"}
        </button>
      </div>
    </div>
  );
});

/* ---------------- Page ---------------- */
export default function UsersAdminPage() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filtres
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [catFilter, setCatFilter] = useState<"all" | "gm" | "gc" | "other">("all");

  // modales
  const [msgUser, setMsgUser] = useState<UserRow | null>(null);
  const [showReassign, setShowReassign] = useState(false);

  // popover rôle
  const [roleMenuFor, setRoleMenuFor] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<{ items: UserRow[] }>("/api/users");
      const safe = (data.items || []).map((u) => ({
        ...u,
        status:
          u.status === "active" || u.status === "suspended" ? u.status : "suspended",
        role: (["user", "admin", "superAdmin"] as Role[]).includes(u.role as Role)
          ? (u.role as Role)
          : ("user" as Role),
      }));
      setItems(safe);
      setErr(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // --- Temps réel (SSE) ---
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/users/stream", { withCredentials: true });
      const onUsers = (e: MessageEvent) => {
        try {
          const data = JSON.parse((e as MessageEvent).data || "{}") as {
            kind?: string;
          };
          if (data.kind === "reload" || data.kind === "userUpdated") {
            loadUsers();
          }
        } catch {
          /* noop */
        }
      };
      es.addEventListener("users", (ev) => onUsers(ev as MessageEvent));
      es.onerror = () => {
        /* silencieux */
      };
    } catch {
      /* noop */
    }
    return () => {
      es?.close();
    };
  }, [loadUsers]);

  const withCat: UserWithCat[] = useMemo(
    () => items.map((u) => ({ ...u, category: getCategory(u.email) as Category })),
    [items]
  );

  const stats = useMemo(() => {
    const total = withCat.length;
    const gm = withCat.filter((u) => u.category === "Guest Markets").length;
    const gc = withCat.filter((u) => u.category === "Guest Cameroon").length;
    const actifs = withCat.filter((u) => u.status === "active").length;
    const managers = withCat.filter((u) => u.isManager).length;
    const suspended = withCat.filter((u) => u.status === "suspended").length;
    return { total, gm, gc, actifs, managers, suspended };
  }, [withCat]);

  const list: UserWithCat[] = useMemo(() => {
    let arr: UserWithCat[] = [...withCat];
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter(
        (u) =>
          u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
      );
    }
    if (roleFilter !== "all") arr = arr.filter((u) => u.role === roleFilter);
    if (statusFilter !== "all")
      arr = arr.filter((u) => (u.status as AccountStatus) === statusFilter);
    if (catFilter !== "all") {
      const m: Category =
        catFilter === "gm"
          ? "Guest Markets"
          : catFilter === "gc"
          ? "Guest Cameroon"
          : "Autre";
      arr = arr.filter((u) => u.category === m);
    }
    return arr;
  }, [withCat, q, roleFilter, statusFilter, catFilter]);

  /* ---------- actions ---------- */
  const updateUser = useCallback(
    async (
      id: number,
      patch: Partial<Pick<UserRow, "role" | "isManager" | "status">>
    ) => {
      const data = await fetchJSON<{ item: UserRow }>(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setItems((arr) =>
        arr.map((u) =>
          u.id === id
            ? {
                ...u,
                ...data.item,
                status:
                  data.item.status === "active" || data.item.status === "suspended"
                    ? data.item.status
                    : "suspended",
                role: (["user", "admin", "superAdmin"] as Role[]).includes(
                  data.item.role as Role
                )
                  ? (data.item.role as Role)
                  : ("user" as Role),
              }
            : u
        )
      );
    },
    []
  );

  const sendQuickMessage = useCallback(
    async (payload: { recipientId: number; subject?: string; body: string }) => {
      await fetchJSON<unknown>(`/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    []
  );

  const reassignAll = useCallback(
    async (payload: {
      fromUserId: number;
      toUserId: number;
      scopes: string[];
      dryRun?: boolean;
    }) => {
      const res = await fetchJSON<{ counts: Record<string, number> }>(
        "/api/admin/reassign",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      return res;
    },
    []
  );

  return (
    <>
      <Sidebar
        activeHref={pathname}
        title="Guest Office"
        subtitle="Utilisateurs"
        open={open}
        onClose={() => setOpen(false)}
      />

      {/* Fond doux */}
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-30">
        <div className="absolute -top-24 -left-16 w-64 h-64 bg-blue-200 rounded-full blur-3xl" />
        <div className="absolute top-48 -right-10 w-72 h-72 bg-indigo-200 rounded-full blur-3xl" />
      </div>

      <div className="lg:pl-64 min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 pt-14 md:pt-[72px]">
        {/* Topbar */}
        <header className="fixed top-0 left-0 right-0 z-30 w-full backdrop-blur bg-white/70 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-3 sm:px-4">
            <TopBar onOpenSidebar={() => setOpen(true)} />
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-3 sm:px-4 py-5 space-y-5">
          {/* En-tête + stats */}
          <section className="flex flex-col md:flex-row md:items-end justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">
                Utilisateurs
              </h1>
              <p className="text-[13px] sm:text-sm text-slate-600">
                Gérez les rôles, responsables, statuts, messages… et réaffectez les éléments d’un utilisateur à un autre.
              </p>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-600">Total</div>
                <div className="text-lg font-bold text-slate-900">{stats.total}</div>
              </div>
              <div className="rounded-xl ring-1 ring-blue-200 bg-blue-50 px-3 py-2">
                <div className="text-[11px] text-blue-700">G. Markets</div>
                <div className="text-lg font-bold text-blue-800">{stats.gm}</div>
              </div>
              <div className="rounded-xl ring-1 ring-indigo-200 bg-indigo-50 px-3 py-2">
                <div className="text-[11px] text-indigo-700">G. Cameroon</div>
                <div className="text-lg font-bold text-indigo-800">{stats.gc}</div>
              </div>
              <div className="rounded-xl ring-1 ring-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] text-emerald-700">Actifs</div>
                <div className="text-lg font-bold text-emerald-800">{stats.actifs}</div>
              </div>
              <div className="rounded-xl ring-1 ring-teal-200 bg-teal-50 px-3 py-2">
                <div className="text-[11px] text-teal-700">Responsables</div>
                <div className="text-lg font-bold text-teal-800">{stats.managers}</div>
              </div>
              <div className="rounded-xl ring-1 ring-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-[11px] text-amber-700">Suspendus</div>
                <div className="text-lg font-bold text-amber-800">
                  {stats.suspended}
                </div>
              </div>
            </div>
          </section>

          {/* Filtres + bouton Réaffecter */}
          <section className="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher (nom, email)…"
                className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as "all" | Role)}
                className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">Tous rôles</option>
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="superAdmin">SA</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "all" | AccountStatus)
                }
                className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">Tous statuts</option>
                <option value="active">Actif</option>
                <option value="suspended">Susp</option>
              </select>
              <select
                value={catFilter}
                onChange={(e) =>
                  setCatFilter(e.target.value as "all" | "gm" | "gc" | "other")
                }
                className="h-9 px-2 rounded-lg text-sm ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">Toutes catégories</option>
                <option value="gm">Guest Markets</option>
                <option value="gc">Guest Cameroon</option>
                <option value="other">Autre</option>
              </select>

              {/* ICI on remplace l’ancienne “Couleur principale” */}
              <div className="flex items-center justify-end">
                <button
                  onClick={() => setShowReassign(true)}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm"
                  title="Réaffecter toutes les affectations d’un utilisateur vers un autre"
                >
                  <Shuffle className="w-4 h-4" />
                  Réaffecter…
                </button>
              </div>
            </div>
          </section>

          {/* Tableau responsive */}
          <section className="space-y-2">
            {loading && <div className="text-slate-500 text-sm">Chargement…</div>}
            {err && !loading && (
              <div className="text-red-600 text-sm">Erreur : {err}</div>
            )}

            <div className="hidden md:block rounded-xl border border-slate-200 overflow-x-auto bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Utilisateur</th>
                    <th className="text-left font-medium px-3 py-2">
                      Email / Catégorie
                    </th>
                    <th className="text-left font-medium px-3 py-2">Rôle</th>
                    <th className="text-left font-medium px-3 py-2">Responsable</th>
                    <th className="text-left font-medium px-3 py-2">Statut</th>
                    <th className="text-right font-medium px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((u) => (
                    <DesktopRow
                      key={u.id}
                      u={u}
                      onUpdate={updateUser}
                      openRoleForId={roleMenuFor}
                      setOpenRoleForId={setRoleMenuFor}
                      onMessage={setMsgUser}
                    />
                  ))}
                  {list.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        Aucun utilisateur.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="md:hidden grid grid-cols-1 gap-2">
              {list.map((u) => (
                <MobileCard
                  key={u.id}
                  u={u}
                  onUpdate={updateUser}
                  openRoleForId={roleMenuFor}
                  setOpenRoleForId={setRoleMenuFor}
                  onMessage={setMsgUser}
                />
              ))}
              {list.length === 0 && (
                <div className="text-slate-500 text-sm text-center">
                  Aucun utilisateur.
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Modales */}
      <QuickMessageModal
        open={!!msgUser}
        onClose={() => setMsgUser(null)}
        recipient={msgUser}
        onSend={sendQuickMessage}
      />

      <GlobalReassignModal
        open={showReassign}
        onClose={() => setShowReassign(false)}
        users={items}
        onReassign={reassignAll}
      />
    </>
  );
}
