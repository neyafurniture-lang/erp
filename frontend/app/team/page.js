'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import BiweeklyTimesheet from '../../components/BiweeklyTimesheet';
import WeeklyPlanner from '../../components/WeeklyPlanner';

const TABS = [
  { id: 'planning', label: 'Quarts' },
  { id: 'timesheet', label: 'Feuille de temps' },
];

function TeamPageInner() {
  const searchParams = useSearchParams();
  const initial = searchParams.get('tab') === 'timesheet' ? 'timesheet' : 'planning';
  const [tab, setTab] = useState(initial);

  return (
    <AuthGuard>
      <AppShell
        title="Quarts"
        subtitle="Cliquez un employé, puis glissez sur le calendrier — 8 h par défaut"
        wide
      >
        <div className="mb-5 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`cf-chip ${tab === t.id ? 'cf-chip-active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/mes-heures" className="btn-secondary text-sm min-h-[36px] px-3 py-1.5">
              Mes heures →
            </Link>
            <Link href="/paie" className="btn-ghost text-sm">
              Paie →
            </Link>
          </div>
        </div>

        {tab === 'timesheet' ? (
          <BiweeklyTimesheet />
        ) : (
          <>
            <p className="mb-4 text-sm text-neya-muted">
              1. Cliquez <strong className="text-neya-ink">Olive</strong> ou <strong className="text-neya-ink">Mehdi</strong> à gauche.
              2. Glissez une plage sur le calendrier (lundi 8 h → 16 h).
              3. « Reprendre la semaine dernière » recopie les quarts.
            </p>
            <WeeklyPlanner showTasks={false} showShifts title="Planning des quarts" />
          </>
        )}
      </AppShell>
    </AuthGuard>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={
      <AuthGuard>
        <AppShell title="Quarts"><p className="text-sm text-neya-muted">Chargement…</p></AppShell>
      </AuthGuard>
    }>
      <TeamPageInner />
    </Suspense>
  );
}
