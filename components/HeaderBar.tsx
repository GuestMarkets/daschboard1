"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Menu, Bell, Plus, Search, X } from "lucide-react";

/* ---------- Types locaux au header ---------- */
export type NavKey = "dashboard" | "taches" | "planning" | "objectifs" | "settings";

export interface Task {
  id: string;
  title: string;
  owner: string;
  dueAt: string; // ISO
  status: "todo" | "in_progress" | "blocked" | "done";
  progress: number;
  performance: number;
  priority: 1 | 2 | 3;
}

export interface Meeting {
  id: string;
  title: string;
  startAt: string; // ISO
  durationMin: number;
  attendees: string[];
  status: "scheduled" | "done" | "missed";
  location?: string;
  notes?: string;
}

export interface Objective {
  id: string;
  label: string;
  progress: number; // 0..100
}

/* ---------- Utils ---------- */
function uuid(): string {
  // Typage strict sans `any`
  const c: Crypto | undefined =
    typeof window !== "undefined" && typeof window.crypto !== "undefined"
      ? window.crypto
      : undefined;
  return c?.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2);
}

type CreateModal = "none" | "chooser" | "task" | "meeting" | "objective";

interface HeaderBarProps {
  active: NavKey;
  onToggleSidebar: () => void;
  onSearch: (query: string) => void;
  onCreateTask: (t: Task) => void;
  onCreateMeeting: (m: Meeting) => void;
  onCreateObjective: (o: Objective) => void;
}

export default function HeaderBar({
  active,
  onToggleSidebar,
  onSearch,
  onCreateTask,
  onCreateMeeting,
  onCreateObjective,
}: HeaderBarProps) {
  // Recherche (debounce)
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query, onSearch]);

  // Modals
  const [modal, setModal] = useState<CreateModal>("none");

  function openCreateModal() {
    if (active === "dashboard" || active === "settings") {
      setModal("chooser");
      return;
    }
    setModal(active === "taches" ? "task" : active === "planning" ? "meeting" : "objective");
  }

  const title = useMemo(
    () =>
      active === "dashboard"
        ? "Vue d’ensemble"
        : active === "taches"
        ? "Tâches"
        : active === "planning"
        ? "Planning"
        : active === "objectifs"
        ? "Objectifs"
        : "Paramètres",
    [active]
  );

  const subtitle = useMemo(
    () =>
      active === "dashboard"
        ? "Aperçu de vos indicateurs clés"
        : active === "taches"
        ? "Suivez l’avancement et les priorités"
        : active === "planning"
        ? "Planifiez et reprogrammez vos réunions"
        : active === "objectifs"
        ? "Pilotez vos OKR / objectifs"
        : "Réglages de l’espace",
    [active]
  );

  return (
    <>
      {/* Header compact & full width */}
      <header className="w-full bg-white/90 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 md:px-6 py-2.5 md:py-3">
          <div className="flex items-center gap-3 md:gap-4">
            <button
              onClick={onToggleSidebar}
              className="lg:hidden p-2 rounded-xl hover:bg-gray-100 transition"
              aria-label="Ouvrir la barre latérale"
            >
              <Menu className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl md:text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent leading-snug">
                {title}
              </h1>
              <p className="text-gray-500 text-sm md:text-base">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            {/* Recherche */}
            <div className="hidden md:flex relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 pr-3 py-2 w-56 md:w-64 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              className="relative p-2 rounded-xl text-gray-600 hover:bg-gray-100 transition"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-4.5 h-4.5 min-w-[18px] min-h-[18px] bg-red-500 text-white text-[10px] rounded-full grid place-items-center leading-none">
                3
              </span>
            </button>

            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-3 md:px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl hover:shadow-lg transition"
            >
              <Plus className="w-4 h-4 md:w-5 md:h-5" />
              <span className="hidden sm:inline text-sm md:text-base">Nouveau</span>
            </button>
          </div>
        </div>

        {/* Barre de recherche mobile */}
        <div className="md:hidden px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 pr-3 py-2 w-full bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </header>

      {/* Modals */}
      {modal !== "none" && (
        <Modal onClose={() => setModal("none")}>
          {modal === "chooser" && (
            <Chooser
              onPick={(what) => setModal(what)}
              onClose={() => setModal("none")}
            />
          )}
          {modal === "task" && (
            <TaskForm
              onCreate={(t) => {
                onCreateTask(t);
                setModal("none");
              }}
              onCancel={() => setModal("none")}
            />
          )}
          {modal === "meeting" && (
            <MeetingForm
              onCreate={(m) => {
                onCreateMeeting(m);
                setModal("none");
              }}
              onCancel={() => setModal("none")}
            />
          )}
          {modal === "objective" && (
            <ObjectiveForm
              onCreate={(o) => {
                onCreateObjective(o);
                setModal("none");
              }}
              onCancel={() => setModal("none")}
            />
          )}
        </Modal>
      )}
    </>
  );
}

