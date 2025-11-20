"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Shell from "../../components/Shell";
import Modal from "../../components/ui/Modal";
import {
  Search, FileText, Inbox, Globe, Check, XCircle, ClipboardEdit, AlertCircle, Eye
} from "lucide-react";

/* =============================== Types =============================== */
type Report = {
  id:number;
  title:string;
  type:"daily"|"weekly"|"monthly"|"incident"|"meeting"|"other";
  summary:string|null;
  periodStart:string;
  periodEnd:string;
  status:"draft"|"submitted"|"under_review"|"approved"|"rejected"|"changes_requested";
  authorName?:string|null;

  files:{ id:number; original_name:string; mime_type:string; size_bytes:number; uploaded_at?:string }[];
  comments:{ id:number; user_id:number; user_name?:string|null; text:string; created_at:string }[];

  inboxStatus?: Report["status"] | null;
  unread?: boolean;
  readAt?: string | null;

  recipients?: { id:number; name:string; role?:string }[];
};

type Stats = {
  total?: number;
  submitted?: number;
  under_review?: number;
  approved?: number;
};

const cls = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");

/* =============================== fetch util =============================== */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function fetchJSON<T>(url:string, init?:RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept","application/json");
  try {
    const t = localStorage.getItem("auth_token");
    if (t && !headers.has("Authorization")) headers.set("Authorization",`Bearer ${t}`);
  } catch { /* no-op */ }

  const res = await fetch(url, { credentials:"include", ...init, headers });
  const ct = res.headers.get("content-type") || "";

  let data: unknown = null;
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null);
  } else {
    const text = await res.text();
    try { data = JSON.parse(text); }
    catch { data = { error: text.slice(0,200) }; }
  }

  if (!res.ok) {
    const rec = isRecord(data) ? data : {};
    const errMsg = typeof rec.error === "string" ? rec.error : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return data as T;
}

