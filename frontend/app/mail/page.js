'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import GmailInbox from '../../components/GmailInbox';
import SupplierInvoiceQueue from '../../components/SupplierInvoiceQueue';

export default function MailPage() {
  return (
    <AuthGuard>
      <AppShell title="Courriel" wide flushMobile>
        <div className="mail-page-flush">
          <div className="mail-supplier-mobile px-4 pt-3 sm:px-0 sm:pt-0 mb-3 sm:mb-5">
            <SupplierInvoiceQueue compact />
          </div>
          <GmailInbox />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
