'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import MyHoursBoard from '../../components/MyHoursBoard';

export default function MesHeuresPage() {
  return (
    <AuthGuard>
      <AppShell
        title="Mes heures"
        subtitle="Inscrire les shifts effectués et le temps atelier"
      >
        <div className="neya-enter">
          <MyHoursBoard />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
