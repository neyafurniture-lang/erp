import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMoneyAmount,
  mailDocKind,
  paymentStatusFromMail,
  mailMoneyLabel,
  isOurQuoteOrClientInvoice,
  isLikelyPromoMail,
} from './mail-money.js';
import { looksLikeSupplierInvoice } from './invoice-email-router.js';

describe('extractMoneyAmount', () => {
  it('lit un total canadien', () => {
    assert.equal(extractMoneyAmount('Total : 45,67 $'), 45.67);
    assert.equal(extractMoneyAmount('Amount due $128.00'), 128);
  });
});

describe('mailDocKind / paymentStatus', () => {
  it('classe un ticket dealer comme ticket payé', () => {
    const msg = {
      subject: 'Votre ticket — Bois du Nord',
      snippet: 'Merci, total 87,50 $',
    };
    assert.equal(mailDocKind(msg), 'ticket');
    assert.equal(paymentStatusFromMail(msg), 'paid');
    assert.match(mailMoneyLabel(msg), /Ticket/);
  });

  it('classe une facture fournisseur comme à payer', () => {
    const msg = {
      subject: 'Facture 4491',
      snippet: 'Montant dû 210.00 $ payable sous 30 jours',
    };
    assert.equal(mailDocKind(msg), 'facture');
    assert.equal(paymentStatusFromMail(msg), 'unpaid');
    assert.equal(mailMoneyLabel(msg), 'Facture à payer');
  });

  it('classe un reçu Home Depot comme payé', () => {
    const msg = {
      subject: 'Your Home Depot receipt',
      snippet: 'Thanks for your purchase. Total $32.18',
    };
    assert.equal(mailDocKind(msg), 'recu');
    assert.equal(paymentStatusFromMail(msg), 'paid');
  });
});

describe('looksLikeSupplierInvoice', () => {
  it('accepte un ticket dealer même sans enseigne connue', () => {
    assert.equal(
      looksLikeSupplierInvoice(
        'Quincaillerie Tremblay <ventes@tremblay-bois.ca>',
        'Votre ticket de caisse',
        'Ticket #9921 total 54,20 $'
      ),
      true
    );
  });

  it('accepte un reçu Home Depot', () => {
    assert.equal(
      looksLikeSupplierInvoice(
        'Home Depot <orders@homedepot.ca>',
        'Your Home Depot receipt',
        'Order confirmation #123'
      ),
      true
    );
  });

  it('accepte une PJ ticket sans le mot facture', () => {
    assert.equal(
      looksLikeSupplierInvoice(
        'Dealer <info@bois-xyz.ca>',
        'Votre commande',
        'Voir la pièce jointe',
        { attachments: [{ filename: 'ticket-caisse.pdf' }] }
      ),
      true
    );
  });

  it('refuse un devis NEYA / facture client interne', () => {
    assert.equal(isOurQuoteOrClientInvoice('Devis Q-2026-002 Café Nova', ''), true);
    assert.equal(
      looksLikeSupplierInvoice(
        'NEYA Furniture <neyafurniture@gmail.com>',
        'Devis Q-2026-002 Café Nova',
        'Voici votre devis'
      ),
      false
    );
  });

  it('refuse une newsletter Amazon sans reçu', () => {
    assert.equal(
      isLikelyPromoMail(
        'Amazon <store-news@amazon.ca>',
        'Jusqu’à 40% off aujourd’hui — unsubscribe',
        'Soldes flash, code promo SUMMER'
      ),
      true
    );
    assert.equal(
      looksLikeSupplierInvoice(
        'Amazon <store-news@amazon.ca>',
        'Jusqu’à 40% off aujourd’hui — unsubscribe',
        'Soldes flash, your order is waiting, code promo SUMMER'
      ),
      false
    );
  });
});
