'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import CuttingStudio from '../../components/cutting/CuttingStudio';

export default function CuttingPlansPage() {
  return (
    <AuthGuard>
      <AppShell>
        <CuttingStudio />
      </AppShell>
    </AuthGuard>
  );
}
