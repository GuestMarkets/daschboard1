'use client';
export default function LogoutButton() {
  return (
    <button
      onClick={async ()=>{
        await fetch('/api/auth/logout',{method:'POST'});
        window.location.href = '/auth';
      }}
      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200"
    >
      Déconnexion
    </button>
  );
}
