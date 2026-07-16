'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import GmailInbox from '../../components/GmailInbox';
import SupplierInvoiceQueue from '../../components/SupplierInvoiceQueue';

export default function MailPage() {
  return (
    <AuthGuard>
      <AppShell title="Courriel" wide>
        <div className="mb-2 sm:mb-3">
          <SupplierInvoiceQueue compact />
        </div>
        <GmailInbox />
      </AppShell>
    </AuthGuard>
  );
}
