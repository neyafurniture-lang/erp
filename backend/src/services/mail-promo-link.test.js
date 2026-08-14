import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMailMessage, isPromotion, mergeMailThreads } from './mail-sort.js';
import { detectSupplier } from './invoice-email-router.js';
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

  it('n’est pas promo pour un pied unsubscribe seul', () => {
    assert.equal(
      isPromotion(
        'Marie <marie@client.ca>',
        'Question sur le projet table',
        'Merci, Marie. If you no longer wish to receive these emails you can unsubscribe.'
      ),
      false
    );
  });

  it('n’est pas promo pour noreply@gmail (regex trop large avant)', () => {
    assert.equal(
      isPromotion('Atelier <noreply@gmail.com>', 'Plan de coupe prêt', 'Voici le fichier'),
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

  it('classe un fournisseur connu sans facture en fournisseurs (pas promo)', () => {
    const cat = classifyMailMessage({
      from: 'Home Depot <noreply@homedepot.ca>',
      subject: 'Nouveautés de la semaine',
      snippet: 'Découvrez nos outils',
      isUnread: true,
    });
    assert.equal(cat, 'fournisseurs');
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

  it('met un nouveau client non-lu en À répondre (pas Non classés)', () => {
    const cat = classifyMailMessage({
      from: 'Sophie Martin <sophie@martin.ca>',
      subject: 'Je voudrais un devis pour une table',
      snippet: 'Bonjour, on cherche une table en noyer.',
      isUnread: true,
    });
    assert.equal(cat, 'a_repondre');
  });

  it('ne met pas un mail Gmail Promotions en À répondre', () => {
    const cat = classifyMailMessage({
      from: 'Shop <hello@shop.example>',
      subject: 'This week',
      snippet: 'New arrivals',
      isUnread: true,
      labelIds: ['UNREAD', 'CATEGORY_PROMOTIONS'],
    });
    assert.equal(cat, 'promotions');
  });

  it('garde un mail marqué important hors promotions', () => {
    const cat = classifyMailMessage({
      from: 'Client <info@atelier.ca>',
      subject: 'Livraison gratuite ?',
      snippet: 'Est-ce que vous offrez la livraison gratuite',
      isUnread: true,
      labelIds: ['UNREAD', 'IMPORTANT'],
    });
    assert.equal(cat, 'a_repondre');
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

describe('mergeMailThreads', () => {
  it('déduplique par fil et garde le non-lu', () => {
    const merged = mergeMailThreads([
      [{ id: '1', threadId: 't1', isUnread: false, date: '2026-08-01' }],
      [{ id: '2', threadId: 't1', isUnread: true, date: '2026-07-01' }, { id: '3', threadId: 't2', date: '2026-08-10' }],
    ]);
    const t1 = merged.find(m => m.threadId === 't1');
    assert.equal(t1.id, '2');
    assert.equal(merged.length, 2);
  });
});

describe('detectSupplier', () => {
  it('ne confond pas corona avec rona', () => {
    assert.equal(detectSupplier('Corona <info@corona.ca>', 'Devis table', ''), null);
  });

  it('reconnaît Home Depot', () => {
    assert.equal(detectSupplier('Home Depot <orders@homedepot.ca>', 'Commande', '')?.id, 'home_depot');
  });
});
