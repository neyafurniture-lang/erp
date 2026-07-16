'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import AdminSessionGate from '../../components/AdminSessionGate';
import AdminTasksPanel from '../../components/AdminTasksPanel';

export default function AdminPage() {
  return (
    <AuthGuard>
      <AppShell title="Session admin">
        <AdminSessionGate>
          <AdminTasksPanel />
        </AdminSessionGate>
      </AppShell>
    </AuthGuard>
  );
}
