'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import AdminTasksPanel from '../../components/AdminTasksPanel';

export default function AdminPage() {
  return (
    <AuthGuard>
      <AppShell title="Tâches bureau" subtitle="Notes, paiements, relances — pas la production atelier">
        <div className="cf-panel neya-enter neya-lift p-4 sm:p-6">
          <AdminTasksPanel />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
