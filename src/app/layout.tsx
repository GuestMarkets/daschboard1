// app/layout.tsx  (SERVER COMPONENT — pas de "use client")
import type { Metadata } from "next";
import "./globals.css";

// Si tu as un Providers client (redux/zustand/rtk-query, etc.)
import { Providers } from "../../lib/store";

export const metadata: Metadata = {
  title: "Guest Office",
  description: "Dashboard de suivi des tâches, planning et objectifs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50">
        {/* Tu peux garder tes pages qui importent directement Sidebar + TopBar */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
