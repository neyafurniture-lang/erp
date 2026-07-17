'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import WeeklyPlanner from '../../components/WeeklyPlanner';

export default function CalendarPage() {
  return (
    <AuthGuard>
      <AppShell title="Calendrier" subtitle="Production, tâches et équipe" wide>
        <WeeklyPlanner showTasks showShifts title="Production & équipe" />
      </AppShell>
    </AuthGuard>
  );
}
