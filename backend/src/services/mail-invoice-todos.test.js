import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyInvoiceKind,
  looksLikeInvoiceMail,
  matchCounterparty,
  buildInvoiceTaskTitle,
  guessPersonFromMessage,
  parseDisplayName,
} from './mail-invoice-classify.js';
import { mailMessageHref, resolveMailTaskHref } from './mail-deep-link.js';

describe('mail-invoice-classify', () => {
  it('détecte une facture reçue', () => {
    assert.equal(
      looksLikeInvoiceMail({
        subject: 'Facturation — Olive',
        snippet: 'Voici ma facture',
        from: 'Olive <olive@example.com>',
      }),
      true
    );
  });

  it('classe SENT en à recevoir', () => {
    assert.equal(
      classifyInvoiceKind({
        labelIds: ['SENT'],
        from: 'neyafurniture@gmail.com',
        to: 'client@example.com',
        ownEmails: new Set(['neyafurniture@gmail.com']),
      }),
      'a_recevoir'
    );
  });

  it('classe inbox externe en à payer', () => {
    assert.equal(
      classifyInvoiceKind({
        labelIds: ['INBOX'],
        from: 'Olive <olive@example.com>',
        to: 'neyafurniture@gmail.com',
        ownEmails: new Set(['neyafurniture@gmail.com']),
      }),
      'a_payer'
    );
  });

  it('matche Olive / Phoenix', () => {
    assert.equal(
      matchCounterparty({
        haystack: 'Olive <olive@x.com> Facturation',
        people: [{ name: 'Olive', email: 'olive@x.com', type: 'employee' }],
      }),
      'Olive'
    );
    assert.equal(
      matchCounterparty({ haystack: 'facture pheonix juillet', people: [] }),
      'Phoenix'
    );
  });

  it('titre À payer / À recevoir', () => {
    assert.equal(buildInvoiceTaskTitle('a_payer', 'Olive'), 'À payer — facture Olive');
    assert.equal(buildInvoiceTaskTitle('a_recevoir', 'Phoenix'), 'À recevoir — facture Phoenix');
  });

  it('devine la contrepartie sur un mail reçu', () => {
    const person = guessPersonFromMessage(
      {
        from: 'Olive Martin <olive@atelier.test>',
        to: 'neyafurniture@gmail.com',
        subject: 'Facture juillet',
        snippet: '',
      },
      'a_payer',
      [{ name: 'Olive', email: 'olive@atelier.test', type: 'employee' }]
    );
    assert.equal(person, 'Olive');
  });

  it('parse le nom affiché', () => {
    assert.equal(parseDisplayName('Olive <olive@x.com>'), 'Olive');
  });
});

describe('mail deep links', () => {
  it('construit /mail?message=…', () => {
    assert.equal(mailMessageHref('abc123'), '/mail?message=abc123');
    assert.equal(mailMessageHref(null), '/mail');
  });

  it('résout le lien depuis source_key même si link_href est /mail', () => {
    assert.equal(
      resolveMailTaskHref({ source_key: 'mail_payable_xyz789', link_href: '/mail' }),
      '/mail?message=xyz789'
    );
    assert.equal(
      resolveMailTaskHref({ source_key: 'mail_receivable_aaa', link_href: null }),
      '/mail?message=aaa'
    );
    assert.equal(
      resolveMailTaskHref({ source_key: 'invoice_receivable_1', link_href: '/invoices/1' }),
      '/invoices/1'
    );
  });
});
