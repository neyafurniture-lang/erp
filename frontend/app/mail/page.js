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
      <div className="mail-supplier-strip px-3 pt-3 lg:px-4">
        <SupplierInvoiceQueue compact />
      </div>
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
        <div className="mail-page-flush">
          <Suspense fallback={<p className="p-4 text-sm text-neya-muted">Chargement de la boîte…</p>}>
            <MailPageInner />
          </Suspense>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
