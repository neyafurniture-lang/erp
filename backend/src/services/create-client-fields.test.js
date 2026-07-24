import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCreateFields } from './client-contact-enrich.js';

describe('buildClientCreateFields', () => {
  it('crée Olive Richardson depuis From même si le PDF est illisible', () => {
    const fields = buildClientCreateFields(
      {
        from: 'Olive Richardson <olive_richardson@yahoo.com>',
        name: 'Olive Richardson',
        email: 'olive_richardson@yahoo.com',
      },
      'Cherche l’iaem dans les mails trouve un pdf analyse le et cree un nouceau contact'
    );
    assert.equal(fields.name, 'Olive Richardson');
    assert.equal(fields.contact, 'Olive Richardson');
    assert.equal(fields.email, 'olive_richardson@yahoo.com');
  });

  it('parse le From seul sans params name/email', () => {
    const fields = buildClientCreateFields(
      { from: 'Olive Richardson <olive_richardson@yahoo.com>' },
      'crée un nouveau contact grâce aux informations'
    );
    assert.equal(fields.name, 'Olive Richardson');
    assert.equal(fields.email, 'olive_richardson@yahoo.com');
  });

  it('conserve téléphone / adresse / ville des params', () => {
    const fields = buildClientCreateFields({
      name: 'Marie Tremblay',
      email: 'marie@example.com',
      phone: '514-555-1212',
      address: '12 rue Saint-Denis',
      city: 'Montréal',
    }, '');
    assert.equal(fields.phone, '514-555-1212');
    assert.equal(fields.address, '12 rue Saint-Denis');
    assert.equal(fields.city, 'Montréal');
  });
});
