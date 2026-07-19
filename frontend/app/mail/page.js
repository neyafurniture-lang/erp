'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import GmailInbox from '../../components/GmailInbox';
import SupplierInvoiceQueue from '../../components/SupplierInvoiceQueue';

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
          <div className="mail-supplier-strip hidden 2xl:block">
            <SupplierInvoiceQueue compact />
          </div>
          <GmailInbox />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
