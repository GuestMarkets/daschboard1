// app/planning/solo/page.tsx
import { getCurrentUser } from "../../../../lib/auth";
import { getUserRow, isSuperAdmin } from "../../../../lib/rbac";
import SoloClient from "./PlanningClient";

export const dynamic = "force-dynamic";

export default async function SoloPlanningPage() {
  const cu = await getCurrentUser();
  if (!cu) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-xl font-semibold text-amber-800 mb-2">Session requise</h1>
          <p className="text-amber-800/90">Veuillez vous connecter pour accéder à cette page.</p>
        </div>
      </div>
    );
  }

  const row = await getUserRow(cu.id);
  if (!isSuperAdmin(row)) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-xl font-semibold text-amber-800 mb-2">Accès restreint</h1>
          <p className="text-amber-800/90">
            Cette fonction est réservée au super administrateur. Votre accès sera automatiquement activé si votre rôle change.
          </p>
        </div>
      </div>
    );
  }

  return <SoloClient />;
}
