// /components/SidebarSoft.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  ChevronRight,
  Home,
  FolderKanban,
  CheckSquare,
  Calendar as CalendarIcon,
  CalendarCheck,
  Target,
  Building2,
  BarChart3,
  MessageSquare,
  Settings as SettingsIcon,
  User as UserIcon,
  Users as UsersIcon,
  ListChecks,
} from "lucide-react";

/**
 * Guest Markets — SidebarSoft (2025, Light Gradient Edition)
 * --------------------------------------------------------------
 * - Palette claire + dégradés
 * - Icônes sur groupes et sous-liens
 * - Groupes pliables (chevron qui pivote)
 * - Actif : pill colorée (#0ea5e9) + ring subtil
 * - Desktop + Drawer mobile
 * - Largeur desktop ~256px
 * - NOUVEAU: à chaque changement de page, tous les groupes se ferment
 *            sauf celui qui contient la page active (reste ouvert).
 */

export type NavIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;
export type Leaf = { href: string; label: string; icon?: NavIcon };

type ItemBase = { label: string; icon?: NavIcon; key?: string };
export type ItemLeaf = ItemBase & { href: string; children?: never };
export type ItemGroup = ItemBase & { children: Leaf[]; href?: never };
export type Item = ItemLeaf | ItemGroup;

/* ====== Thème ====== */
const COL_RED = "#ff0000ff";
const COL_BLUE_DARK = "#0445f8ff";
const COL_SKY = "#0ea5e9"; // couleur de sélection demandée

const SELECT = "#0ea5e9";
const SELECT_RING = "rgba(14,165,233,.55)";
const SELECT_SHADOW = "rgba(14,165,233,.35)";
const BRAND_RING = "rgba(14,165,233,.93)";
const SIDEBAR_BG =
  "linear-gradient(180deg, #ffffff 0%, #f7faff 45%, #f1f4f8ff 100%)";

/* ====== Type guards ====== */
function isLeaf(i: Item): i is ItemLeaf {
  return (i as ItemLeaf).href !== undefined;
}
function isGroup(i: Item): i is ItemGroup {
  return (i as ItemGroup).children !== undefined;
}

/* ====== Helpers ====== */
function isActivePrefix(href: string, current?: string | null) {
  return current === href || (current?.startsWith(href + "/") ?? false);
}
function isActiveExact(href: string, current?: string | null) {
  return current === href;
}
function toKey(label: string) {
  return label.toLowerCase().trim().replace(/\s+/g, "-");
}

