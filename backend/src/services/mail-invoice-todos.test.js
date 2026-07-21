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

const OWN = new Set(['neyafurniture@gmail.com']);

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
        ownEmails: OWN,
      }),
      'a_recevoir'
    );
  });

  it('classe employé Olive en à payer', () => {
    assert.equal(
      classifyInvoiceKind({
        labelIds: ['INBOX'],
        from: 'Olive <olive@example.com>',
        to: 'neyafurniture@gmail.com',
        subject: 'Facture juillet',
        ownEmails: OWN,
        people: [{ name: 'Olive', email: 'olive@example.com', type: 'employee' }],
      }),
      'a_payer'
    );
  });

  it('ne classe PAS une facture client (Delfine) en à payer', () => {
    assert.equal(
      classifyInvoiceKind({
        labelIds: ['INBOX'],
        from: 'Delfine <delfine@client.test>',
        to: 'neyafurniture@gmail.com',
        subject: 'DELFINE INVOICE',
        snippet: 'Please find attached invoice',
        ownEmails: OWN,
        people: [{ name: 'Delfine', email: 'delfine@client.test', type: 'client' }],
      }),
      null
    );
  });

  it('classe Home Depot en à payer', () => {
    assert.equal(
      classifyInvoiceKind({
        labelIds: ['INBOX'],
        from: 'Home Depot <orders@homedepot.ca>',
        to: 'neyafurniture@gmail.com',
        subject: 'Your Home Depot receipt',
        snippet: 'Order confirmation',
        ownEmails: OWN,
        people: [],
      }),
      'a_payer'
    );
  });

  it('ignore un mail invoice ambigu sans fournisseur ni employé', () => {
    assert.equal(
      classifyInvoiceKind({
        labelIds: ['INBOX'],
        from: 'inconnu@example.com',
        to: 'neyafurniture@gmail.com',
        subject: 'Invoice #12',
        ownEmails: OWN,
        people: [],
      }),
      null
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
