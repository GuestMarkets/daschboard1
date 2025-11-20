// app/planning/page.tsx
import { getCurrentUser } from "../../../../../lib/auth";
import { canAccessPlanning } from "../../../../../lib/rbac";
import PlanningClient from "./SoloClient";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const cu = await getCurrentUser();
  if (!cu) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-xl font-semibold text-amber-800 mb-2">Session requise</h1>
          <p className="text-amber-800/90">Veuillez vous connecter pour accéder au planning.</p>
        </div>
      </div>
    );
  }

  const allowed = await canAccessPlanning(cu.id);

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-xl font-semibold text-amber-800 mb-2">Accès restreint</h1>
          <p className="text-amber-800/90">
            Cette fonctionnalité est réservée aux responsables, super administrateurs, chefs d’équipe ou chefs de projet.
            Dès que votre rôle sera mis à jour, l’accès sera automatiquement activé.
          </p>
        </div>
      </div>
    );
  }

  return <PlanningClient />;
}
