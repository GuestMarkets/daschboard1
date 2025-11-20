// components/i18n/LanguageSwitch.tsx
'use client';
import { useEffect, useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';

type Lang = { code: 'fr' | 'en' | 'es' | 'de'; name: string; flag: string };
const LANGS: Lang[] = [
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
];

export default function LanguageSwitch({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang['code']>('fr');

  useEffect(() => {
    const saved = (localStorage.getItem('lang') as Lang['code']) || 'fr';
    setLang(saved);
    document.documentElement.lang = saved;
  }, []);

  const applyGoogleTranslate = (code: Lang['code']) => {
    const combo = document.querySelector<HTMLSelectElement>('.goog-te-combo');
    if (combo) {
      combo.value = code;
      combo.dispatchEvent(new Event('change'));
    }
  };

  const onSelect = (code: Lang['code']) => {
    setLang(code);
    localStorage.setItem('lang', code);
    document.documentElement.lang = code;
    applyGoogleTranslate(code);
    setOpen(false);
  };

  const current = LANGS.find(l => l.code === lang)!;

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border transition-colors"
        style={{
          background: 'var(--chip)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Globe className="w-4 h-4 opacity-70" />
        <span>{current.flag}</span>
        <span className="hidden sm:inline">{current.name}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-2 min-w-[220px] rounded-lg overflow-hidden shadow-lg"
          style={{ background: 'var(--background)', border: `1px solid var(--border)` }}
          role="listbox"
        >
          {LANGS.map(l => {
            const active = l.code === lang;
            return (
              <button
                key={l.code}
                onClick={() => onSelect(l.code)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:opacity-100"
                style={{ color: active ? 'var(--primary)' : 'var(--text-muted)', opacity: active ? 1 : 0.9 }}
                role="option"
                aria-selected={active}
              >
                <span className="inline-flex items-center gap-2">
                  <span>{l.flag}</span>
                  <span>{l.name}</span>
                </span>
                {active && <Check className="w-4 h-4" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
