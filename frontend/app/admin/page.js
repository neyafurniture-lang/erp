'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import AdminTasksPanel from '../../components/AdminTasksPanel';

export default function AdminPage() {
  return (
    <AuthGuard>
      <AppShell title="Gestion admin" wide>
        <AdminTasksPanel />
      </AppShell>
    </AuthGuard>
  );
}
