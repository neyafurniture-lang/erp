'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import AdminSessionGate from '../../components/AdminSessionGate';
import AdminTasksPanel from '../../components/AdminTasksPanel';

export default function AdminPage() {
  return (
    <AuthGuard>
      <AppShell title="Session admin" subtitle="Tâches admin et accès protégé">
        <div className="rounded-2xl border border-neya-border bg-white shadow-sm p-4 sm:p-6">
          <AdminSessionGate>
            <AdminTasksPanel />
          </AdminSessionGate>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
