'use client';

import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import GmailInbox from '../../components/GmailInbox';
import SupplierInvoiceQueue from '../../components/SupplierInvoiceQueue';

export default function MailPage() {
  return (
    <AuthGuard>
      <AppShell title="Courriel" wide flushMobile>
        <div className="mail-page-flush relative">
          <div
            className="pointer-events-none absolute inset-0 -z-10 hidden sm:block"
            aria-hidden
            style={{
              background:
                'radial-gradient(900px 420px at 8% -5%, rgba(216,107,48,0.10), transparent 55%), radial-gradient(700px 360px at 92% 0%, rgba(15,118,110,0.06), transparent 50%), #f7f5f2',
            }}
          />
          <div className="mail-supplier-mobile px-4 pt-3 sm:px-0 sm:pt-0 mb-3 sm:mb-5 relative z-[1]">
            <SupplierInvoiceQueue compact />
          </div>
          <div className="relative z-[1] sm:px-0">
            <GmailInbox />
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
