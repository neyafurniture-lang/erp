'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import CuttingStudio from '../../components/cutting/CuttingStudio';

export default function CuttingPlansPage() {
  return (
    <AuthGuard>
      <AppShell title="Plans de coupe" subtitle="Studio CutList — planches 8 pi & panneaux 4×8">
        <CuttingStudio />
      </AppShell>
    </AuthGuard>
  );
}