/* ---------- Modal & Forms ---------- */
function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-900">Créer</div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Fermer">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Chooser({
  onPick,
  onClose,
}: {
  onPick: (what: "task" | "meeting" | "objective") => void;
  onClose: () => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {[
        { id: "task", label: "Tâche", desc: "Ajouter une nouvelle tâche" },
        { id: "meeting", label: "Réunion", desc: "Planifier une réunion" },
        { id: "objective", label: "Objectif", desc: "Définir un objectif" },
      ].map((it) => (
        <button
          key={it.id}
          className="p-4 rounded-xl ring-1 ring-gray-200 hover:bg-gray-50 text-left transition"
          onClick={() => onPick(it.id as "task" | "meeting" | "objective")}
        >
          <div className="font-semibold text-gray-900">{it.label}</div>
          <div className="text-sm text-gray-500">{it.desc}</div>
        </button>
      ))}
      <div className="sm:col-span-3 flex justify-end">
        <button className="mt-1 px-3 py-2 text-gray-700 rounded-xl hover:bg-gray-100" onClick={onClose}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function TaskForm({
  onCreate,
  onCancel,
}: {
  onCreate: (t: Task) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useState<1 | 2 | 3>(2);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !owner.trim()) return;
    onCreate({
      id: uuid(),
      title: title.trim(),
      owner: owner.trim(),
      dueAt: new Date(due).toISOString(),
      status: "todo",
      progress: 0,
      performance: 0,
      priority,
    });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <input className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Intitulé"
             value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Responsable"
             value={owner} onChange={(e) => setOwner(e.target.value)} />
      <input type="date" className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
             value={due} onChange={(e) => setDue(e.target.value)} />
      <select className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
              value={priority} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)}>
        <option value={1}>Priorité haute</option>
        <option value={2}>Priorité normale</option>
        <option value={3}>Priorité basse</option>
      </select>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl hover:bg-gray-100">Annuler</button>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700">Ajouter la tâche</button>
      </div>
    </form>
  );
}

function MeetingForm({
  onCreate,
  onCancel,
}: {
  onCreate: (m: Meeting) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState<number>(45);
  const [attendees, setAttendees] = useState<string>("");
  const [location, setLocation] = useState<string>("Salle A");
  const [notes, setNotes] = useState<string>("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const [hh, mm] = time.split(":").map(Number);
    const d = new Date(date);
    d.setHours(hh, mm, 0, 0);
    onCreate({
      id: uuid(),
      title: title.trim(),
      startAt: d.toISOString(),
      durationMin: Number(duration),
      attendees: attendees.split(/[,;]+/g).map((s) => s.trim()).filter(Boolean),
      status: "scheduled",
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <input className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none sm:col-span-2"
             placeholder="Objet de la réunion" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input type="date" className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
             value={date} onChange={(e) => setDate(e.target.value)} />
      <input type="time" className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
             value={time} onChange={(e) => setTime(e.target.value)} />
      <input type="number" min={15} step={15} className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
             value={duration} onChange={(e) => setDuration(Number(e.target.value))} placeholder="Durée (min)" />
      <input className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none sm:col-span-2"
             placeholder="Participants (séparés par virgule)" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
      <input className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none sm:col-span-2"
             placeholder="Lieu (salle, lien visio…)" value={location} onChange={(e) => setLocation(e.target.value)} />
      <textarea rows={3} className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none sm:col-span-2"
                placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl hover:bg-gray-100">Annuler</button>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700">Planifier</button>
      </div>
    </form>
  );
}

function ObjectiveForm({
  onCreate,
  onCancel,
}: {
  onCreate: (o: Objective) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [progress, setProgress] = useState<number>(0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    onCreate({ id: uuid(), label: label.trim(), progress: Math.max(0, Math.min(100, progress)) });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3">
      <input className="px-3 py-2 rounded-xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
             placeholder="Nom de l’objectif" value={label} onChange={(e) => setLabel(e.target.value)} />
      <div>
        <label className="text-xs text-gray-500">Progression</label>
        <input type="range" min={0} max={100} value={progress}
               onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-blue-600" />
        <div className="text-right text-sm text-gray-700 tabular-nums">{progress}%</div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl hover:bg-gray-100">Annuler</button>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700">Ajouter l’objectif</button>
      </div>
    </form>
  );
}
