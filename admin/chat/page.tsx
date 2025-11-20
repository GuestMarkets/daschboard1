// app/admin/chat/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "../../components/Sidebar";
import TopBar from "../../components/TopBar";
import {
  MessageSquare, Users, FolderKanban, Building2, ShieldAlert, Paperclip, Send, FileText, Search,
  Edit3, Trash2, Smile, MoreHorizontal, Check, X, UserCircle
} from "lucide-react";

type ChannelType = "dm" | "department" | "project" | "team" | "broadcast";
type Channel = { id: number; type: ChannelType; name: string; ref_id?: number | null };
type UserLite = { id: number; name: string; email: string };
type Msg = {
  id: number;
  channel_id: number;
  from_user_id: number;
  from_name: string;
  body: string | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
  reactions?: Reaction[];
};
type FileLite = { id: number; message_id: number; original_name: string; mime_type: string; size_bytes: number };
type Me = { userId: number; isSuper: boolean };
type Reaction = { emoji: string; count: number; userNames: string[]; userReacted: boolean };

const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// Emojis disponibles pour les réactions
const EMOJI_LIST = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🎉', '👏', '🔥', '✅', '❌', '⭐', '💡', '🤔', '👀', '💪', '🙏', '😊', '😕'];

async function fetchJSON<T = any>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
  } catch {}
  const res = await fetch(url, { credentials: "include", ...init, headers });
  const ct = res.headers.get("content-type") || "";
  let data: any = null;
  if (ct.includes("application/json")) data = await res.json().catch(() => null);
  else {
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
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

  // Composer
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);

  // Edition de message
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  // Emojis
  const [showEmojiPicker, setShowEmojiPicker] = useState<number | null>(null);

  // Recherche gauche
  const [qChan, setQChan] = useState("");
  const [qUser, setQUser] = useState("");

  // SSE / Polling
  const esRef = useRef<EventSource | null>(null);
  const lastIdRef = useRef<number>(0);
  const pollRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Charger "moi"
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJSON<{ userId: number; isSuper: boolean }>("/api/chat/me");
        setMe({ userId: Number(data.userId || 0), isSuper: !!data.isSuper });
      } catch {
        setMe({ userId: 0, isSuper: false });
      }
    })();
  }, []);

  // Charger canaux + contacts
  useEffect(() => {
    (async () => {
      try {
        const [c, u] = await Promise.all([
          fetchJSON<{ items: Channel[] }>("/api/chat/channels"),
          fetchJSON<{ items: UserLite[] }>("/api/chat/users"),
        ]);
        setChannels(c.items || []);
        setContacts(u.items || []);
        setErr(null);
        if (!selChan && c.items?.length) setSelChan(c.items[0]);
      } catch (e: any) {
        setErr(e?.message ?? "Erreur chargement");
      }
    })();
  }, []);

  // Charger messages d'un canal avec réactions
  async function loadMessages(chn: Channel, since?: number) {
    setLoading(!since);
    try {
      const qs = new URLSearchParams({ channelId: String(chn.id) });
      if (typeof since === "number" && Number.isFinite(since) && since > 0) qs.set("since", String(since));
      const data = await fetchJSON<{ items: Msg[]; files: FileLite[] }>(`/api/chat/messages?${qs.toString()}`);

      // Charger les réactions pour chaque message
      const messagesWithReactions = await Promise.all(
        (data.items || []).filter(msg => !msg.deleted_at).map(async (msg) => {
          try {
            const reactionsData = await fetchJSON<{ reactions: Reaction[] }>(`/api/chat/messages/${msg.id}/reactions`);
            return { ...msg, reactions: reactionsData.reactions || [] };
          } catch {
            return { ...msg, reactions: [] };
          }
        })
      );

      if (since) {
        setMsgs(prev => [...prev, ...messagesWithReactions]);
        setFiles(prev => [...prev, ...(data.files || [])]);
      } else {
        setMsgs(messagesWithReactions);
        setFiles(data.files || []);
      }

      const arr = data.items || [];
      if (arr.length) {
        const last = arr[arr.length - 1];
        lastIdRef.current = Number(last.id) || 0;
      }
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur messages");
      if (!since) { setMsgs([]); setFiles([]); }
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 10);
    }
  }

  // (Re)connecter SSE sur le canal sélectionné

  useEffect(() => {
    if (!selChan) return;

    try { esRef.current?.close(); } catch {}
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    lastIdRef.current = 0;
    loadMessages(selChan);

    // SSE avec gestion des événements d'édition/suppression/réactions
    const url = `/api/chat/stream?channelId=${encodeURIComponent(selChan.id)}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);

        if (payload.type === 'message_updated') {
          // Mise à jour d'un message
          setMsgs(prev => prev.map(msg =>
            msg.id === payload.id
              ? { ...msg, body: payload.body, updated_at: payload.updated_at }
              : msg
          ));
        } else if (payload.type === 'message_deleted') {
          // Suppression d'un message
          setMsgs(prev => prev.filter(msg => msg.id !== payload.id));
        } else if (payload.type === 'reaction_added' || payload.type === 'reaction_removed') {
          // Recharger les réactions pour ce message
          (async () => {
            try {
              const reactionsData = await fetchJSON<{ reactions: Reaction[] }>(`/api/chat/messages/${payload.message_id}/reactions`);
              setMsgs(prev => prev.map(msg =>
                msg.id === payload.message_id
                  ? { ...msg, reactions: reactionsData.reactions || [] }
                  : msg
              ));
            } catch {}
          })();
          
        } else {
          // Nouveau message
          const item: Msg = {
            id: Number(payload.id),
            channel_id: Number(payload.channel_id),
            from_user_id: Number(payload.from_user_id),
            from_name: payload.from_name || "…",
            body: payload.body ?? null,
            created_at: payload.created_at || new Date().toISOString(),
            reactions: []
          };
          setMsgs(prev => [...prev, item]);
          lastIdRef.current = item.id;
          if (Array.isArray(payload.files) && payload.files.length) {
            setFiles(prev => [...prev, ...payload.files]);
          }
        }

        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 20);
      } catch {}
    };

    es.onerror = () => {
      try { es.close(); } catch {}
      pollRef.current = setInterval(() => {
        if (!selChan) return;
        const since = lastIdRef.current;
        loadMessages(selChan, since);
      }, 3000);
    };
    esRef.current = es;

    return () => {
      try { es.close(); } catch {}
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [selChan?.id]);

  const canWrite = selChan ? (selChan.type !== "broadcast" || !!me?.isSuper) : false;

  // Vérifier si un message peut être modifié (15min max)
  const canEditMessage = (msg: Msg): boolean => {
    if (!me || msg.from_user_id !== me.userId) return false;
    if (me.isSuper) return true; // Super admin peut toujours modifier

    const createdAt = new Date(msg.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
    return diffMinutes <= 15;
  };

  // Envoi texte/pdf
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
    } catch (e: any) {
      alert(e?.message ?? "Échec d'envoi");
    }
  }

  // Modifier un message
  async function updateMessage(messageId: number) {
    if (!editText.trim()) return;
    try {
      await fetchJSON(`/api/chat/messages/${messageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editText.trim() }),
      });
      setEditingId(null);
      setEditText("");
    } catch (e: any) {
      alert(e?.message ?? "Échec de modification");
    }
  }

  // Supprimer un message
  async function deleteMessage(messageId: number) {
    if (!confirm("Supprimer ce message ?")) return;
    try {
      await fetchJSON(`/api/chat/messages/${messageId}`, { method: "DELETE" });
    } catch (e: any) {
      alert(e?.message ?? "Échec de suppression");
    }
  }

  // Ajouter une réaction
  async function addReaction(messageId: number, emoji: string) {
    try {
      await fetchJSON(`/api/chat/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      setShowEmojiPicker(null);
    } catch (e: any) {
      if (!e.message.includes("déjà ajoutée")) {
        alert(e?.message ?? "Échec d'ajout de réaction");
      }
    }
  }

  // Retirer une réaction
  async function removeReaction(messageId: number, emoji: string) {
    try {
      await fetchJSON(`/api/chat/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`, {
        method: "DELETE",
      });
    } catch (e: any) {
      alert(e?.message ?? "Échec de suppression de réaction");
    }
  }

  // Démarrer un DM
  async function startDM(u: UserLite) {
    try {
      const data = await fetchJSON<{ channel: Channel }>("/api/chat/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id }),
      });
      setChannels(prev => (prev.some(c => c.id === data.channel.id) ? prev : [...prev, data.channel]));
      setSelChan(data.channel);
    } catch (e: any) {
      alert(e?.message ?? "Impossible d'ouvrir le DM");
    }
  }

  // Grouper les messages par date
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: Msg[] }[] = [];
    let currentDate = "";
    let currentGroup: Msg[] = [];

    for (const msg of msgs) {
      const msgDate = new Date(msg.created_at).toDateString();
      if (msgDate !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, messages: currentGroup });
        }
        currentDate = msgDate;
        currentGroup = [msg];
      } else {
        currentGroup.push(msg);
      }
    }

    if (currentGroup.length > 0) {
      groups.push({ date: currentDate, messages: currentGroup });
    }

    return groups;
  }, [msgs]);

  // Listes filtrées (colonne gauche)
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

  const contactsFiltered = useMemo(() =>
    contacts.filter(u => (u.name + " " + u.email).toLowerCase().includes(qUser.toLowerCase())),
    [contacts, qUser]
  );

  // Fichiers groupés par message
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
            <aside className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={qChan}
                  onChange={e => setQChan(e.target.value)}
                  placeholder="Rechercher une conversation…"
                  className="w-full h-9 pl-7 pr-2 rounded-lg text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* Sections des canaux - inchangées */}
              {groups.broadcast.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-slate-500 mb-1">Diffusion générale</div>
                  <ul className="space-y-1">
                    {groups.broadcast.map(c => (
                      <li key={c.id}>
                        <button
                          onClick={() => setSelChan(c)}
                          className={cls(
                            "w-full text-left px-2 py-2 rounded-lg ring-1 transition",
                            selChan?.id === c.id ? "bg-blue-50 ring-blue-200" : "bg-white ring-slate-200 hover:bg-slate-50"
                          )}
                        >
                          <span className="text-sm text-blue-800 font-medium">Général</span>
                          {!me?.isSuper && <span className="ml-2 text-[11px] text-slate-500">(lecture seule)</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" /> Départements
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

              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> Équipes
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
                  {groups.team.length === 0 && <div className="text-[12px] text-slate-500">Aucune.</div>}
                </ul>
              </div>

              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
                  <FolderKanban className="w-3.5 h-3.5" /> Projets
                </div>
                <ul className="space-y-1 max-h-48 overflow-auto">
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

              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">Discussions privées (DM)</div>
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
                    placeholder="Chercher un contact…"
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
                        {u.name} <span className="text-[11px] text-slate-500">— {u.email}</span>
                      </button>
                    </li>
                  ))}
                  {contactsFiltered.length === 0 && <div className="text-[12px] text-slate-500">Aucun contact.</div>}
                </ul>
              </div>
            </aside>

            {/* CENTER: chat avec groupement par dates */}
            <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white flex flex-col">
              {/* header channel */}
              <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
                {selChan?.type === "dm" ? (
                  <UserCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <MessageSquare className="w-4 h-4 text-blue-700" />
                )}
                <div className="font-medium text-slate-900 text-sm truncate">
                  {selChan?.name || "Conversation"}
                  {selChan?.type === "dm" && <span className="ml-1 text-xs text-slate-500">(Message privé)</span>}
                </div>
                {me?.isSuper && (
                  <span className="ml-auto text-[10px] bg-red-50 text-red-700 ring-1 ring-red-200 px-2 py-0.5 rounded-lg flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" />
                    Super Admin
                  </span>
                )}
                {selChan?.type === "broadcast" && (
                  <span className="ml-auto text-[11px] bg-blue-50 text-blue-800 ring-1 ring-blue-200 px-2 py-0.5 rounded-lg">
                    {me?.isSuper ? "Vous pouvez écrire" : "Lecture seule (super admin uniquement)"}
                  </span>
                )}
              </div>

              {/* messages with date grouping */}
              <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 bg-slate-50">
                {loading && <div className="text-sm text-slate-500">Chargement…</div>}
                {!loading && groupedMessages.length === 0 && <div className="text-sm text-slate-500">Aucun message.</div>}

                {groupedMessages.map((group, groupIdx) => (
                  <div key={group.date}>
                    {/* Séparateur de date */}
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-slate-300"></div>
                      <div className="px-3 py-1 bg-slate-200 text-slate-600 text-xs font-medium rounded-full">
                        {fmtDate(group.messages[0].created_at)}
                      </div>
                      <div className="flex-1 h-px bg-slate-300"></div>
                    </div>

                    {/* Messages du jour */}
                    <div className="space-y-2">
                      {group.messages.map(m => {
                        const mine = me ? m.from_user_id === me.userId : false;
                        const f = filesByMsg[m.id] || [];
                        const canEdit = canEditMessage(m);
                        const isEditing = editingId === m.id;

                        return (
                          <div
                            key={m.id}
                            className={cls(
                              "max-w-[85%] sm:max-w-[70%] rounded-xl px-3 py-2 group relative",
                              mine ? "ml-auto bg-blue-600 text-white" : "bg-white ring-1 ring-slate-200"
                            )}
                          >
                            {/* En-tête du message */}
                            <div className={cls("text-[11px] mb-0.5 flex items-center justify-between", mine ? "text-blue-100" : "text-slate-500")}>
                              <span>
                                {m.from_name} • {fmtTime(m.created_at)}
                                {m.updated_at && <span className="ml-1 opacity-70">(modifié)</span>}
                              </span>

                              {/* Boutons d'actions (visibles au hover) */}
                              {!isEditing && (
                                <div className={cls("flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity", mine ? "text-blue-100" : "text-slate-400")}>
                                  {/* Bouton emoji */}
                                  <button
                                    onClick={() => setShowEmojiPicker(showEmojiPicker === m.id ? null : m.id)}
                                    className="p-1 hover:bg-black/10 rounded"
                                    title="Ajouter une réaction"
                                  >
                                    <Smile className="w-3 h-3" />
                                  </button>

                                  {/* Bouton edit pour ses propres messages */}
                                  {mine && canEdit && (
                                    <button
                                      onClick={() => {
                                        setEditingId(m.id);
                                        setEditText(m.body || "");
                                      }}
                                      className="p-1 hover:bg-black/10 rounded"
                                      title="Modifier"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                    </button>
                                  )}

                                  {/* Bouton delete : pour ses propres messages OU super admin */}
                                  {((mine && canEdit) || (me?.isSuper)) && (
                                    <button
                                      onClick={() => deleteMessage(m.id)}
                                      className={cls(
                                        "p-1 rounded transition-colors",
                                        !mine && me?.isSuper
                                          ? "text-red-600 hover:bg-red-100"
                                          : "hover:bg-black/10"
                                      )}
                                      title={!mine && me?.isSuper ? "Supprimer (Modération)" : "Supprimer"}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Contenu du message ou édition */}
                            {isEditing ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editText}
                                  onChange={e => setEditText(e.target.value)}
                                  className="w-full p-2 text-sm rounded border border-slate-300 text-slate-900 resize-none"
                                  rows={2}
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => updateMessage(m.id)}
                                    className="flex items-center gap-1 px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                                  >
                                    <Check className="w-3 h-3" /> Sauver
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditText("");
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 bg-slate-500 text-white text-xs rounded hover:bg-slate-600"
                                  >
                                    <X className="w-3 h-3" /> Annuler
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {m.body && <div className="text-sm whitespace-pre-wrap">{m.body}</div>}

                                {/* Fichiers */}
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

                                {/* Réactions */}
                                {m.reactions && m.reactions.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {m.reactions.map(reaction => (
                                      <button
                                        key={reaction.emoji}
                                        onClick={() => {
                                          if (reaction.userReacted) {
                                            removeReaction(m.id, reaction.emoji);
                                          } else {
                                            addReaction(m.id, reaction.emoji);
                                          }
                                        }}
                                        className={cls(
                                          "inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-colors",
                                          reaction.userReacted
                                            ? "bg-blue-100 border-blue-300 text-blue-800"
                                            : "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200"
                                        )}
                                        title={`${reaction.userNames.join(', ')}`}
                                      >
                                        <span>{reaction.emoji}</span>
                                        <span>{reaction.count}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}

                            {/* Sélecteur d'emojis */}
                            {showEmojiPicker === m.id && (
                              <div className="absolute top-full left-0 mt-1 p-2 bg-white rounded-lg shadow-lg border border-slate-200 z-10">
                                <div className="grid grid-cols-5 gap-1">
                                  {EMOJI_LIST.map(emoji => (
                                    <button
                                      key={emoji}
                                      onClick={() => addReaction(m.id, emoji)}
                                      className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded text-lg"
                                      title={emoji}
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* composer */}
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
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder={
                      selChan?.type === "broadcast" && !me?.isSuper
                        ? "Message (lecture seule — super admin)"
                        : "Écrire un message…"
                    }
                    disabled={!selChan || !canWrite}
                    className="flex-1 h-9 px-3 rounded-lg ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!selChan || (!text.trim() && !pdf) || !canWrite}
                    className={cls(
                      "h-9 px-3 rounded-lg text-white inline-flex items-center gap-1",
                      (!selChan || (!text.trim() && !pdf) || !canWrite) ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                    )}
                  >
                    <Send className="w-4 h-4" /> Envoyer
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
                    {selChan.type === "broadcast" && (
                      <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1 mt-2">
                        Seul le super admin peut écrire ici.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-500">Choisis un canal pour voir ses infos.</div>
                )}
              </div>

              {/* Nouvelles fonctionnalités info */}
              <div className="mt-4 pt-4 border-t border-slate-200">
                <div className="text-xs text-slate-500 space-y-1">
                  
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>

      {/* Fermer le sélecteur d'emoji en cliquant à l'extérieur */}
      {showEmojiPicker && (
        <div
          className="fixed inset-0 z-5"
          onClick={() => setShowEmojiPicker(null)}
        />
      )}
    </>
  );
}
