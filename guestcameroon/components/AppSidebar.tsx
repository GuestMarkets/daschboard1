// components/AppSidebar.tsx (compact)
"use client";
import * as React from "react";
import {
  Home,
  CheckSquare,
  CalendarClock,
  Target,
  Settings,
  Layers,
  ChevronRight,
  X,
  User as UserIcon,
} from "lucide-react";

export type NavKey = "dashboard" | "taches" | "planning" | "objectifs" | "settings";
type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;

type ColorKey = "blue" | "emerald" | "purple" | "orange" | "pink" | "indigo" | "cyan" | "gray";

const colorClasses: Record<ColorKey, { btn: string; light: string; ring: string }> = {
  blue:    { btn: "bg-blue-500 text-white hover:bg-blue-600",       light: "bg-blue-50 text-blue-600",       ring: "focus:ring-blue-500" },
  emerald: { btn: "bg-emerald-500 text-white hover:bg-emerald-600", light: "bg-emerald-50 text-emerald-600", ring: "focus:ring-emerald-500" },
  purple:  { btn: "bg-purple-500 text-white hover:bg-purple-600",   light: "bg-purple-50 text-purple-600",   ring: "focus:ring-purple-500" },
  orange:  { btn: "bg-orange-500 text-white hover:bg-orange-600",   light: "bg-orange-50 text-orange-600",   ring: "focus:ring-orange-500" },
  pink:    { btn: "bg-pink-500 text-white hover:bg-pink-600",       light: "bg-pink-50 text-pink-600",       ring: "focus:ring-pink-500" },
  indigo:  { btn: "bg-indigo-500 text-white hover:bg-indigo-600",   light: "bg-indigo-50 text-indigo-600",   ring: "focus:ring-indigo-500" },
  cyan:    { btn: "bg-cyan-500 text-white hover:bg-cyan-600",       light: "bg-cyan-50 text-cyan-600",       ring: "focus:ring-cyan-500" },
  gray:    { btn: "bg-gray-500 text-white hover:bg-gray-600",       light: "bg-gray-50 text-gray-600",       ring: "focus:ring-gray-500" },
};

export interface AppSidebarProps {
  open: boolean;
  onClose: () => void;
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  kpis?: {
    totalTasks?: number;
    urgent?: number;
    partial?: number;
    meetingsToday?: number;
  };
}

export default function AppSidebar({
  open,
  onClose,
  active,
  onNavigate,
  kpis,
}: AppSidebarProps) {
  const items: Array<{ id: NavKey; label: string; icon: IconType; color: ColorKey; badge?: number }> = [
    { id: "dashboard", label: "Vue d’ensemble", icon: Home,          color: "blue" },
    { id: "taches",    label: "Tâches",         icon: CheckSquare,   color: "emerald", badge: kpis?.totalTasks },
    { id: "planning",  label: "Planning",       icon: CalendarClock, color: "purple",  badge: kpis?.meetingsToday },
    { id: "objectifs", label: "Objectifs",      icon: Target,        color: "orange" },
    { id: "settings",  label: "Paramètres",     icon: Settings,      color: "gray" },
  ];

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sidebar compact */}
      <aside
        className={`fixed left-3 top-3 bottom-3 z-50 w-60 bg-white/80 backdrop-blur-xl 
        rounded-2xl shadow-xl border border-white/20 transform transition-all duration-500 ease-out
        ${open ? "translate-x-0" : "-translate-x-80 lg:translate-x-0"}
        lg:relative lg:left-0 lg:top-0 lg:bottom-0 lg:z-0`}
        aria-label="Barre latérale"
      >
        <div className="flex flex-col h-full p-4">
          {/* Header (plus petit) */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
                <Layers className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-base font-semibold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                  Dashboard
                </h2>
                <p className="text-xs text-gray-500">v2.0</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Fermer la barre latérale"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Navigation (espaces réduits) */}
          <nav className="flex-1 space-y-1.5">
            {items.map((item, index) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              const palette = colorClasses[item.color];

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.id);
                    onClose();
                  }}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-left
                    transition-all duration-200 ease-out hover:scale-[1.02] focus:outline-none ${palette.ring}
                    ${isActive ? `${palette.btn} shadow-md` : "text-gray-600 hover:bg-gray-50"}
                  `}
                  style={{ transitionDelay: `${index * 40}ms` }}
                >
                  <div className={`p-1.5 rounded-lg transition-all duration-200 ${isActive ? "bg-white/20" : palette.light}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-sm">{item.label}</span>
                  {typeof item.badge === "number" && item.badge > 0 && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200">
                      {item.badge}
                    </span>
                  )}
                  {isActive && <ChevronRight className="w-3.5 h-3.5 ml-1 animate-pulse" />}
                </button>
              );
            })}
          </nav>

          {/* Profil utilisateur (compact) */}
          <div className="mt-5 p-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border border-gray-200">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
                <UserIcon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">Admin User</p>
                <p className="text-xs text-gray-500 truncate">admin@example.com</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
