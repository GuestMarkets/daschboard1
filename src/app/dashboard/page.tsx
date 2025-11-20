import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/auth';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth');

  if (user.status !== 'VALIDATED') {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold">Compte en attente</h1>
        <p className="text-slate-600 mt-2">
          Votre compte est <b>suspendu</b> et en attente de validation par un super administrateur.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Bonjour, {user.name}</h1>
      <p className="text-slate-600 mt-2">Vous êtes connecté et validé ✅</p>
    </div>
  );
}
