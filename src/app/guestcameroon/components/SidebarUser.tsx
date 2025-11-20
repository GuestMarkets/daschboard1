"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  ChevronRight,
  ChevronDown,
  Home,
  Users,
  Building2,
  FolderKanban,
  CheckSquare,
  Calendar as CalendarIcon,
  CalendarCheck,
  Target,
  BarChart3,
  MessageSquare,
  Settings as SettingsIcon,
} from "lucide-react";

/**
 * Guest Markets — Sidebar (Clean, Blue #1e40af, Animated Submenus)
 * ------------------------------------------------------------------
 * - Couleur : #1e40af uniquement pour le bleu
 * - Groupes pliables avec animations fluides
 * - Chevron à droite qui pivote
 * - Logo en haut + titre/sous-titre
 * - Desktop + Drawer mobile
 * - TypeScript strict : aucun "string | undefined" passé à la place d'un string
 */

// Types
export type NavIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;
export type Leaf = { href: string; label: string };

type ItemBase = { label: string; icon?: NavIcon; key?: string };
export type ItemLeaf = ItemBase & { href: string; children?: never };
export type ItemGroup = ItemBase & { children: Leaf[]; href?: never };
export type Item = ItemLeaf | ItemGroup;

const BRAND = "#1e40af"; // bleu demandé

// Type guards
function isLeaf(i: Item): i is ItemLeaf {
  return (i as ItemLeaf).href !== undefined;
}
function isGroup(i: Item): i is ItemGroup {
  return (i as ItemGroup).children !== undefined;
}

// Helpers
function isActive(href: string, current?: string | null) {
  return current === href || (current?.startsWith(href + "/") ?? false);
}
function toKey(label: string) {
  return label.toLowerCase().trim().split(" ").join("-");
}

