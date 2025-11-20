// app/layout.tsx  (SERVER COMPONENT — pas de "use client")

import type { Metadata } from "next";
import "./globals.css";

// Correction : bon chemin vers lib/store.tsx
import { Providers } from "../../lib/store";

export const metadata: Metadata = {
  title: "Guest Office",
  description: "Dashboard de suivi des tâches, planning et objectifs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

