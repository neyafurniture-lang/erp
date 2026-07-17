'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import WeeklyPlanner from '../../components/WeeklyPlanner';

export default function TeamPage() {
  return (
    <AuthGuard>
      <AppShell title="Équipe & planning" subtitle="Shifts atelier et disponibilités" wide>
        <WeeklyPlanner showTasks={false} showShifts title="Planning des shifts" />
      </AppShell>
    </AuthGuard>
  );
}
