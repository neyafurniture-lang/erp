'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import DriveExplorer from '../../components/DriveExplorer';

export default function DrivePage() {
  return (
    <AuthGuard>
      <AppShell title="Drive" wide>
        <DriveExplorer />
      </AppShell>
    </AuthGuard>
  );
}
