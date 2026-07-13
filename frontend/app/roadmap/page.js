'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import ErpRoadmapContent from '../../components/ErpRoadmapContent';

export default function RoadmapPage() {
  return (
    <AuthGuard>
      <AppShell title="Roadmap ERP">
        <ErpRoadmapContent />
      </AppShell>
    </AuthGuard>
  );
}
