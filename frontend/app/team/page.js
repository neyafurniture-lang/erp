'use client';

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import BiweeklyTimesheet from '../../components/BiweeklyTimesheet';
import WeeklyPlanner from '../../components/WeeklyPlanner';

const TABS = [
  { id: 'timesheet', label: 'Feuille de temps' },
  { id: 'planning', label: 'Planning shifts' },
];

export default function TeamPage() {
  const [tab, setTab] = useState('timesheet');

  return (
    <AuthGuard>
      <AppShell
        title="Équipe"
        subtitle="Feuille de temps quinzaine · congés · shifts"
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
              Planifiez les shifts atelier. L’équipe peut aussi confirmer dans{' '}
              <Link href="/mes-heures" className="text-neya-orange font-medium hover:underline">
                Mes heures
              </Link>
              .
            </p>
            <WeeklyPlanner showTasks={false} showShifts title="Planning des shifts" />
          </>
        )}
      </AppShell>
    </AuthGuard>
  );
}