/* =============================== Detail modal =============================== */
function DetailModal({
  open, onClose, reportId, onAction
}:{
  open:boolean; onClose:()=>void; reportId:number|null;
  onAction:(action:"approved"|"rejected"|"changes_requested", message?:string, setGlobal?:boolean)=>Promise<void>;
}){
  const [item,setItem]=useState<Report|null>(null);
  const [err,setErr]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("");
  const [setGlobal,setSetGlobal]=useState(false);

  useEffect(()=>{ (async()=>{
    if(!open||!reportId) return;
    try{
      setLoading(true); setErr(null);
      // Le GET détail marque “lu” seulement si je suis destinataire
      const { item } = await fetchJSON<{item:Report}>(`/api/admin/reports/${reportId}`);
      setItem(item);
    }catch(e: unknown){
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally{
      setLoading(false);
    }
  })(); },[open,reportId]);

  return (
    <Modal open={open} onClose={onClose} title="Détails du rapport" size="lg">
      {!item ? (
        <div className="text-slate-500 text-sm">{loading? "Chargement…" : err ?? "—"}</div>
      ) : (
        <div className="space-y-4">
          {/* en-tête colorée */}
          <div className="rounded-2xl bg-gradient-to-r from-indigo-600 via-fuchsia-500 to-emerald-500 text-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xl font-semibold truncate">{item.title}</div>
                <div className="text-[12px] text-white/90">{item.type} • {item.periodStart} → {item.periodEnd}</div>
                <div className="text-[12px] text-white/90 mt-0.5">Auteur : {item.authorName ?? "—"}</div>
              </div>
              <span className={statusChipCls(item.status)}>{humanStatus(item.status)}</span>
            </div>
          </div>

          {item.summary && (
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4">
              <div className="text-[11px] text-slate-500 mb-1">Résumé</div>
              <div className="text-[13px] text-slate-800 whitespace-pre-wrap">{item.summary}</div>
            </div>
          )}

          {/* Pièces jointes */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4">
            <div className="text-[11px] text-slate-500 mb-2">Pièces jointes</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {item.files.length>0 ? item.files.map(f=>(
                <a key={f.id}
                   href={`/api/admin/reports/files/${f.id}`}
                   target="_blank" rel="noreferrer"
                   className="group flex items-center justify-between gap-2 rounded-xl border p-3 hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-indigo-600"/>
                    <span className="truncate text-[13px] text-slate-800">{f.original_name}</span>
                  </div>
                  <Eye className="w-4 h-4 text-slate-500 group-hover:text-slate-700"/>
                </a>
              )) : <span className="text-[12px] text-slate-500">Aucune pièce.</span>}
            </div>
          </div>

          {/* Commentaires */}
          {item.comments && item.comments.length>0 && (
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4">
              <div className="text-[11px] text-slate-500 mb-2">Commentaires</div>
              <div className="space-y-2">
                {item.comments.map(c=>(
                  <div key={c.id} className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                    <div className="text-[11px] text-slate-500">{c.user_name ?? c.user_id} • {new Date(c.created_at).toLocaleString()}</div>
                    <div className="text-[13px] text-slate-800 whitespace-pre-wrap mt-1">{c.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Intervention */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4">
            <label className="block text-[12px] text-slate-600 mb-1">Motif / corrections (facultatif)</label>
            <textarea
              value={message}
              onChange={e=>setMessage(e.target.value)}
              className="w-full min-h-[90px] px-3 py-2 rounded-xl ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y text-sm"
              placeholder="Écrire un message à l’auteur (ex: raison du refus, corrections demandées)…"
            />
            <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-700">
              <input type="checkbox" checked={setGlobal} onChange={e=>setSetGlobal(e.target.checked)} />
              Appliquer aussi le <b>statut global</b> (si je ne suis pas destinataire).
            </label>
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
            <button
              onClick={()=>onAction("approved", message || undefined, setGlobal)}
              className="px-4 h-10 rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 inline-flex items-center gap-2"
            >
              <Check className="w-4 h-4"/> Approuver
            </button>
            <button
              onClick={()=>onAction("changes_requested", message || undefined, setGlobal)}
              className="px-4 h-10 rounded-xl text-white bg-amber-500 hover:bg-amber-600 inline-flex items-center gap-2"
            >
              <ClipboardEdit className="w-4 h-4"/> Corrections
            </button>
            <button
              onClick={()=>onAction("rejected", message || undefined, setGlobal)}
              className="px-4 h-10 rounded-xl text-white bg-rose-600 hover:bg-rose-700 inline-flex items-center gap-2"
            >
              <XCircle className="w-4 h-4"/> Rejeter
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* =============================== Page =============================== */
export default function AdminReportsPage(){
  const [scope,setScope]=useState<"all"|"received">("all");
  const [items,setItems]=useState<Report[]>([]);
  const [stats,setStats]=useState<Stats>({});
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState<string|null>(null);

  const [q,setQ]=useState(""); const [statusFilter,setStatusFilter]=useState("all"); const [typeFilter,setTypeFilter]=useState("all");
  const [detailId,setDetailId]=useState<number|null>(null);

  const refresh = useCallback(async ()=>{
    setLoading(true);
    try{
      const [list, st] = await Promise.all([
        fetchJSON<{items:Report[]}>(`/api/admin/reports?scope=${scope}`),
        fetchJSON<Stats>(`/api/admin/reports/stats?scope=${scope}`),
      ]);
      setItems(list.items || []);
      setStats(st || {});
      setErr(null);
    }catch(e: unknown){
      setErr(e instanceof Error ? e.message : "Erreur chargement");
    } finally{
      setLoading(false);
    }
  },[scope]);

  useEffect(()=>{ void refresh(); },[refresh]);

  // filtre côté UI (sécurité double) : exclure les brouillons
  const list = useMemo(()=> {
    const cq = q.trim().toLowerCase();
    return items
      .filter(r => r.status !== "draft")
      .filter(r=>{
        if (cq && !(r.title.toLowerCase().includes(cq) || (r.summary??"").toLowerCase().includes(cq))) return false;
        if (statusFilter!=="all") {
          const s = scope==="received" ? (r.inboxStatus||"") : r.status;
          if (s!==statusFilter) return false;
        }
        if (typeFilter!=="all" && r.type!==typeFilter) return false;
        return true;
      });
  },[items, q, statusFilter, typeFilter, scope]);

  async function actOnReport(action:"approved"|"rejected"|"changes_requested", message?:string, setGlobal?:boolean){
    if(!detailId) return;
    await fetchJSON<unknown>(`/api/admin/reports/${detailId}/review`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ action, message, setGlobal: !!setGlobal }),
    });
    setDetailId(null);
    await refresh();
  }

  return (
    <Shell sidebarTitle="Guest Office" sidebarSubtitle="Rapports — Super Admin">
      {/* Hero */}
      <section className="rounded-3xl bg-gradient-to-r from-indigo-600 via-fuchsia-500 to-emerald-500 text-white p-6">
        <div className="flex items-center gap-2">
          {scope==="all" ? <Globe className="w-7 h-7"/> : <Inbox className="w-7 h-7"/>}
          <h1 className="text-2xl md:text-3xl font-semibold">Rapports {scope==="all" ? "— tous" : "— reçus"}</h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <StatCard label="Total" value={stats.total}/>
          <StatCard label="En attente" value={stats.submitted}/>
          <StatCard label="En revue" value={stats.under_review}/>
          <StatCard label="Approuvés" value={stats.approved}/>
        </div>
      </section>

      {/* Filtres */}
      <section className="mt-4 rounded-2xl ring-1 ring-slate-200 bg-white p-3">
        <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
          <div className="flex items-center gap-1 bg-slate-50 ring-1 ring-slate-200 rounded-xl px-2 py-1.5">
            <Search className="w-4 h-4 text-slate-500"/>
            <input
              value={q}
              onChange={e=>setQ(e.target.value)}
              placeholder="Rechercher un titre, un résumé…"
              className="bg-transparent outline-none text-[13px] px-1 py-0.5"
            />
          </div>

          <div className="flex items-center gap-2">
            <Segmented value={scope} onChange={setScope}/>
            <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="px-2 py-1.5 text-[12.5px] rounded-xl ring-1 ring-slate-200">
              <option value="all">Tous statuts</option>
              <option value="submitted">En attente</option>
              <option value="under_review">En revue</option>
              <option value="approved">Approuvés</option>
              <option value="changes_requested">Corrections demandées</option>
              <option value="rejected">Rejetés</option>
            </select>
            <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} className="px-2 py-1.5 text-[12.5px] rounded-xl ring-1 ring-slate-200">
              <option value="all">Tous types</option>
              <option value="daily">Journalier</option>
              <option value="weekly">Hebdomadaire</option>
              <option value="monthly">Mensuel</option>
              <option value="incident">Incident</option>
              <option value="meeting">Compte-rendu</option>
              <option value="other">Autre</option>
            </select>
          </div>
        </div>
      </section>

      {/* Liste (cards glass) */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
        {loading && <div className="col-span-full text-sm text-slate-500">Chargement…</div>}
        {err && !loading && <div className="col-span-full text-sm text-rose-700 bg-rose-50 ring-1 ring-rose-200 p-2 rounded-xl"><AlertCircle className="w-4 h-4 inline mr-1"/> {err}</div>}

        {!loading && list.map(r=>(
          <article
            key={r.id}
            className={cls(
              "relative rounded-2xl p-4 bg-white/70 backdrop-blur ring-1 ring-slate-200 hover:shadow-xl transition-all",
              scope==="received" && r.unread ? "outline outline-2 outline-fuchsia-400/60" : ""
            )}
          >
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900 truncate">{r.title}</h3>
                <p className="text-[12px] text-slate-500">{r.type} • {r.periodStart} → {r.periodEnd}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Auteur : {r.authorName ?? "—"}</p>
              </div>
              <span className={statusChipCls(scope==="received" ? (r.inboxStatus ?? r.status) : r.status)}>
                {humanStatus(scope==="received" ? (r.inboxStatus ?? r.status) : r.status)}
              </span>
            </header>

            {r.summary && (
              <p className="mt-3 text-[13px] text-slate-700 line-clamp-3">{r.summary}</p>
            )}

            <div className="mt-3 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-2">
              <div className="text-[11px] text-slate-500 mb-1">Pièces jointes</div>
              <div className="flex flex-col gap-1">
                {r.files.map(f=>(
                  <a key={f.id}
                     className="inline-flex items-center gap-1.5 text-[12px] text-indigo-700 hover:underline"
                     href={`/api/admin/reports/files/${f.id}`} target="_blank" rel="noreferrer">
                    <FileText className="w-3.5 h-3.5"/> {f.original_name}
                  </a>
                ))}
                {r.files.length===0 && <span className="text-[12px] text-slate-500">Aucune pièce.</span>}
              </div>
            </div>

            <footer className="mt-4 flex justify-end">
              <button
                onClick={()=>setDetailId(r.id)}
                className="h-9 px-3 rounded-xl bg-indigo-600 text-white text-[12.5px] hover:bg-indigo-700 inline-flex items-center gap-1"
              >
                <Search className="w-4 h-4"/> Détails / Intervenir
              </button>
            </footer>
          </article>
        ))}
        {!loading && list.length===0 && <div className="col-span-full text-sm text-slate-500">Aucun rapport (hors brouillons).</div>}
      </section>

      <DetailModal open={!!detailId} onClose={()=>setDetailId(null)} reportId={detailId} onAction={actOnReport}/>
    </Shell>
  );
}

/* =============================== UI helpers =============================== */
function Segmented({value,onChange}:{value:"all"|"received"; onChange:(v:"all"|"received")=>void}){
  return (
    <div className="inline-flex rounded-xl ring-1 ring-slate-200 overflow-hidden bg-white">
      <button onClick={()=>onChange("all")} className={cls("px-3 py-1.5 text-[12.5px]", value==="all"?"bg-slate-900 text-white":"text-slate-700")}>Tous</button>
      <button onClick={()=>onChange("received")} className={cls("px-3 py-1.5 text-[12.5px]", value==="received"?"bg-slate-900 text-white":"text-slate-700")}>Reçus</button>
    </div>
  );
}
function StatCard({label,value}:{label:string; value?:number}){
  return (
    <div className="rounded-2xl bg-white/15 p-4">
      <div className="text-[12px]">{label}</div>
      <div className="text-xl font-semibold">{value ?? "—"}</div>
    </div>
  );
}
function statusChipCls(s: Report["status"] | string){
  const base = "px-2 py-0.5 rounded-md text-[11px] ring-1";
  switch (s) {
    case "approved": return `${base} bg-emerald-50 text-emerald-800 ring-emerald-200`;
    case "rejected": return `${base} bg-rose-50 text-rose-700 ring-rose-200`;
    case "changes_requested": return `${base} bg-amber-50 text-amber-800 ring-amber-200`;
    case "under_review": return `${base} bg-indigo-50 text-indigo-800 ring-indigo-200`;
    case "submitted": return `${base} bg-sky-50 text-sky-800 ring-sky-200`;
    default: return `${base} bg-slate-100 text-slate-700 ring-slate-200`;
  }
}
function humanStatus(s: Report["status"] | string){
  switch (s) {
    case "approved": return "Approuvé";
    case "rejected": return "Rejeté";
    case "changes_requested": return "Corrections";
    case "under_review": return "En revue";
    case "submitted": return "En attente";
    case "draft": return "Brouillon";
    default: return String(s);
  }
}
