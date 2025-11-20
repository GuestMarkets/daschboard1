// app/components/Shell.tsx
"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function Shell({
  children,
  sidebarTitle = "Guest Office",
  sidebarSubtitle = "Dashboard",
}: {
  children: React.ReactNode;
  sidebarTitle?: string;
  sidebarSubtitle?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Ferme la sidebar quand la route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* ====== 1) ZONE GAUCHE : SIDEBAR ====== */}
      <Sidebar
        activeHref={pathname}
        title={sidebarTitle}
        subtitle={sidebarSubtitle}
        open={open}
        onClose={() => setOpen(false)}
      />

      {/* ====== Conteneur principal (gère l'espace pour la sidebar/topbar) ====== */}
      <div
        className="
          lg:pl-64
          min-h-screen
          bg-gradient-to-br from-slate-50 via-white to-sky-50
          pt-14 md:pt-[72px]
        "
      >
        {/* ====== 2) ZONE HAUT : TOPBAR ====== */}
        <header
          className="
            fixed top-0 right-0 z-30 max-w-6xl
            left-0 lg:left-64
            backdrop-blur bg-white/70 border-b border-slate-200
          "
        >
          <div className="max-w-6xl">
            <TopBar onOpenSidebar={() => setOpen(true)} />
          </div>
        </header>

        {/* ====== 3) ZONE CENTRE : PAGE À AFFICHER ====== */}
        <main className="max-w-7xl mx-auto px-3 sm:px-4 py-5">
          {children}
        </main>
      </div>
    </>
  );
}
