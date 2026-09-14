'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import GmailInbox from '../../components/GmailInbox';
import SupplierInvoiceQueue from '../../components/SupplierInvoiceQueue';

function MailPageInner() {
  const searchParams = useSearchParams();
  const initialMessageId = searchParams.get('message') || searchParams.get('m') || null;

  return (
    <>
      <SupplierInvoiceQueue compact />
      <GmailInbox initialMessageId={initialMessageId} />
    </>
  );
}

export default function MailPage() {
  return (
    <AuthGuard>
      <AppShell
        title="Courriel"
        subtitle="Gmail intégré · tri NEYA · contexte client"
        flush
        flushMobile
      >
        <div className="mail-page-flush neya-enter-fade">
          <Suspense fallback={
            <div className="mail-empty">
              <div className="mail-empty__orb" aria-hidden />
              <p className="mail-empty__title">Chargement de la boîte…</p>
              <p className="mail-empty__text">Synchronisation Gmail en cours.</p>
            </div>
          }>
            <MailPageInner />
          </Suspense>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
