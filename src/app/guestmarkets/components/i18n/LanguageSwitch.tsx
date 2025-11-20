// components/i18n/LanguageSwitch.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Globe2, Check, ChevronDown } from "lucide-react";

type LangCode = "fr" | "en";

type Lang = {
  code: LangCode;
  name: string;
  native: string;
  flag: string;
};

const LANGS: Lang[] = [
  { code: "fr", name: "Français", native: "French", flag: "🇫🇷" },
  { code: "en", name: "English", native: "Anglais", flag: "🇬🇧" },
];

export default function LanguageSwitch({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<LangCode>("fr");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initialise la langue à partir du localStorage
  useEffect(() => {
    let initial: LangCode = "fr";
    try {
      const saved = localStorage.getItem("lang") as LangCode | null;
      if (saved && ["fr", "en"].includes(saved)) {
        initial = saved;
      }
    } catch {
      // ignore
    }
    setLang(initial);
    document.documentElement.lang = initial;

    // Tentative d'appliquer la traduction si Google est déjà prêt
    const t = setTimeout(() => {
      applyGoogleTranslate(initial, false);
    }, 400);
    return () => clearTimeout(t);
  }, []);

  // Fermer le menu si clic à l’extérieur
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, [open]);

  const setGoogleCookie = (from: string, to: string) => {
    try {
      const value = `/${from}/${to}`;
      // cookie standard
      document.cookie = `googtrans=${value};path=/;`;
      // cookie avec domaine pour certains navigateurs
      const host = window.location.hostname;
      document.cookie = `googtrans=${value};domain=.${host};path=/;`;
    } catch {
      // ignore
    }
  };

  const applyGoogleTranslate = (code: LangCode, shouldReload: boolean) => {
    const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");

    if (code === "fr") {
      // retour au français
      setGoogleCookie("fr", "fr");
      if (combo) {
        combo.value = "";
        combo.dispatchEvent(new Event("change"));
      }
    } else if (code === "en") {
      setGoogleCookie("fr", "en");
      if (combo) {
        combo.value = "en";
        combo.dispatchEvent(new Event("change"));
      }
    }

    if (shouldReload) {
      // petit délai pour laisser Google mettre à jour, puis reload complet
      setTimeout(() => {
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }, 600);
    }
  };

  const handleSelect = (code: LangCode) => {
    setLang(code);
    try {
      localStorage.setItem("lang", code);
    } catch {
      // ignore
    }
    document.documentElement.lang = code;
    applyGoogleTranslate(code, true); // ici on force le reload
    setOpen(false);
  };

  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Bouton principal */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="
          inline-flex items-center gap-2
          rounded-lg border border-slate-200
          bg-white/90 px-3 py-1.5
          text-xs md:text-sm text-slate-700
          shadow-sm
          hover:bg-slate-50 hover:border-slate-300
          transition-colors
        "
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Globe2 className="h-4 w-4 opacity-70" />
        <span className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:inline whitespace-nowrap">{current.name}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Liste déroulante */}
      {open && (
        <div
          role="listbox"
          className="
            absolute right-0 mt-2 w-52
            rounded-xl border border-slate-200
            bg-white/95 shadow-lg backdrop-blur-sm
            overflow-hidden z-50
          "
        >
          {LANGS.map((l) => {
            const active = l.code === lang;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => handleSelect(l.code)}
                role="option"
                aria-selected={active}
                className={`
                  flex w-full items-center justify-between
                  px-3 py-2 text-xs md:text-sm
                  transition-colors
                  ${
                    active
                      ? "bg-indigo-50 text-indigo-600"
                      : "text-slate-600 hover:bg-slate-50"
                  }
                `}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="text-base">{l.flag}</span>
                  <span className="flex flex-col text-left leading-tight">
                    <span>{l.name}</span>
                    <span className="text-[11px] text-slate-400">{l.native}</span>
                  </span>
                </span>
                {active && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
