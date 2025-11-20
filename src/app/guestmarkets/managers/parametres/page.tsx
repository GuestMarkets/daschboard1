"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// Contexte (adapte le chemin si besoin)
import { Providers } from "../../../../../lib/store";

// Composants
import Sidebar from "../../components/Sidebar";
import TopBar from "../../components/TopBar";
import { Card, SectionTitle } from "../../components/Primitives";

// Icônes
import { ShieldAlert } from "lucide-react";

// ---------------- utils ----------------
function classNames(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}
function isStrongPassword(pw: string) {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pw);
}

// ---------------- Types ----------------
type Role = "user" | "superAdmin";
type Status = "PENDING" | "SUSPENDED" | "VALIDATED";
type Me = { id: number; name: string; email: string; role: Role; status: Status };

type GetAccountResponse = { me: Me };
type PatchAccountBody = Partial<{
  name: string;
  newPassword: string;
  currentPassword: string;
}>;
type PatchAccountResponse = {
  success: boolean;
  suspended?: boolean;
  message?: string;
};

// ---------------- Page ----------------
export default function AccountSettingsPage() {
  const pathname = usePathname();
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState(""); // read-only
  const [role, setRole] = useState<Role>("user"); // read-only
  const [status, setStatus] = useState<Status>("VALIDATED");

  // password change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  // UX
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const isAdmin = role === "superAdmin";
  const passwordValid =
    (!newPw && !newPw2) || (newPw === newPw2 && isStrongPassword(newPw) && (!!currentPw || isAdmin));

  // Charger profil
  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadErr(null);
      try {
        const res = await fetch("/api/account", { credentials: "include" });
        const data = (await res.json()) as GetAccountResponse;
        if (!res.ok) throw new Error((data as any)?.error || "Impossible de charger le profil."); // eslint-disable-line @typescript-eslint/no-explicit-any
        const m = data.me;
        setMe(m);
        setName(m.name);
        setEmail(m.email);
        setRole(m.role);
        setStatus(m.status);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Erreur inconnue";
        setLoadErr(message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const canSave =
    !loading &&
    !!me &&
    (name.trim() !== me.name || (!!newPw && passwordValid)) &&
    (isAdmin || ack) &&
    !saving;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setSaveErr(null);
    setSaveOk(null);
    setSaving(true);

    try {
      const body: PatchAccountBody = {};
      if (name.trim() !== me.name) body.name = name.trim();
      if (newPw) {
        body.newPassword = newPw;
        if (!isAdmin) body.currentPassword = currentPw; // côté serveur on exigera aussi le currentPw pour non-admin
      }

      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as PatchAccountResponse & { error?: string };
      if (!res.ok) throw new Error(data?.message || data?.error || "Échec de la mise à jour.");

      setSaveOk(data?.message || "Modifications enregistrées.");

      if (data?.suspended) {
        // Si suspension : on déconnecte et on redirige vers /auth
        try {
          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        } catch {
          // noop
        }
        try {
          localStorage.removeItem("auth_token");
        } catch {
          // noop
        }
        setTimeout(() => {
          router.replace("/auth");
          router.refresh();
        }, 1200);
      } else {
        // pas de suspension -> on rafraîchit juste la page
        setTimeout(() => {
          router.refresh();
        }, 800);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Erreur lors de l’enregistrement.";
      setSaveErr(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Providers>
      <Sidebar activeHref={pathname} title="Guest Office" subtitle="Tableau de bord" />

      <div className="lg:pl-64 min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 pt-14 md:pt-[72px]">
        {/* TopBar sticky */}
        <header className="fixed top-0 left-0 right-0 z-30 w-full backdrop-blur bg-white/70 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4">
            <TopBar onOpenSidebar={() => { /* open drawer mobile si besoin */ }} />
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6 text-[13px]">
          <SectionTitle>
            <span className="text-base">Paramètres du compte</span>
          </SectionTitle>

          {/* Bandeau Non-Admin */}
          {!loading && me && !isAdmin && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 flex gap-3">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <div className="space-y-1">
                <div className="font-semibold">Attention</div>
                <p>
                  Toute modification d’une information de votre compte <b>entraîne la suspension</b> de votre compte
                  jusqu’à vérification par l’administrateur.
                </p>
              </div>
            </div>
          )}

          {/* Erreur/Chargement */}
          {loading && <Card className="p-5">Chargement…</Card>}
          {loadErr && !loading && <Card className="p-5 text-red-600">Erreur : {loadErr}</Card>}

          {/* Formulaire */}
          {!loading && me && (
            <form onSubmit={handleSave} className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Profil */}
              <Card className="p-6 xl:col-span-2 space-y-4">
                <h3 className="text-[15px] font-semibold text-slate-900">Informations de profil</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] text-slate-600 mb-1">Nom complet</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Votre nom"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] text-slate-600 mb-1">Email</label>
                    <input
                      value={email}
                      readOnly
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] text-slate-600 mb-1">Rôle</label>
                    <input
                      value={role === "superAdmin" ? "Super Admin" : "Utilisateur"}
                      readOnly
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] text-slate-600 mb-1">Statut</label>
                    <input
                      value={
                        status === "VALIDATED"
                          ? "Validé"
                          : status === "SUSPENDED"
                          ? "Suspendu"
                          : "En attente"
                      }
                      readOnly
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-600"
                    />
                  </div>
                </div>
              </Card>

              {/* Sécurité */}
              <Card className="p-6 space-y-4">
                <h3 className="text-[15px] font-semibold text-slate-900">Sécurité</h3>

                {!isAdmin && (
                  <div>
                    <label className="block text-[12px] text-slate-600 mb-1">Mot de passe actuel</label>
                    <input
                      type="password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      placeholder="••••••••"
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Requis si vous modifiez le mot de passe (utilisateur non-admin).
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-[12px] text-slate-600 mb-1">Nouveau mot de passe</label>
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="8+ caractères, lettres & chiffres"
                    className={classNames(
                      "w-full h-10 px-3 rounded-lg border bg-white focus:outline-none focus:ring-2",
                      isStrongPassword(newPw) || !newPw
                        ? "border-slate-200 focus:ring-blue-500"
                        : "border-red-300 focus:ring-red-200"
                    )}
                    minLength={8}
                  />
                </div>

                <div>
                  <label className="block text-[12px] text-slate-600 mb-1">Confirmer le nouveau mot de passe</label>
                  <input
                    type="password"
                    value={newPw2}
                    onChange={(e) => setNewPw2(e.target.value)}
                    placeholder="••••••••"
                    className={classNames(
                      "w-full h-10 px-3 rounded-lg border bg-white focus:outline-none focus:ring-2",
                      newPw2 === newPw || !newPw2
                        ? "border-slate-200 focus:ring-blue-500"
                        : "border-red-300 focus:ring-red-200"
                    )}
                    minLength={8}
                  />
                </div>

                {!isAdmin && (
                  <label className="flex items-start gap-2 text-[13px] text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    <span>
                      Je comprends qu’en enregistrant ces modifications, <b>mon compte sera suspendu</b> jusqu’à
                      vérification par un administrateur.
                    </span>
                  </label>
                )}

                {/* Feedback */}
                {saveErr && <div className="text-[13px] text-red-600">{saveErr}</div>}
                {saveOk && <div className="text-[13px] text-emerald-700">{saveOk}</div>}

                <button
                  disabled={!canSave}
                  className={classNames(
                    "w-full inline-flex items-center justify-center h-10 rounded-lg text-white font-semibold",
                    canSave ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"
                  )}
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </Card>
            </form>
          )}
        </main>
      </div>
    </Providers>
  );
}