export default function Sidebar({
  items,
  activeHref,
  title = "Guest Office",
  subtitle = "Dashboard",
  logoSrc = "/logos.png",
  open = false,
  onClose,
}: {
  items?: Item[];
  activeHref?: string | null;
  title?: string;
  subtitle?: string;
  logoSrc?: string; // URL du logo (png/svg/webp)
  open?: boolean; // panneau mobile
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const current = activeHref ?? pathname;

  // NAV par défaut selon le besoin exprimé
  const NAV: Item[] = React.useMemo(
    () =>
      items ?? [
        { href: "/users/overview", label: "Vue d’ensemble", icon: Home },
        { href: "/users/Projets", label: "projets", icon: Home },
        { href: "/users/tasks/personnelle", label: "Tâches", icon: Home },
        { href: "/users/calendrier", label: "Calendrier", icon: CalendarIcon },
        { href: "/users/rapports", label: "Rapports", icon: BarChart3 },
        { href: "/users/Planning", label: "Planning", icon: BarChart3 },
        { href: "/users/objectives", label: "objectifs", icon: BarChart3 },
        { href: "/users/chat", label: "Chat", icon: MessageSquare },
        { href: "/users/parametres", label: "Paramètres", icon: SettingsIcon },
      ],
    [items]
  );

  // Ouverture par défaut des groupes liés à la route courante
  const initialOpen = React.useMemo(() => {
    const map: Record<string, boolean> = {};
    NAV.forEach((it) => {
      if (isGroup(it)) {
        const href0 = it.children?.[0]?.href;
        if (href0) {
          const base = href0.split("/").slice(0, 3).join("/");
          if (current?.startsWith(base)) map[it.key ?? toKey(it.label)] = true;
        }
      }
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const [opened, setOpened] = React.useState<Record<string, boolean>>(initialOpen);

  function toggle(k: string) {
    setOpened((s) => ({ ...s, [k]: !s[k] }));
  }

// Core list item (lien ou bouton de groupe)
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
  depth?: number; // 0 = racine, >=1 = sous-menu
  isGroup?: boolean;
  openGroup?: boolean;
}) {
  const pad = depth === 0 ? "px-3" : "pl-10 pr-3";

  const base = `flex items-center justify-between w-full ${pad} text-[13px] transition cursor-pointer`;
  const styleFix = {
    borderRadius: "10px",
    padding: "12px 16px",
    backgroundColor: active ? "#1E90FF" : "#4169E1",
    color: "white",
    display: "flex",
    alignItems: "center",
    fontFamily: "Segoe UI",
    marginBottom: "10px",
  };

  const stateCls = active
    ? "bg-blue-600 text-white"
    : "bg-[#4169E1] hover:bg-blue-700 text-white";

  return href ? (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`${base} ${stateCls}`}
      style={styleFix}
    >
      <div className="flex items-center gap-2 flex-1">
        {Icon ? <Icon className="h-4 w-4 text-white" /> : null}
        <span>{label}</span>
      </div>
    </Link>
  ) : (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={openGroup}
      className={`${base} ${stateCls}`}
      style={styleFix}
    >
      <div className="flex items-center gap-2 flex-1">
        {Icon ? <Icon className="h-4 w-4 text-white" /> : null}
        <span>{label}</span>
      </div>
      {isGroup &&
        (openGroup ? (
          <ChevronDown className="h-4 w-4 text-white transition-transform" />
        ) : (
          <ChevronRight className="h-4 w-4 text-white transition-transform" />
        ))}
    </button>
  );
}

  function NavContent() {
    return (
      <div className="relative h-full">
        {/* Header */}
        <div className="h-14.5 px-4 border-b border-slate-200 flex items-center bg-white">
          <div className="flex items-center gap-3">
            {logoSrc ? (
              // le test garantit string pour src
              <img src={logoSrc!} alt={title} className="h-8 w-8 rounded-md object-contain" />
            ) : (
              <div className="h-8 w-8 rounded-md bg-[rgba(30,64,175,0.10)]" />)
            }
            <div>
              <div className="text-sm font-semibold text-slate-900">{title}</div>
              <div className="text-[12px] text-slate-500">{subtitle}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1 overflow-y-auto h-[calc(100%-64px)]">
          {NAV.map((item, idx) => {
            if (isLeaf(item)) {
              const Icon = item.icon;
              const active = isActive(item.href, current);
              return <Row key={`leaf-${idx}`} href={item.href} label={item.label} Icon={Icon} active={active} onClick={onClose} />;
            }

            // item est un groupe
            const Icon = item.icon;
            const k = item.key ?? toKey(item.label);
            const open = !!opened[k];

            return (
              <div key={`grp-${idx}`}>
                <Row label={item.label} Icon={Icon} isGroup openGroup={open} onClick={() => toggle(k)} />

                {/* Sous-menu animé avec filet vertical */}
                <div className="ml-2 rounded-lg border-l-2" style={{ borderColor: `${BRAND}33` }}>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-out ${open ? "max-h-96 opacity-100 translate-y-0" : "max-h-0 opacity-0 -translate-y-1"}`}
                  >
                    <div className="mt-1 flex flex-col gap-1">
                      {item.children.map((c, i) => (
                        <div
                          key={`childwrap-${idx}-${i}`}
                          className={`transition duration-200 ease-out ${open ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"}`}
                        >
                          <Row
                            href={c.href}
                            label={c.label}
                            depth={1}
                            active={isActive(c.href, current)}
                            onClick={onClose}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden lg:block w-64 bg-white border-r border-slate-200">
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
          className={`absolute inset-y-0 left-0 w-72 bg-white border-r border-slate-200 shadow-xl transform transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "-translate-x-full"}`}
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

<Sidebar
  logoSrc="/logo-guest-markets.svg"
  title="Guest Markets"
  subtitle="Dashboard"
  open={mobileOpen}
  onClose={() => setMobileOpen(false)}
/>

// Vous pouvez aussi passer votre propre tableau `items: Item[]` si vos routes diffèrent.
*/
