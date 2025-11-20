// app/admin/chat/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import TopBar from "../../components/TopBar";
import {
  MessageSquare, Users, FolderKanban, Building2, ShieldAlert,
  Paperclip, Send, FileText, Search
} from "lucide-react";

type ChannelType = "dm" | "department" | "project" | "team" | "broadcast";
type Channel = {
  id: number;
  type: ChannelType;
  name: string;
  ref_id?: number | null
  general_open?: boolean;
};
type UserLite = { id: number; name: string; email: string };
type Msg = { id: number; channel_id: number; from_user_id: number; from_name: string; body: string | null; created_at: string };
type FileLite = { id: number; message_id: number; original_name: string; mime_type: string; size_bytes: number };
type Me = { userId: number; isSuper: boolean };

type APIList<T> = { items: T[] };
type APIError = { error?: string };

const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function fetchJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch { /* no-op */ }

  const res = await fetch(url, { credentials: "include", ...init, headers });
  const ct = res.headers.get("content-type") || "";
  let data: unknown = null;

  if (ct.includes("application/json")) {
    try { data = await res.json(); } catch { data = null; }
  } else {
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) } as APIError; }
  }

  if (!res.ok) {
    const msg = (data as APIError)?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export default function ChatPage() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [me, setMe] = useState<Me | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [contacts, setContacts] = useState<UserLite[]>([]);
  const [selChan, setSelChan] = useState<Channel | null>(null);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [files, setFiles] = useState<FileLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // composer
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);

  // recherche gauche
  const [qChan, setQChan] = useState("");
  const [qUser, setQUser] = useState("");

  // SSE / Polling
  const esRef = useRef<EventSource | null>(null);
  const lastIdRef = useRef<number>(0);
  const pollRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- Charger "moi" ----
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJSON<Me>("/api/chat/me");
        setMe({ userId: Number(data.userId || 0), isSuper: !!data.isSuper });
      } catch {
        setMe({ userId: 0, isSuper: false });
      }
    })();
  }, []);

  // ---- Charger canaux + contacts ----
  useEffect(() => {
    (async () => {
      try {
        const [c, u] = await Promise.all([
          fetchJSON<APIList<Channel>>("/api/chat/channels"),
          fetchJSON<APIList<UserLite>>("/api/chat/users"),
        ]);
        setChannels(c.items || []);
        setContacts(u.items || []);
        setErr(null);
        // ne dépend pas de selChan pour éviter le warning deps :
        setSelChan(prev => prev ?? (c.items?.[0] ?? null));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erreur chargement";
        setErr(msg);
      }
    })();
  }, []);

  // ---- Charger messages d’un canal ----
  async function loadMessages(chn: Channel, since?: number) {
    setLoading(!since);
    try {
      const qs = new URLSearchParams({ channelId: String(chn.id) });
      if (typeof since === "number" && Number.isFinite(since) && since > 0) qs.set("since", String(since));
      const data = await fetchJSON<{ items: Msg[]; files: FileLite[] }>(`/api/chat/messages?${qs.toString()}`);
      if (since) {
        setMsgs(prev => [...prev, ...(data.items || [])]);
        setFiles(prev => [...prev, ...(data.files || [])]);
      } else {
        setMsgs(data.items || []);
        setFiles(data.files || []);
      }
      const arr = data.items || [];
      if (arr.length) {
        const last = arr[arr.length - 1];
        lastIdRef.current = Number(last.id) || 0;
      }
      setErr(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur messages";
      setErr(msg);
      if (!since) { setMsgs([]); setFiles([]); }
    } finally {
      setLoading(false);
      // scroll en bas
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 10);
    }
  }

  // ---- (Re)connecter SSE sur le canal sélectionné ----
  useEffect(() => {
    if (!selChan) return;

    try { esRef.current?.close(); } catch { /* no-op */ }
    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }

    lastIdRef.current = 0;
    loadMessages(selChan);

    const url = `/api/chat/stream?channelId=${encodeURIComponent(selChan.id)}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(ev.data) as Partial<Msg> & { files?: FileLite[] };
        const item: Msg = {
          id: Number(payload.id),
          channel_id: Number(payload.channel_id),
          from_user_id: Number(payload.from_user_id),
          from_name: payload.from_name || "…",
          body: (payload.body ?? null) as string | null,
          created_at: payload.created_at || new Date().toISOString(),
        };
        setMsgs(prev => [...prev, item]);
        lastIdRef.current = item.id;
        if (Array.isArray(payload.files) && payload.files.length) {
          setFiles(prev => [...prev, ...payload.files!]);
        }
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 20);
      } catch { /* ignore malformed events */ }
    };

    es.onerror = () => {
      try { es.close(); } catch { /* no-op */ }
      pollRef.current = window.setInterval(() => {
        if (!selChan) return;
        const since = lastIdRef.current;
        loadMessages(selChan, since);
      }, 3000);
    };

    esRef.current = es;

    return () => {
      try { es.close(); } catch { /* no-op */ }
      if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [selChan]);

  // ---- DÉTERMINER SI L’UTILISATEUR PEUT ÉCRIRE ----
  const canWrite = selChan
    ? selChan.type !== "broadcast"
      ? true
      : selChan.general_open || !!me?.isSuper
    : false;

  // ---- Envoi texte/pdf ----
  async function sendMessage() {
    if (!selChan || !canWrite) return;
    try {
      if (pdf) {
        const fd = new FormData();
        fd.set("channelId", String(selChan.id));
        if (text.trim()) fd.set("text", text.trim());
        fd.set("file", pdf);
        await fetchJSON("/api/chat/messages", { method: "POST", body: fd });
        setPdf(null);
        setText("");
        return;
      }
      if (!text.trim()) return;
      await fetchJSON("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: selChan.id, text: text.trim() }),
      });
      setText("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Échec d’envoi";
      alert(msg);
    }
  }

  // ---- Démarrer un DM ----
  async function startDM(u: UserLite) {
    try {
      const data = await fetchJSON<{ channel: Channel }>("/api/chat/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id }),
      });

      // Forcer le nom du channel DM = nom du contact
      const dm: Channel = { ...data.channel, name: u.name };

      setChannels(prev => {
        const exists = prev.some(c => c.id === dm.id);
        return exists ? prev.map(c => (c.id === dm.id ? dm : c)) : [...prev, dm];
      });
      setSelChan(dm);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Impossible d’ouvrir le DM";
      alert(msg);
    }
  }

  // ---- Listes filtrées (colonne gauche) ----
  const groups = useMemo(() => {
    const f = (t: ChannelType) => channels.filter(c => c.type === t && c.name.toLowerCase().includes(qChan.toLowerCase()));
    return {
      broadcast: f("broadcast"),
      department: f("department"),
      team: f("team"),
      project: f("project"),
      dm: f("dm"),
    };
  }, [channels, qChan]);

  const contactsFiltered = useMemo(
    () => contacts.filter(u => (u.name + " " + u.email).toLowerCase().includes(qUser.toLowerCase())),
    [contacts, qUser]
  );

  const filesByMsg = useMemo(() => {
    const m: Record<number, FileLite[]> = {};
    for (const f of files) { (m[f.message_id] ||= []).push(f); }
    return m;
  }, [files]);

  return (
    <>
      <Sidebar activeHref={pathname} title="Guest Office" subtitle="Chat" open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="lg:pl-64 min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 pt-14 md:pt-[72px]">
        <header className="fixed top-0 left-0 right-0 z-30 w-full backdrop-blur bg-white/70 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4">
            <TopBar onOpenSidebar={() => setDrawerOpen(true)} />
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-2 sm:px-4 py-4">
          {err && (
            <div className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <ShieldAlert className="inline w-4 h-4 mr-1" /> {err}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* LEFT: conversations + contacts */}
            <aside className="lg:col-span-3 rounded-2xl border-slate-200 bg-white p-3 space-y-3">
              {/* Recherche canal */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={qChan}
                  onChange={e => setQChan(e.target.value)}
                  placeholder="Rechercher une conversation..."
                  className="w-full h-9 pl-7 pr-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* Canal broadcast (visible par tous) */}
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">Diffusion général</div>
                <ul className="space-y-1">
                  {(groups.broadcast.length > 0 ? groups.broadcast : [{ id: 1, name: "Général", type: "broadcast" as const }]).map(c => (
                    <li key={c.id}>
                      <button
                        onClick={() => me?.isSuper && setSelChan(c)}
                        className={cls(
                          "w-full text-left px-2 py-2 rounded-lg ring-1 transition",
                          selChan?.id === c.id
                            ? "bg-blue-50 ring-blue-200"
                            : "bg-white ring-slate-200 hover:bg-slate-50"
                        )}
                      >
                        <span className="text-sm text-blue-800 font-medium">{c.name}</span>
                        {!me?.isSuper && <span className="ml-2 text-[11px] text-slate-500">(lecture seule)</span>}
                      </button>

                    </li>
                  ))}
                </ul>
              </div>

              {/* Departements */}
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" />
                  Departements
                </div>
                <ul className="space-y-1">
                  {groups.department.map(c => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelChan(c)}
                        className={cls(
                          "w-full text-left px-2 py-2 rounded-lg ring-1 transition",
                          selChan?.id === c.id ? "bg-blue-50 ring-blue-200" : "bg-white ring-slate-200 hover:bg-slate-50"
                        )}
                      >
                        <span className="text-sm text-slate-900">{c.name}</span>
                      </button>
                    </li>
                  ))}
                  {groups.department.length === 0 && <div className="text-[12px] text-slate-500">Aucun.</div>}
                </ul>
              </div>

              {/* Equipes */}
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> Equipes
                </div>
                <ul className="space-y-1">
                  {groups.team.map(c => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelChan(c)}
                        className={cls(
                          "w-full text-left px-2 py-2 rounded-lg ring-1 transition",
                          selChan?.id === c.id ? "bg-blue-50 ring-blue-200" : "bg-white ring-slate-200 hover:bg-slate-50"
                        )}
                      >
                        <span className="text-sm text-slate-900">{c.name}</span>
                      </button>
                    </li>
                  ))}
                  {groups.team.length === 0 && <div className="text-[12px] text-slate-500">Aucun.</div>}
                </ul>
              </div>

              {/* Projets */}
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
                  <FolderKanban className="w-3.5 h-3.5" /> Projets
                </div>
                <ul className="space-y-1">
                  {groups.project.map(c => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelChan(c)}
                        className={cls(
                          "w-full text-left px-2 py-2 rounded-lg ring-1 transition",
                          selChan?.id === c.id ? "bg-blue-50 ring-blue-200" : "bg-white ring-slate-200 hover:bg-slate-50"
                        )}
                      >
                        <span className="text-sm text-slate-900">{c.name}</span>
                      </button>
                    </li>
                  ))}
                  {groups.project.length === 0 && <div className="text-[12px] text-slate-500">Aucun.</div>}
                </ul>
              </div>

              {/* DM */}
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
                  Discussions privees (DM)
                </div>
                <ul className="space-y-1">
                  {groups.dm.map(c => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelChan(c)}
                        className={cls(
                          "w-full text-left px-2 py-2 rounded-lg ring-1 transition",
                          selChan?.id === c.id ? "bg-blue-50 ring-blue-200" : "bg-white ring-slate-200 hover:bg-slate-50"
                        )}
                      >
                        <span className="text-sm text-slate-900">{c.name}</span>
                      </button>
                    </li>
                  ))}
                  {groups.dm.length === 0 && <div className="text-[12px] text-slate-500">Aucun DM.</div>}
                </ul>
              </div>

              {/* Contacts pour démarrer un DM */}
              <div className="pt-2 border-t border-slate-200">
                <div className="text-[11px] font-medium text-slate-500 mb-1">Contacts</div>
                <div className="relative mb-1">
                  <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={qUser}
                    onChange={e => setQUser(e.target.value)}
                    placeholder="Chercher un contact..."
                    className="w-full h-9 pl-7 pr-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <ul className="max-h-40 overflow-auto space-y-1">
                  {contactsFiltered.map(u => (
                    <li key={u.id}>
                      <button
                        onClick={() => startDM(u)}
                        className="w-full text-left px-2 py-1.5 rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 text-sm"
                      >
                        {u.name}
                        <span className="text-[11px] text-slate-500"> - {u.email}</span>
                      </button>
                    </li>
                  ))}
                  {contactsFiltered.length === 0 && <div className="text-[12px] text-slate-500">Aucun Contact.</div>}
                </ul>
              </div>
            </aside>


            {/* CENTER: chat */}
            <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white flex flex-col">
              {/* header channel*/}
              <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-700" />
                <div className="font-medium text-slate text-sm truncate">{selChan?.name || "Conversation"}</div>
                {selChan?.type === "broadcast" && (
                  <span className="ml-auto text-[11px] bg-blue-50 text-blue-800 ring-1 ring-blue-200 ps-2 py-0.5 rounded-lg">
                    {selChan.general_open || me?.isSuper ? "Vous pouvez écrire" : "Lecture seule (super admin uniquement)"}
                  </span>
                )}
              </div>

              {/*messages*/}
              <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-2 bg-slate-50">
                {loading && <div className="text-sm text-slate-500"> Chargement...</div>}
                {!loading && msgs.length === 0 && <div className="text-sm text-slate-500">Aucun message.</div>}
                {msgs.map(m => {
                  const mine = me ? m.from_user_id === me.userId : false;
                  const f = filesByMsg[m.id] || [];
                  return (
                    <div
                      key={m.id}
                      className={cls(
                        "max-w-[85%] sm:max-w-[70%] rounded-xl px-3 py-2",
                        mine ? "ml-auto bg-blue-600 text-white" : "bg-white ring-1 ring-slate-200"
                      )}
                    >
                      <div className={cls("text-[11px] mb-0.5", mine ? "text-blue-100" : "text-slate-500")}>
                        {m.from_name} • {fmtTime(m.created_at)}
                      </div>
                      {m.body && <div className="text-sm whitespace-pre-wrap">{m.body}</div>}
                      {f.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {f.map(ff => (
                            <a
                              key={ff.id}
                              href={`/api/chat/files/${ff.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className={cls(
                                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12.5px]",
                                mine ? "bg-blue-500/30 hover:bg-blue-500/40" : "bg-slate-100 hover:bg-slate-200"
                              )}
                            >
                              <FileText className="w-4 h-4" />
                              {ff.original_name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/*composer*/}
              <div className="p-2 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  <label
                    className={cls(
                      "h-9 w-9 grid place-items-center rounded-lg ring-1 ring-slate-200",
                      canWrite ? "hover:bg-slate-50 cursor-pointer" : "opacity-60 cursor-not-allowed"
                    )}
                    title={canWrite ? "Joindre un PDF" : "Seul le super admin peut envoyer des fichiers ici"}
                  >
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        if (!canWrite) { e.currentTarget.value = ""; return; }
                        setPdf(e.target.files?.[0] || null);
                      }}
                      disabled={!canWrite}
                    />
                    <Paperclip className="w-4 h-4 text-slate-600" />
                  </label>

                  <input
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                    }}
                    placeholder={
                      selChan?.type === "broadcast"
                        ? selChan.general_open
                          ? "Vous pouvez écrire..."
                          : me?.isSuper
                            ? "Vous pouvez écrire (super admin)"
                            : "Lecture seule (super admin uniquement)"
                        : "Écrire un message..."
                    }
                    disabled={!canWrite}
                    className="flex-1 h-9 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />

                  <button
                    onClick={sendMessage}
                    disabled={!canWrite || (!text.trim() && !pdf)}
                    className={cls(
                      "h-9 px-3 rounded-lg text-white inline-flex items-center gap-1",
                      !canWrite || (!text.trim() && !pdf)
                        ? "bg-slate-400 cursor-not-allowed"
                        : "bg-blue-600 hover:bg-blue-700"
                    )}
                  >
                    <Send className="w-4 h-4" />
                    Envoyer
                  </button>
                </div>

                {pdf && (
                  <div className="mt-1 text-[12px] text-slate-600">
                    PDF sélectionné : <b>{pdf.name}</b> ({pdf.type || "application/pdf"}) —{" "}
                    <button onClick={() => setPdf(null)} className="underline">Retirer</button>
                  </div>
                )}
              </div>
            </section>

            {/* RIGHT: info canal */}
            <aside className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="text-sm font-semibold text-slate-900">Détails</div>
              <div className="mt-2 text-[13px] text-slate-700">
                {selChan ? (
                  <>
                    <div><span className="text-slate-500">Type :</span> {selChan.type}</div>
                    <div className="truncate"><span className="text-slate-500">Nom :</span> {selChan.name}</div>

                    {selChan.type !== "dm" && (
                      <div className="text-slate-500 text-[12px] mt-1">
                        Les membres sont déterminés automatiquement (département / équipe / projet).
                      </div>
                    )}

                    {/* Broadcast status for all users */}
                    {selChan.type === "broadcast" && (
                      <div
                        className={cls(
                          "text-[12px] px-2 py-1 mt-2 rounded-md border",
                          selChan.general_open ? "text-green-700 bg-green-50 border-green-200" : "text-red-700 bg-red-50 border-red-200"
                        )}
                      >
                        {selChan.general_open
                          ? "Canal général ouvert : tous les utilisateurs peuvent écrire"
                          : "Seul le super admin peut écrire"}
                      </div>
                    )}

                    {/* Toggle button for super admin */}
                    {selChan.type === "broadcast" && me?.isSuper && (
                      <div className="mt-3">
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/chat/channels/${selChan.id}`, { method: "PATCH" });
                              const data = (await res.json()) as { general_open?: boolean; error?: string };
                              if (!res.ok) throw new Error(data?.error || "Erreur serveur");

                              // Update state with new general_open
                              setSelChan({ ...selChan, general_open: !!data.general_open });
                            } catch (e: unknown) {
                              const msg = e instanceof Error ? e.message : "Erreur inconnue";
                              alert(msg);
                            }
                          }}
                          className={cls(
                            "px-3 py-1 rounded-lg text-white text-sm",
                            selChan.general_open ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                          )}
                        >
                          {selChan.general_open ? "Fermer canal général" : "Ouvrir canal général"}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-500">Choisis un canal pour voir ses infos.</div>
                )}
              </div>
            </aside>

          </div>
        </main>
      </div>
    </>
  );
}
