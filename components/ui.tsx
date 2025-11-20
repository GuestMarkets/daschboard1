"use client";

import React, { useState } from "react";
import { clamp } from "../../../lib/types";

export function Badge({ color = "slate", children }: { color?: "red" | "orange" | "green" | "slate" | "blue"; children: React.ReactNode; }) {
  const c = {
    red: "bg-red-100 text-red-700 ring-red-200",
    orange: "bg-orange-100 text-orange-700 ring-orange-200",
    green: "bg-green-100 text-green-700 ring-green-200",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    blue: "bg-blue-100 text-blue-700 ring-blue-200",
  }[color];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${c}`}>{children}</span>;
}

export function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode; }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
      <div className="h-full bg-blue-600" style={{ width: `${clamp(value, 0, 100)}%` }} />
    </div>
  );
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; }) {
  return <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-blue-600" />;
}

export function ChipsInput({ values, onChange, placeholder }: { values: string[]; onChange: (vals: string[]) => void; placeholder?: string; }) {
  const [draft, setDraft] = useState("");
  function commitDraft() {
    const parts = draft.split(/[,;\s]+/g).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const merged = Array.from(new Set([...values, ...parts]));
    onChange(merged);
    setDraft("");
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); commitDraft(); }
    else if (e.key === "Backspace" && !draft && values.length > 0) { onChange(values.slice(0, -1)); }
  }
  return (
    <div className="w-full min-h-[42px] px-2 py-1 rounded-xl ring-1 ring-slate-200 focus-within:ring-blue-400 flex flex-wrap gap-1">
      {values.map(v => (
        <span key={v} className="flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200 text-xs">
          {v}
          <button type="button" className="ml-1 text-blue-700/70 hover:text-blue-900" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Retirer ${v}`}>✕</button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[120px] px-2 py-1 outline-none text-sm"
        placeholder={placeholder || "Ajouter… (Entrée, virgule)"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