export default function SidebarSoft({
  items,
  activeHref,
  title = "Guest Office",
  subtitle = "Dashboard",
  logoSrc = "/logos.png",
  open = false,
  onClose,
  persistKey = "gm_sidebar_opened",
}: {
  items?: Item[];
  activeHref?: string | null;
  title?: string;
  subtitle?: string;
  logoSrc?: string;
  open?: boolean; // mobile drawer
  onClose?: () => void;
  /** Sauvegarde l'état des groupes ouverts dans localStorage */
  persistKey?: string;
}) {
  const pathname = usePathname();
  const current = activeHref ?? pathname;

  /* ====== NAV par défaut (icônes partout) ====== */
  const NAV: Item[] = React.useMemo(
    () =>
      items ?? [
        { href: "/guestmarkets/managers/overview", label: "Vue d’ensemble", icon: Home },
        {
          label: "Projets",
          icon: FolderKanban,
          children: [
            { href: "/guestmarkets/managers/projects", label: "Pour moi", icon: UserIcon },
            { href: "/guestmarkets/managers/projects/tous", label: "Mon departement", icon: UsersIcon },
          ],
        },
        {
          label: "Tâches",
          icon: CheckSquare,
          children: [
            { href: "/guestmarkets/managers/tasks/personnelle", label: "Pour moi", icon: ListChecks },
            { href: "/guestmarkets/managers/tasks", label: "Mon departement", icon: UsersIcon },
          ],
        },
        { href: "/guestmarkets/managers/calendrier", label: "Calendrier", icon: CalendarIcon },
        { href: "/guestmarkets/managers/rapports", label: "Rapports", icon: BarChart3 },
        {
          label: "Planning",
          icon: CalendarCheck,
          children: [
            { href: "/guestmarkets/managers/planning/all", label: "Mon departement", icon: CalendarCheck },
          ],
        },
        {
          label: "Objectifs",
          icon: Target,
          children: [
            { href: "/guestmarkets/managers/objectives", label: "Pour moi", icon: Target },
            { href: "/guestmarkets/managers/objectives/all", label: "Mon departement", icon: Target },
          ],
        },
        { href: "/guestmarkets/managers/chat", label: "Chat", icon: MessageSquare },
        { href: "/guestmarkets/managers/parametres", label: "Paramètres", icon: SettingsIcon },
      ],
    [items]
  );

  /* ====== Calcul: seul le groupe contenant la page active reste ouvert ====== */
  const computeOpenMapForCurrent = React.useCallback(() => {
    const map: Record<string, boolean> = {};
    NAV.forEach((it) => {
      if (isGroup(it)) {
        const key = it.key ?? toKey(it.label);
        // si l'une des entrées du groupe correspond exactement ou par préfixe, on garde OUVERT
        const match = it.children.some((c) => isActiveExact(c.href, current) || isActivePrefix(c.href, current));
        map[key] = !!match;
      }
    });
    return map;
  }, [NAV, current]);

  /* ====== State: opened ======
     - Init à vide (évite mismatch SSR)
     - À chaque changement de page (current), recalcul strict:
       tout se ferme SAUF le groupe de la page active.
  */
  const [opened, setOpened] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    const next = computeOpenMapForCurrent();
    setOpened(next);
    try {
      localStorage.setItem(persistKey, JSON.stringify(next));
    } catch {}
  }, [computeOpenMapForCurrent, persistKey]);

  /* ====== Persist manuel (quand on toggle à la main, hors navigation) ====== */
  React.useEffect(() => {
    try {
      localStorage.setItem(persistKey, JSON.stringify(opened));
    } catch {}
  }, [opened, persistKey]);

  function toggle(k: string) {
    setOpened((s) => ({ ...s, [k]: !s[k] }));
  }

  /* ====== Ligne (groupe ou lien) ====== */
  function Row({
    href,
    label,
    Icon,
    active,
    onClick,
    depth = 0,
    isGroup = false,
    openGroup = false,
  }: {
    href?: string;
    label: string;
    Icon?: NavIcon;
    active?: boolean;
    onClick?: () => void;
    depth?: number;
    isGroup?: boolean;
    openGroup?: boolean;
  }) {
    const indent = depth === 0 ? "" : "pl-8";

    // base visuel
    const base = [
      "group flex w-full items-center justify-between rounded-xl",
      "px-3 py-2.5 text-[13px] transition-colors outline-none",
      "focus-visible:ring-2 focus-visible:ring-offset-0",
      `focus-visible:ring-[${BRAND_RING}]`,
      indent,
      active
        ? "text-white"
        : "text-slate-700 hover:text-slate-900 hover:bg-white",
    ].join(" ");

    // icône encapsulée
    const iconWrap = [
      "mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1",
      active
        ? "bg-white/15 ring-white/30"
        : "bg-gradient-to-br from-[#f8fafc] via-white to-[#f1f5f9] ring-slate-200",
    ].join(" ");

    const IconEl = Icon ? (
      <span className={iconWrap} aria-hidden>
        <Icon className={active ? "h-4 w-4 opacity-95" : "h-4 w-4 opacity-90"} />
      </span>
    ) : null;

    const Chevron = isGroup ? (
      <span
        className="ml-2 inline-flex h-5 w-5 items-center justify-center text-slate-400 transition-transform group-hover:text-slate-600"
        style={{ transform: openGroup ? "rotate(90deg)" : "rotate(0deg)" }}
      >
        <ChevronRight className="h-4 w-4" />
      </span>
    ) : null;

    // pill actif UNIQUEMENT en #0ea5e9
    const activeStyle: React.CSSProperties | undefined = active
      ? {
          background: SELECT,
          boxShadow: `inset 0 0 0 1px ${SELECT_RING}, 0 8px 24px -12px ${SELECT_SHADOW}`,
          border: `1px solid ${SELECT_RING}`,
        }
      : undefined;

    const content = (
      <>
        <div className="flex min-w-0 items-center gap-2.5">
          {IconEl}
          <span className="truncate font-medium">{label}</span>
        </div>
        {Chevron}
      </>
    );

    const sharedProps = {
      onClick,
      style: activeStyle,
      className: base,
      "data-active": active ? "true" : undefined,
    } as const;

    return href ? (
      <Link href={href} aria-current={active ? "page" : undefined} {...sharedProps}>
        {content}
      </Link>
    ) : (
      <button type="button" aria-expanded={openGroup} {...sharedProps}>
        {content}
      </button>
    );
  }

  function NavContent() {
    return (
      <div className="relative h-full">
        {/* Header */}
        <div
          className="h-16 border-b border-slate-200"
          role="banner"
          style={{
            background: `linear-gradient(180deg, ${COL_SKY}1a 0%, ${COL_BLUE_DARK}12 45%, rgba(255,255,255,0) 100%)`,
            boxShadow: `inset 0 -1px 0 rgba(148,163,184,.35)`,
          }}
        >
          <div className="flex h-full items-center gap-3 px-4">
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={title}
                className="h-9 w-9 rounded-xl object-contain ring-1 ring-slate-200 bg-white"
              />
            ) : (
              <div className="h-9 w-9 rounded-xl bg-white ring-1 ring-slate-200" />
            )}
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-900">{title}</div>
              <div className="text-[12px] text-slate-500">{subtitle}</div>
            </div>
          </div>
        </div>

        {/* Liseré dégradé coloré (conservé) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-16 h-[2px]"
          style={{
            background: `linear-gradient(90deg, ${COL_RED}, ${COL_BLUE_DARK}, ${COL_SKY})`,
            boxShadow: `0 0 16px 1px rgba(30,58,138,.18)`,
            opacity: 0.9,
          }}
        />

        {/* Nav */}
        <nav className="h-[calc(100%-64px)] overflow-y-auto p-3">
          <ul className="space-y-1">
            {NAV.map((item, idx) => {
              if (isLeaf(item)) {
                const active = isActivePrefix(item.href, current);
                const Icon = item.icon;
                return (
                  <li key={`leaf-${idx}`}>
                    <Row href={item.href} label={item.label} Icon={Icon} active={active} onClick={onClose} />
                  </li>
                );
              }

              const k = item.key ?? toKey(item.label);
              const Icon = item.icon;
              const open = !!opened[k];

              return (
                <li key={`grp-${idx}`}>
                  <Row
                    label={item.label}
                    Icon={Icon}
                    isGroup
                    openGroup={open}
                    onClick={() => toggle(k)}
                    active={item.children.some((c) => isActivePrefix(c.href, current))}
                  />

                  {/* Sous-menu */}
                  <div
                    className="ml-2 overflow-hidden rounded-xl border border-slate-200 bg-white/70 backdrop-blur-[2px]"
                    style={{ boxShadow: "inset 0 1px 0 rgba(148,163,184,.25)" }}
                  >
                    <div
                      className={`grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${
                        open
                          ? "grid-rows-[1fr] opacity-100 translate-y-0"
                          : "grid-rows-[0fr] opacity-0 -translate-y-0.5"
                      }`}
                    >
                      <div className="min-h-0">
                        <ul className="py-1.5">
                          {item.children.map((c, i) => {
                            const activeChild = isActiveExact(c.href, current);
                            const ChildIcon = c.icon ?? ListChecks;
                            return (
                              <li key={`child-${idx}-${i}`} className="px-1.5">
                                <div className="relative">
                                  {/* Barre d'accent quand actif — UNIQUEMENT #0ea5e9 */}
                                  {activeChild && (
                                    <span
                                      aria-hidden
                                      className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-full"
                                      style={{
                                        background: SELECT,
                                        boxShadow: `0 0 10px ${SELECT_SHADOW}`,
                                      }}
                                    />
                                  )}
                                  <Row
                                    href={c.href}
                                    label={c.label}
                                    depth={1}
                                    active={activeChild}
                                    onClick={onClose}
                                    Icon={ChildIcon}
                                  />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    );
  }

  return (
    <>
      {/* Desktop */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden lg:block border-r border-slate-200"
        style={{
          width: 256,
          background: SIDEBAR_BG,
          boxShadow:
            "0 10px 40px -12px rgba(2,6,23,.12), inset 0 1px 0 rgba(148,163,184,.25)",
        }}
      >
        {/* halos décoratifs clairs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 -left-12 h-36 w-36 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(60% 60% at 50% 50%, rgba(182, 167, 167, 0.25), transparent)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-12 -right-10 h-40 w-40 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(60% 60% at 50% 50%, rgba(14,165,233,.25), transparent)",
          }}
        />
        <NavContent />
      </aside>

      {/* Mobile Drawer */}
      <div className={`lg:hidden ${open ? "fixed inset-0 z-50" : "pointer-events-none fixed inset-0 z-50"}`}>
        {/* Backdrop */}
        <div
          onClick={onClose}
          className={`absolute inset-0 bg-slate-900/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          aria-hidden="true"
        />
        {/* Panel */}
        <div
          className={`absolute inset-y-0 left-0 w-[80vw] max-w-xs transform border-r border-slate-200 shadow-2xl transition-transform duration-300 ease-in-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{
            background: SIDEBAR_BG,
            boxShadow: "0 12px 48px rgba(2,6,23,.16)",
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation latérale"
        >
          <NavContent />
        </div>
      </div>
    </>
  );
}

/*
Utilisation :

<SidebarSoft
  logoSrc="/logo-guest-markets.svg"
  title="Guest Markets"
  subtitle="Dashboard"
  open={mobileOpen}
  onClose={() => setMobileOpen(false)}
/>

// Ou passez vos propres items: Item[]
*/
