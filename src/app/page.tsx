'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import TermsContent from './components/policies/Terms';
import PrivacyContent from './components/policies/Privacy';
import Modal from './components/ui/Modal';
import { useRouter } from 'next/navigation';
import {
  Mail, Lock, User, Eye, EyeOff, CheckCircle2, AlertCircle, Globe, ArrowRight, ArrowLeft,
} from 'lucide-react';

/* =========================
   Types & Palette
   ========================= */
type Accent =
  | 'blue'
  | 'emerald'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'indigo'
  | 'cyan'
  | 'gray';

type Mode = 'login' | 'signup' | 'forgot';

// ↓ Types pour le fallback client (on ne modifie pas l'API)
type Role = 'user' | 'manager' | 'admin' | 'superAdmin';
type Company = 'guestmarkets' | 'guestcameroon';

const ACCENT_MAP: Record<
  Accent,
  {
    solid: string;
    hover: string;
    ring: string;
    text: string;
    badge: string;
    gradient: string;
    softBg: string;
  }
> = {
  blue: { solid: 'bg-blue-600', hover: 'hover:bg-blue-700', ring: 'focus:ring-blue-500', text: 'text-blue-600', badge: 'bg-blue-50 text-blue-700', gradient: 'from-blue-600 to-indigo-600', softBg: 'bg-blue-50' },
  emerald: { solid: 'bg-emerald-600', hover: 'hover:bg-emerald-700', ring: 'focus:ring-emerald-500', text: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700', gradient: 'from-emerald-600 to-teal-600', softBg: 'bg-emerald-50' },
  purple: { solid: 'bg-purple-600', hover: 'hover:bg-purple-700', ring: 'focus:ring-purple-500', text: 'text-purple-600', badge: 'bg-purple-50 text-purple-700', gradient: 'from-purple-600 to-fuchsia-600', softBg: 'bg-purple-50' },
  orange: { solid: 'bg-orange-600', hover: 'hover:bg-orange-700', ring: 'focus:ring-orange-500', text: 'text-orange-600', badge: 'bg-orange-50 text-orange-700', gradient: 'from-orange-600 to-amber-600', softBg: 'bg-orange-50' },
  pink: { solid: 'bg-pink-600', hover: 'hover:bg-pink-700', ring: 'focus:ring-pink-500', text: 'text-pink-600', badge: 'bg-pink-50 text-pink-700', gradient: 'from-pink-600 to-rose-600', softBg: 'bg-pink-50' },
  indigo: { solid: 'bg-indigo-600', hover: 'hover:bg-indigo-700', ring: 'focus:ring-indigo-500', text: 'text-indigo-600', badge: 'bg-indigo-50 text-indigo-700', gradient: 'from-indigo-600 to-violet-600', softBg: 'bg-indigo-50' },
  cyan: { solid: 'bg-cyan-600', hover: 'hover:bg-cyan-700', ring: 'focus:ring-cyan-500', text: 'text-cyan-600', badge: 'bg-cyan-50 text-cyan-700', gradient: 'from-cyan-600 to-sky-600', softBg: 'bg-cyan-50' },
  gray: { solid: 'bg-gray-700', hover: 'hover:bg-gray-800', ring: 'focus:ring-gray-500', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-700', gradient: 'from-gray-700 to-slate-700', softBg: 'bg-gray-50' },
};

/* =========================
   Helpers UI
   ========================= */
function classNames(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(' ');
}
function emailOk(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function pwStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4); // 0..4
}
const strengthLabel = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Fort'];
const strengthBar = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-400', 'bg-green-500'];

const Field: React.FC<{
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}> = ({ label, hint, error, children }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <label className="text-[13px] font-medium text-slate-700">{label}</label>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
    {children}
    {error && (
      <div className="mt-1 text-xs text-red-600 flex items-center gap-1">
        <AlertCircle className="w-4 h-4" /> {error}
      </div>
    )}
  </div>
);

const InputIcon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
    {children}
  </div>
);

