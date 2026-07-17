'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import ErpManualContent from '../../components/ErpManualContent';

export default function ManualPage() {
  return (
    <AuthGuard>
      <AppShell title="Manuel ERP" subtitle="Guide d'utilisation de l'atelier numérique">
        <ErpManualContent />
      </AppShell>
    </AuthGuard>
  );
}
