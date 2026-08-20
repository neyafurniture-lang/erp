import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parseMarketContractText, parseMarketContractPdf } from './market-contract-parse.js';

const FIXTURE_ETRANGE = `Marché de l'Automne et de l'Étrange
Dates et heures : Samedi 24 et dimanche 25 octobre 2026, de 10 h à 17 h.
Emplacement : Auditorium de Verdun — 4110, boul. LaSalle, Verdun H4G 2A5
Installation : à partir de 8 h 30
Connectivité : Wi-Fi fonctionnel
Je m'engage à acquitter la facture totale de 218 $ + taxes
bazarverdunois@gmail.com
438-491-9079`;

const FIXTURE_NOEL = `Grand Marché de Noël de Verdun 2026
Dates : Samedi 28 & dimanche 29 novembre 2026, de 10 h à 17 h.
Montage (Samedi) Dès 8 h 00
Présence obligatoire Arrivée requise au plus tard à 9 h 30
Notez que la salle ne dispose pas de connexion Wi-Fi publique
Montant total acquitté 260 $ + taxes`;

describe('parseMarketContractText', () => {
  it('extrait dates et logistique Automne & Étrange', () => {
    const p = parseMarketContractText(FIXTURE_ETRANGE);
    assert.equal(p.start_date, '2026-10-24');
    assert.equal(p.end_date, '2026-10-25');
    assert.equal(p.fee_amount, 218);
    assert.equal(p.logistics.wifi, 'oui');
    assert.equal(p.setup_start, '8 h 30');
    assert.match(p.name, /Automne|Étrange/i);
    assert.ok(p.logistics.materials_checklist?.length >= 2);
  });

  it('extrait Noël Verdun sans Wi-Fi', () => {
    const p = parseMarketContractText(FIXTURE_NOEL);
    assert.equal(p.start_date, '2026-11-28');
    assert.equal(p.end_date, '2026-11-29');
    assert.equal(p.fee_amount, 260);
    assert.equal(p.logistics.wifi, 'non');
    assert.equal(p.presence_deadline, '9 h 30');
  });
});

describe('parseMarketContractPdf', () => {
  it('lit un PDF contrat uploadé', () => {
    const pdfPath = '/home/ubuntu/.cursor/projects/workspace/uploads/contrat_marche_noel_2026_c506.pdf';
    if (!fs.existsSync(pdfPath)) return;
    const p = parseMarketContractPdf(fs.readFileSync(pdfPath), { filename: path.basename(pdfPath) });
    assert.equal(p.start_date, '2026-11-28');
    assert.ok(p.fee_amount >= 200);
    assert.match(p.organizer || p.name, /Verdun|Bazar/i);
  });
});