const Banner: React.FC<{
  tone: 'error' | 'success' | 'info';
  children: React.ReactNode;
}> = ({ tone, children }) => {
  const map = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  } as const;
  return (
    <div className={classNames('rounded-lg border px-3 py-2 text-[13px]', map[tone])} role="status" aria-live="polite">
      {children}
    </div>
  );
};

/* =========================
   Helpers Typesafe (no any)
   ========================= */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/* =========================
   Page
   ========================= */
const AuthPage: React.FC<{
  brandName?: string;
  logoUrl?: string;
  accent?: Accent;
}> = ({ brandName = 'Guest Office', logoUrl = '/logos.png', accent = 'blue' }) => {
  const C = useMemo(() => ACCENT_MAP[accent], [accent]);
  const [mode, setMode] = useState<Mode>('login');

  // Login
  const [lEmail, setLEmail] = useState('');
  const [lPw, setLPw] = useState('');
  const [lShow, setLShow] = useState(false);
  const [lLoading, setLLoading] = useState(false);
  const [lError, setLError] = useState<string | null>(null);
  const [lOk, setLOk] = useState<string | null>(null);
  const lValid = emailOk(lEmail) && lPw.length >= 1;

  // Signup
  const [sName, setSName] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sPw, setSPw] = useState('');
  const [sPw2, setSPw2] = useState('');
  const [sShow, setSShow] = useState(false);
  const sStrength = pwStrength(sPw);
  const sValid = sName.trim().length >= 2 && emailOk(sEmail) && sPw.length >= 8 && sPw2 === sPw;
  const [sLoading, setSLoading] = useState(false);
  const [sError, setSError] = useState<string | null>(null);
  const [sOk, setSOk] = useState<string | null>(null);

  // Forgot password
  const [fEmail, setFEmail] = useState('');
  const [fPw, setFPw] = useState('');
  const [fPw2, setFPw2] = useState('');
  const [fShow, setFShow] = useState(false);
  const fStrength = pwStrength(fPw);
  const [fAck, setFAck] = useState(false);
  const fValid = emailOk(fEmail) && fPw.length >= 8 && fPw2 === fPw && fAck;
  const [fLoading, setFLoading] = useState(false);
  const [fError, setFError] = useState<string | null>(null);
  const [fOk, setFOk] = useState<string | null>(null);

  const router = useRouter();

  // Petit helper pour POST JSON (typé, sans any)
  async function postJSON<T = unknown>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const raw = (await res.json()) as unknown;

    if (!res.ok) {
      let message = 'Erreur serveur';
      if (isRecord(raw) && typeof raw.error === 'string') {
        message = raw.error;
      }
      throw new Error(message);
    }

    return raw as T;
  }

  // ========= Helpers fallback redirection (LOGIN uniquement) =========
  function getCompanyFromEmail(email: string): Company | null {
    const domain = email.split('@')[1]?.toLowerCase() || '';
    if (domain.endsWith('guestmarkets.net')) return 'guestmarkets';
    if (domain.endsWith('guestcameroon.com')) return 'guestcameroon';
    return null;
  }
  function dashboardPath(company: Company, role: Role): string {
    const base = company === 'guestmarkets' ? '/guestmarkets' : '/guestcameroon';
    switch (role) {
      case 'superAdmin': return `${base}/super-admin/overview`;
      case 'admin':      return `${base}/admin/overview`;
      case 'manager':    return `${base}/managers/overview`;
      default:           return `${base}/users/overview`;
    }
  }
  function computeRedirect(email: string, role?: Role): string {
    const comp = getCompanyFromEmail(email);
    if (!comp) return '/';
    return dashboardPath(comp, role ?? 'user');
  }

  /* --------- LOGIN (modifié) --------- */
  async function onLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lValid) return;
    setLError(null);
    setLOk(null);
    setLLoading(true);
    try {
      const data = await postJSON<{
        token?: string;
        user?: { id: number; name: string; email: string; role?: Role; company?: Company };
        redirect?: string;
        ok?: boolean;
        message?: string;
      }>('/api/auth/login', { email: lEmail, password: lPw });

      if (data?.token) {
        try { localStorage.setItem('auth_token', data.token); } catch {}
      }

      const next = data?.redirect ?? computeRedirect(lEmail, data?.user?.role as Role | undefined);
      router.replace(next);
      router.refresh();
      return;
    } catch (err: unknown) {
      setLError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLLoading(false);
    }
  }

  // ---------- SIGNUP (inchangé) ----------
  async function onSignup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sValid) return;
    setSError(null);
    setSOk(null);
    setSLoading(true);
    try {
      const data = await postJSON<{ success: boolean; token?: string }>(
        '/api/auth/signup',
        { name: sName.trim(), email: sEmail.trim(), password: sPw }
      );
      if (data.token) {
        try { localStorage.setItem('auth_token', data.token); } catch { }
      }
      setSOk('Compte créé avec succès 🎉');
      setMode('login');
      setLEmail(sEmail);
    } catch (err: unknown) {
      setSError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSLoading(false);
    }
  }

  // ---------- FORGOT (inchangé) ----------
  async function onForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fValid) return;
    setFError(null);
    setFOk(null);
    setFLoading(true);
    try {
      await postJSON<{ success: boolean }>(
        '/api/auth/forgot',
        { email: fEmail.trim(), password: fPw }
      );
      setFOk('Mot de passe réinitialisé ✅ Vous pouvez vous reconnecter.');
      setMode('login');
      setLEmail(fEmail);
    } catch (err: unknown) {
      setFError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setFLoading(false);
    }
  }

  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  return (
    <div className="min-h-screen md:h-screen bg-gradient-to-br from-gray-50 via-white to-slate-50 md:overflow-hidden">
      {/* Grille pleine hauteur sur PC */}
      <div className="h-full w-full flex items-stretch justify-center md:items-stretch">
        <div className="w-full max-w-6xl md:max-w-none md:w-full md:h-screen grid grid-cols-1 md:grid-cols-2 md:gap-0">
          {/* Colonne marque */}
          <div className={classNames('relative p-6 md:p-8 lg:p-10', ACCENT_MAP[accent].softBg)}>
            <div className={classNames('absolute inset-0 bg-gradient-to-br opacity-20', ACCENT_MAP[accent].gradient)} />
            <div className="relative z-10 flex flex-col h-full">
              <div className="grid center text-center justify-center items-center gap-3">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt="logo"
                    width={1000}
                    height={1000}
                    className="justify-center w-110 h-24"
                  />
                ) : (
                  <div className={classNames('w-9 h-9 rounded-lg flex items-center justify-center shadow text-white', ACCENT_MAP[accent].solid)}>
                    <Globe className="w-4 h-4" />
                  </div>
                )}
                <div>
                  <div className="text-base font-semibold text-slate-900">{brandName}</div>
                  <div className="text-[11px] text-slate-500">Plateforme sécurisée pour les employés</div>
                </div>
              </div>

              <div className="grid mt-8 md:mt-12 center text-center justify-center items-center ">
                <h2 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
                  {mode === 'login' ? 'Ravi de vous revoir' : mode === 'signup' ? 'Créez votre compte' : 'Réinitialiser le mot de passe'}
                </h2>
                <p className="mt-1.5 text-[13px] text-slate-600 leading-relaxed">
                  {mode === 'login'
                    ? 'Connectez-vous pour accéder à votre espace et reprendre là où vous vous êtes arrêté. Ravis de vous avoir parmi notre personnel.'
                    : mode === 'signup'
                      ? 'Rejoignez-nous pour une expérience fluide, sécurisée et personnalisée.'
                      : 'Définissez un nouveau mot de passe pour votre compte.'}
                </p>

                <div className="mt-5 flex center text-center justify-center items-center  gap-2">
                  <span className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                    <strong>Accès interne uniquement.</strong> Cette application est réservée aux employés autorisés de <strong>Guest Markets</strong> et <strong>Guest Cameroun.</strong>
                    Toute utilisation est journalisée et soumise aux politiques internes. Accès non autorisé interdit.
                  </span>
                </div>

                <div className="mt-5 flex center text-center justify-center items-center  gap-2">
                  <span className={classNames('px-2 py-[3px] rounded-lg text-[12px] font-medium', ACCENT_MAP[accent].badge)}>
                    Accès nominatif et contrôlé.
                  </span>
                  <span className={classNames('px-2 py-[3px] rounded-lg text-[12px] font-medium', ACCENT_MAP[accent].badge)}>
                    Usage professionnel uniquement.
                  </span>
                  <span className={classNames('px-2 py-[3px] rounded-lg text-[12px] font-medium', ACCENT_MAP[accent].badge)}>
                    Données confidentielles : toute extraction, diffusion ou partage non autorisé est interdit.
                  </span>
                  <span className={classNames('px-2 py-[3px] rounded-lg text-[12px] font-medium', ACCENT_MAP[accent].badge)}>
                    Activité surveillée et journalisée pour des raisons de sécurité et de conformité.
                  </span>
                </div>
              </div>

              <div className="mt-auto hidden md:flex items-center justify-center gap-2 pt-8">
                <CheckCircle2 className={classNames('w-4 h-4', ACCENT_MAP[accent].text)} />
                <span className="text-[13px] text-slate-700">© 2025 Guest Markets & Guest Cameroun — Accès interne • Données confidentielles</span>
              </div>
            </div>
          </div>

          {/* Colonne formulaire – scrolle seule si besoin */}
          <div className="p-5 sm:p-6 md:p-8 lg:p-10 bg-white md:max-h-screen md:overflow-y-auto">
            {/* Tabs */}
            <div className="flex items-center justify-between">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  className={classNames(
                    'px-3.5 py-2 rounded-lg text-sm font-medium transition',
                    mode === 'login' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  )}
                  onClick={() => setMode('login')}
                >
                  Connexion
                </button>
                <button
                  type="button"
                  className={classNames(
                    'px-3.5 py-2 rounded-lg text-sm font-medium transition',
                    mode === 'signup' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  )}
                  onClick={() => setMode('signup')}
                >
                  Créer un compte
                </button>
                <button
                  type="button"
                  className={classNames(
                    'px-3.5 py-2 rounded-lg text-sm font-medium transition',
                    mode === 'forgot' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  )}
                  onClick={() => setMode('forgot')}
                >
                  Mot de passe oublié
                </button>
              </div>

              {mode !== 'login' && (
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="hidden sm:inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
                >
                  <ArrowLeft className="w-4 h-4" /> Retour connexion
                </button>
              )}
            </div>

            {/* Bandeaux feedback globaux */}
            <div className="mt-4 space-y-2">
              {mode === 'login' && (lError || lOk) && (
                <Banner tone={lError ? 'error' : 'success'}>{lError ?? lOk}</Banner>
              )}
              {mode === 'signup' && (sError || sOk) && (
                <Banner tone={sError ? 'error' : 'success'}>{sError ?? sOk}</Banner>
              )}
              {mode === 'forgot' && (fError || fOk) && (
                <Banner tone={fError ? 'error' : 'success'}>{fError ?? fOk}</Banner>
              )}
            </div>

            {/* --------- LOGIN --------- */}
            {mode === 'login' && (
              <form onSubmit={onLogin} className="space-y-3.5 mt-5">
                <Field label="Email professionnel" error={lEmail && !emailOk(lEmail) ? 'Email invalide' : undefined}>
                  <div className="space-y-1.5">
                    <div className="relative">
                      <InputIcon>
                        <Mail className="w-4 h-4 text-slate-400" />
                      </InputIcon>

                      <input
                        id="email"
                        type="email"
                        inputMode="email"
                        autoCapitalize="none"
                        autoCorrect="off"
                        list="allowed-emails"
                        value={lEmail}
                        onChange={(e) => setLEmail(e.target.value)}
                        className={classNames(
                          'text-gray-600 placeholder:text-gray-600',
                          'peer w-full h-10 pl-10 pr-3 rounded-lg bg-white text-sm',
                          'border border-slate-200',
                          'focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
                        )}
                        placeholder="prenom.nom@guestcameroon.com"
                        autoComplete="email"
                        required
                        pattern={"^[A-Za-z0-9._%+-]+@(guestcameroon\\.com|guestmarkets\\.net)$"}
                        onInvalid={(e) =>
                          e.currentTarget.setCustomValidity(
                            'Utilisez une adresse @guestcameroon.com ou @guestmarkets.net.'
                          )
                        }
                        onInput={(e) => e.currentTarget.setCustomValidity('')}
                        aria-describedby="email-help email-error"
                      />

                      <datalist id="allowed-emails">
                        <option value="prenom.nom@guestcameroon.com" />
                        <option value="prenom.nom@guestmarkets.net" />
                      </datalist>
                    </div>

                    <small id="email-help" className="block text-[11px] text-slate-500">
                      Seules les adresses <b>@guestcameroon.com</b> ou <b>@guestmarkets.net</b> sont acceptées.
                    </small>

                    <small
                      id="email-error"
                      className="hidden text-[11px] text-red-600 peer-invalid:block"
                    >
                      Adresse invalide. Merci d’utiliser un email d’entreprise autorisé.
                    </small>
                  </div>
                </Field>

                <Field label="Mot de passe" hint="8+ caractères">
                  <div className="relative">
                    <InputIcon>
                      <Lock className="w-4 h-4" />
                    </InputIcon>
                    <input
                      type={lShow ? 'text' : 'password'}
                      value={lPw}
                      onChange={(e) => setLPw(e.target.value)}
                      className={classNames(
                        'text-gray-600 placeholder:text-gray-600',
                        'w-full pl-10 pr-10 py-2 rounded-lg bg-white',
                        'border border-slate-200',
                        'focus:ring-2 focus:ring-blue-100 focus:border-blue-400'
                      )}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setLShow((v) => !v)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                      aria-label={lShow ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    >
                      {lShow ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </Field>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-[13px] text-slate-700">
                    <input type="checkbox" className="accent-current" />
                    Se souvenir de moi
                  </label>
                  <button
                    type="button"
                    onClick={() => setMode('forgot')}
                    className={classNames('text-[13px] font-medium hover:underline', ACCENT_MAP[accent].text)}
                  >
                    Mot de passe oublié ?
                  </button>
                </div>

                <button
                  className={classNames(
                    'w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white font-semibold transition shadow-sm',
                    ACCENT_MAP[accent].solid,
                    ACCENT_MAP[accent].hover,
                    lLoading && 'opacity-80 cursor-not-allowed'
                  )}
                  disabled={!lValid || lLoading}
                >
                  {lLoading ? 'Connexion…' : 'Se connecter'} <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {/* --------- SIGNUP --------- */}
            {mode === 'signup' && (
              <form onSubmit={onSignup} className="space-y-3.5 mt-5">
                <Field label="Nom complet" error={sName && sName.trim().length < 2 ? '2 caractères minimum' : undefined}>
                  <div className="relative">
                    <InputIcon>
                      <User className="w-4 h-4" />
                    </InputIcon>
                    <input
                      value={sName}
                      onChange={(e) => setSName(e.target.value)}
                      className={classNames(
                        'text-gray-600 w-full pl-10 pr-3 py-2 rounded-lg ring-1 ring-slate-200 outline-none bg-white',
                        'focus:ring-2',
                        ACCENT_MAP[accent].ring
                      )}
                      placeholder="Ebongue Franck"
                      autoComplete="name"
                      required
                    />
                  </div>
                </Field>

                <Field label="Email" error={sEmail && !emailOk(sEmail) ? 'Email invalide' : undefined}>
                  <div className="relative">
                    <InputIcon>
                      <Mail className="w-4 h-4" />
                    </InputIcon>
                    <input
                      type="email"
                      value={sEmail}
                      onChange={(e) => setSEmail(e.target.value)}
                      className={classNames(
                        'text-gray-600 w-full pl-10 pr-3 py-2 rounded-lg ring-1 ring-slate-200 outline-none bg-white',
                        'focus:ring-2',
                        ACCENT_MAP[accent].ring
                      )}
                      placeholder="prenom.nom@guestcameroon.com ou prenom.nom@guestmarkets.net"
                      autoComplete="email"
                      required
                    />
                  </div>
                </Field>

                <Field label="Mot de passe" hint="8+ caractères">
                  <div className="relative">
                    <InputIcon>
                      <Lock className="w-4 h-4" />
                    </InputIcon>
                    <input
                      type={sShow ? 'text' : 'password'}
                      value={sPw}
                      onChange={(e) => setSPw(e.target.value)}
                      className={classNames(
                        'text-gray-600 w-full pl-10 pr-10 py-2 rounded-lg ring-1 ring-slate-200 outline-none bg-white',
                        'focus:ring-2',
                        ACCENT_MAP[accent].ring
                      )}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setSShow((v) => !v)}
                      className="text-gray-700 absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                      aria-label={sShow ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    >
                      {sShow ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>

                  {/* Strength */}
                  <div className="mt-2 flex items-center gap-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={classNames(
                          'h-1.5 w-full rounded-full bg-slate-200',
                          sPw ? (i <= sStrength - 1 ? strengthBar[sStrength] : 'bg-slate-200') : 'bg-slate-200'
                        )}
                      />
                    ))}
                    <span className="text-[11px] text-slate-500 w-20 text-right">
                      {sPw ? strengthLabel[sStrength] : ''}
                    </span>
                  </div>
                </Field>

                <Field
                  label="Confirmer le mot de passe"
                  error={sPw2 && sPw2 !== sPw ? 'Les mots de passe ne correspondent pas' : undefined}
                >
                  <div className="relative">
                    <InputIcon>
                      <Lock className="w-4 h-4" />
                    </InputIcon>
                    <input
                      type="password"
                      value={sPw2}
                      onChange={(e) => setSPw2(e.target.value)}
                      className={classNames(
                        'text-gray-600 w-full pl-10 pr-3 py-2 rounded-lg ring-1 ring-slate-200 outline-none bg-white',
                        'focus:ring-2',
                        ACCENT_MAP[accent].ring
                      )}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </Field>

                <button
                  className={classNames(
                    'w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white font-semibold transition shadow-sm',
                    ACCENT_MAP[accent].solid,
                    ACCENT_MAP[accent].hover,
                    sLoading && 'opacity-80 cursor-not-allowed'
                  )}
                  disabled={!sValid || sLoading}
                >
                  {sLoading ? 'Création…' : 'Créer mon compte'} <ArrowRight className="w-4 h-4" />
                </button>

                <p className="text-[11px] text-slate-500 text-center">
                  En créant un compte, vous acceptez nos{' '}
                  <button
                    type="button"
                    onClick={() => setShowTerms(true)}
                    className={classNames('underline', ACCENT_MAP[accent].text, 'focus:outline-none cursor-pointer focus:ring-2 focus:ring-offset-2', ACCENT_MAP[accent].ring)}
                  >
                    CGU
                  </button>
                  {' '}et notre{' '}
                  <button
                    type="button"
                    onClick={() => setShowPrivacy(true)}
                    className={classNames('underline', ACCENT_MAP[accent].text, 'focus:outline-none cursor-pointer focus:ring-2 focus:ring-offset-2', ACCENT_MAP[accent].ring)}
                  >
                    Politique de confidentialité
                  </button>.
                </p>
              </form>
            )}

            {/* --------- FORGOT / RESET --------- */}
            {mode === 'forgot' && (
              <form onSubmit={onForgot} className="space-y-3.5 mt-5">
                <Field label="Email du compte" error={fEmail && !emailOk(fEmail) ? 'Email invalide' : undefined}>
                  <div className="relative">
                    <InputIcon>
                      <Mail className="w-4 h-4" />
                    </InputIcon>
                    <input
                      type="email"
                      value={fEmail}
                      onChange={(e) => setFEmail(e.target.value)}
                      className={classNames(
                        'text-gray-600 w-full pl-10 pr-3 py-2 rounded-lg ring-1 ring-slate-200 outline-none bg-white',
                        'placeholder:text-slate-400',
                        'focus:ring-2',
                        ACCENT_MAP[accent].ring
                      )}
                      placeholder="vous@domaine.com"
                      autoComplete="email"
                      required
                    />
                  </div>
                </Field>

                <Field label="Nouveau mot de passe" hint="8+ caractères">
                  <div className="relative">
                    <InputIcon>
                      <Lock className="w-4 h-4" />
                    </InputIcon>
                    <input
                      type={fShow ? 'text' : 'password'}
                      value={fPw}
                      onChange={(e) => setFPw(e.target.value)}
                      className={classNames(
                        'text-gray-600 w-full pl-10 pr-10 py-2 rounded-lg ring-1 ring-slate-200 outline-none bg-white',
                        'focus:ring-2',
                        ACCENT_MAP[accent].ring
                      )}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setFShow((v) => !v)}
                      className="text-gray-600 absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                      aria-label={fShow ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    >
                      {fShow ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>

                  {/* Strength */}
                  <div className="mt-2 flex items-center gap-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={classNames(
                          'h-1.5 w-full rounded-full bg-slate-200',
                          fPw ? (i <= fStrength - 1 ? strengthBar[fStrength] : 'bg-slate-200') : 'bg-slate-200'
                        )}
                      />
                    ))}
                    <span className="text-[11px] text-slate-500 w-20 text-right">
                      {fPw ? strengthLabel[fStrength] : ''}
                    </span>
                  </div>
                </Field>

                <Field
                  label="Confirmer le nouveau mot de passe"
                  error={fPw2 && fPw2 !== fPw ? 'Les mots de passe ne correspondent pas' : undefined}
                >
                  <div className="relative">
                    <InputIcon>
                      <Lock className="w-4 h-4" />
                    </InputIcon>
                    <input
                      type="password"
                      value={fPw2}
                      onChange={(e) => setFPw2(e.target.value)}
                      className={classNames(
                        'text-gray-600 w-full pl-10 pr-3 py-2 rounded-lg ring-1 ring-slate-200 outline-none bg-white',
                        'focus:ring-2',
                        ACCENT_MAP[accent].ring
                      )}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </Field>

                {/* Mention obligatoire */}
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                  <p>
                    <strong>Important :</strong> En modifiant votre mot de passe de cette façon,
                    vous aurez besoin d&apos;une nouvelle validation du super administrateur et, entre
                    temps, votre compte sera suspendu.
                  </p>
                </div>

                <label className="flex items-start gap-2 text-[13px] text-slate-700">
                  <input
                    type="checkbox"
                    className="accent-current mt-0.5"
                    checked={fAck}
                    onChange={(e) => setFAck(e.target.checked)}
                  />
                  <span>J’ai lu et je comprends la mention ci-dessus.</span>
                </label>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <ArrowLeft className="w-4 h-4" /> Annuler
                  </button>

                  <button
                    className={classNames(
                      'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white font-semibold transition shadow-sm',
                      ACCENT_MAP[accent].solid,
                      ACCENT_MAP[accent].hover,
                      fLoading && 'opacity-80 cursor-not-allowed'
                    )}
                    disabled={!fValid || fLoading}
                  >
                    {fLoading ? 'Réinitialisation…' : 'Réinitialiser'} <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Modale CGU */}
          <Modal
            open={showTerms}
            onClose={() => setShowTerms(false)}
            title="Conditions Générales d’Utilisation"
            size="xl"
          >
            <TermsContent />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowTerms(false)}
                className="cursor-pointer inline-flex items-center gap-2 rounded-lg px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300"
              >
                J’ai lu
              </button>
            </div>
          </Modal>

          {/* Modale Politique de confidentialité */}
          <Modal
            open={showPrivacy}
            onClose={() => setShowPrivacy(false)}
            title="Politique de confidentialité"
            size="xl"
          >
            <PrivacyContent />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPrivacy(false)}
                className="cursor-pointer inline-flex items-center gap-2 rounded-lg px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300"
              >
                J’ai compris
              </button>
            </div>
          </Modal>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
