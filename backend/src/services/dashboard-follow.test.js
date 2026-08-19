import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  quoteDetailHref,
  invoiceDetailHref,
  formatQuoteFollowTitle,
  formatInvoiceFollowTitle,
  adminCategoryLabel,
  isMoneyFollowSourceKey,
  shouldShowAdminOnDashboard,
  addDaysIso,
  shiftCopyRange,
} from './dashboard-follow.js';

describe('dashboard-follow liens', () => {
  it('ouvre la fiche devis, pas la liste ?quote=', () => {
    assert.equal(quoteDetailHref(12), '/invoices/quotes/12');
    assert.equal(invoiceDetailHref(4), '/invoices/4');
  });

  it('titres avec nom client + numéro', () => {
    assert.equal(
      formatQuoteFollowTitle({ status: 'sent', quote_number: 'Q-2026-002', client_name: 'Café Nova' }),
      'Relancer Café Nova — Q-2026-002'
    );
    assert.equal(
      formatQuoteFollowTitle({ status: 'draft', quote_number: 'Q-2026-001', client_name: 'Café Nova' }),
      'Devis à finir — Café Nova (Q-2026-001)'
    );
    assert.equal(
      formatInvoiceFollowTitle({ status: 'sent', invoice_number: 'FAC-2026-001', client_name: 'ENNS' }),
      'À encaisser — ENNS (FAC-2026-001)'
    );
  });

  it('catégories lisibles + source devis hors to-do', () => {
    assert.equal(adminCategoryLabel('a_payer'), 'À payer');
    assert.equal(adminCategoryLabel('facturation'), 'Facture / devis');
    assert.equal(isMoneyFollowSourceKey('quote_sent_9'), true);
    assert.equal(isMoneyFollowSourceKey('invoice_draft_3'), true);
    assert.equal(isMoneyFollowSourceKey('prio_p1_olive'), false);
  });

  it('dashboard n’affiche pas les seeds perso ni les devis (panneau Argent)', () => {
    assert.equal(shouldShowAdminOnDashboard({ source_key: 'prio_p1_internet_cut', priority_tier: 'p1' }), false);
    assert.equal(shouldShowAdminOnDashboard({ source_key: 'quote_sent_2', category: 'facturation' }), false);
    assert.equal(shouldShowAdminOnDashboard({ source_key: 'ops_materiel_semaine' }), true);
    assert.equal(shouldShowAdminOnDashboard({ source_key: 'mail_payable_abc', category: 'a_payer' }), true);
    assert.equal(shouldShowAdminOnDashboard({ source_key: null, category: 'a_payer' }), true);
    assert.equal(shouldShowAdminOnDashboard({ source_key: 'web_setup', category: 'site_web', priority_tier: 'p3' }), false);
  });
});

describe('shift copy week', () => {
  it('copie lundi→lundi suivant', () => {
    const r = shiftCopyRange('2026-08-10');
    assert.equal(r.from, '2026-08-10');
    assert.equal(r.to, '2026-08-17');
    assert.equal(r.destFrom, '2026-08-17');
    assert.equal(r.destTo, '2026-08-24');
  });

  it('addDaysIso', () => {
    assert.equal(addDaysIso('2026-08-10', 7), '2026-08-17');
  });
});
