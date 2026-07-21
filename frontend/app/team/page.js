'use client';

import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import WeeklyPlanner from '../../components/WeeklyPlanner';

export default function TeamPage() {
  return (
    <AuthGuard>
      <AppShell title="Équipe & planning" subtitle="Shifts atelier et disponibilités" wide>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-neya-muted">
            Planifiez les shifts ici. Olive (et l’équipe) les confirment ensuite dans{' '}
            <Link href="/mes-heures" className="text-neya-orange font-medium hover:underline">Mes heures</Link>.
          </p>
          <Link href="/mes-heures" className="btn-secondary text-sm min-h-[36px] px-3 py-1.5">
            Mes heures →
          </Link>
        </div>
        <WeeklyPlanner showTasks={false} showShifts title="Planning des shifts" />
      </AppShell>
    </AuthGuard>
  );
}
