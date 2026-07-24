import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPhonesFromText,
  extractEmailsFromText,
  extractAddressBlock,
  extractContactName,
  extractContactHints,
  normalizePhone,
  filterHintsForClient,
  looksLikeForeignCompanyContact,
} from './client-contact-enrich.js';

describe('client-contact-enrich extractors', () => {
  it('normalise un téléphone québécois', () => {
    assert.equal(normalizePhone('514-555-1234'), '(514) 555-1234');
    assert.equal(normalizePhone('+1 (438) 555-9876'), '(438) 555-9876');
  });

  it('extrait téléphone et email d’une signature', () => {
    const text = `
Bonjour,

Voici mon adresse pour la livraison.

Marie Tremblay
12 rue Saint-Denis
Montréal, QC H2X 1Y4
marie.tremblay@example.com
514-555-1212
`;
    const phones = extractPhonesFromText(text);
    assert.ok(phones.some(p => p.includes('514')));
    const emails = extractEmailsFromText(text);
    assert.equal(emails[0], 'marie.tremblay@example.com');
    const { address, city } = extractAddressBlock(text);
    assert.ok(address && /Saint-Denis/i.test(address));
    assert.ok(city && /montr/i.test(city));
  });

  it('extrait un nom de contact depuis From', () => {
    assert.equal(
      extractContactName('Jean Dupont <jean@dupont.ca>', ''),
      'Jean Dupont'
    );
  });

  it('agrège les hints sans emails bruit', () => {
    const hints = extractContactHints({
      text: 'Livraison au 45 avenue Laurier, Québec G1R 2L3. Tél 418-555-0001',
      fromEmail: 'noreply@newsletter.com',
      fromRaw: 'Sophie Martin <sophie@martin.ca>',
      participantEmails: ['sophie@martin.ca', 'neyafurniture@gmail.com'],
      ownEmails: new Set(['neyafurniture@gmail.com']),
    });
    assert.equal(hints.email, 'sophie@martin.ca');
    assert.ok(hints.phone);
    assert.ok(hints.address);
  });
});

describe('filterHintsForClient anti faux client', () => {
  it('rejette Atlas Machinery pour le client Anne', () => {
    const filtered = filterHintsForClient(
      { name: 'Anne', email: null },
      {
        email: 'info@atlas-machinery.com',
        phone: '(514) 545-8107',
        contact: 'Anne',
        address: 'Atlas Tools & Machinery 111 Creditview Rd Vaughan',
        city: 'Ontario',
      },
      {
        text: 'Atlas Tools & Machinery 111 Creditview Rd',
        fromEmail: 'info@atlas-machinery.com',
        participantEmails: ['info@atlas-machinery.com'],
      }
    );
    assert.equal(filtered.address, null);
    assert.equal(filtered.email, null);
    assert.equal(filtered.phone, null);
  });

  it('accepte une adresse cohérente avec le client', () => {
    const filtered = filterHintsForClient(
      { name: 'Marie Tremblay', email: null },
      {
        email: 'marie@tremblay.ca',
        phone: '(514) 555-1212',
        contact: 'Marie Tremblay',
        address: '12 rue Saint-Denis',
        city: 'Montréal',
      },
      {
        text: 'Marie Tremblay\n12 rue Saint-Denis\nMontréal',
        fromEmail: 'marie@tremblay.ca',
        participantEmails: ['marie@tremblay.ca'],
      }
    );
    assert.equal(filtered.email, 'marie@tremblay.ca');
    assert.ok(filtered.address);
    assert.ok(filtered.city);
  });

  it('détecte un contact entreprise collé sur un prénom', () => {
    assert.equal(
      looksLikeForeignCompanyContact('Anne', {
        address: 'Atlas Tools & Machinery 111 Creditview Rd',
        email: 'info@atlas-machinery.com',
        contact: 'Anne',
      }),
      true
    );
  });
});
