import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMailMessage, isPromotion } from './mail-sort.js';
import { clientNameAppearsInText } from './email-threads.js';

describe('isPromotion', () => {
  it('détecte Lee Valley / livraison gratuite', () => {
    assert.equal(
      isPromotion(
        'Lee Valley <updates@email.leevalleynews.com>',
        'Dernière chance – Livraison gratuite',
        'Profitez de la livraison gratuite'
      ),
      true
    );
  });

  it('ignore GitHub', () => {
    assert.equal(
      isPromotion('GitHub <noreply@github.com>', 'You have a new notification', ''),
      false
    );
  });
});

describe('classifyMailMessage promotions', () => {
  it('met Lee Valley en promotions même si faux client_id faible', () => {
    const cat = classifyMailMessage({
      from: 'Lee Valley <updates@email.leevalleynews.com>',
      subject: 'Dernière chance – Livraison gratuite',
      snippet: 'Livraison gratuite sur votre commande',
      isUnread: true,
      thread: {
        client_id: 12,
        link_source: 'client_name',
        link_confidence: 0.75,
        needs_response: true,
      },
    });
    assert.equal(cat, 'promotions');
  });

  it('garde À répondre pour un vrai client email non-promo', () => {
    const emails = new Set(['client@example.com']);
    const cat = classifyMailMessage({
      from: 'Client <client@example.com>',
      subject: 'Question devis table',
      snippet: 'Pouvez-vous me rappeler ?',
      isUnread: true,
      clientEmails: emails,
      thread: { client_id: 1, link_source: 'client_email', link_confidence: 0.95 },
    });
    assert.equal(cat, 'a_repondre');
  });

  it('classe un fournisseur connu sans facture en promotions', () => {
    const cat = classifyMailMessage({
      from: 'Home Depot <noreply@homedepot.ca>',
      subject: 'Nouveautés de la semaine',
      snippet: 'Découvrez nos outils',
      isUnread: true,
    });
    assert.equal(cat, 'promotions');
  });

  it('classe une vraie facture fournisseur en fournisseurs', () => {
    const cat = classifyMailMessage({
      from: 'Home Depot <orders@homedepot.ca>',
      subject: 'Votre facture #12345',
      snippet: 'Voici votre facture Home Depot',
      isUnread: true,
    });
    assert.equal(cat, 'fournisseurs');
  });

  it('respecte un classement manuel verrouillé', () => {
    const cat = classifyMailMessage({
      from: 'Lee Valley <updates@email.leevalleynews.com>',
      subject: 'Promo',
      snippet: 'newsletter',
      thread: {
        mail_category: 'clients',
        mail_category_manual: true,
      },
    });
    assert.equal(cat, 'clients');
  });
});

describe('clientNameAppearsInText', () => {
  it('rejette le faux positif Son dans une phrase française', () => {
    assert.equal(clientNameAppearsInText('Son', 'Voici son projet pour demain'), false);
  });

  it('accepte un nom long avec limites de mot', () => {
    assert.equal(clientNameAppearsInText('Sephora', 'Devis Sephora booth'), true);
  });

  it('rejette une sous-chaîne collée', () => {
    assert.equal(clientNameAppearsInText('Neya', 'neyafurniture.ca'), false);
  });

  it('rejette un prénom court trop générique (Anne)', () => {
    assert.equal(clientNameAppearsInText('Anne', 'Devis pour Anne pharmacie'), false);
    assert.equal(clientNameAppearsInText('Anne', 'Atlas Tools meeting with Anne'), false);
  });

  it('accepte un nom composé', () => {
    assert.equal(clientNameAppearsInText('Corridor Culturel', 'Devis Corridor Culturel'), true);
  });

  it('match saunacloud ↔ Sauna Cloud', () => {
    assert.equal(clientNameAppearsInText('saunacloud', 'Devis Sauna Cloud — frames'), true);
    assert.equal(clientNameAppearsInText('Sauna Cloud', 'from:info@saunacloud.ca'), true);
    assert.equal(clientNameAppearsInText('saunacloud', 'Martijn Steinrucken <martijn@saunacloud.com>'), true);
    assert.equal(clientNameAppearsInText('saunacloud', 'Olive Richardson facture'), false);
  });

  it('ne match PAS le slug GitHub sauna-cloud', () => {
    assert.equal(
      clientNameAppearsInText('saunacloud', 'Re: [neyafurniture-lang/erp] fix(sauna-cloud): totaux'),
      false
    );
  });
});
