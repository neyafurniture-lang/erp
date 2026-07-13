'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import ErpManualContent from '../../components/ErpManualContent';

export default function ManualPage() {
  return (
    <AuthGuard>
      <AppShell title="Manuel ERP">
        <ErpManualContent />
      </AppShell>
    </AuthGuard>
  );
}
