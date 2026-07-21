'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import AdminTasksPanel from '../../components/AdminTasksPanel';

export default function AdminPage() {
  return (
    <AuthGuard>
      <AppShell title="Tâches admin" subtitle="Notes, paiements et suivi — accès libre avec permission admin">
        <div className="rounded-2xl border border-neya-border bg-white shadow-sm p-4 sm:p-6">
          <AdminTasksPanel />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
