import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDayPlanMessage,
  isMultiIntentErpMessage,
  isClearDayIntent,
  isDeleteTaskIntent,
  stripAssistantMeta,
  sanitizeAssistantReply,
  splitPlanItems,
} from './day-plan-classify.js';

const PROSE_BUG = `La semaine prochaine. Il faut avancer sur le projet (nom non clair.
Entendu 'iCloud' - à vérifier). Créer des tâches dans le calendrier pour mardi.
Mercredi. Jeudi concernant l'avancement des cadres.
Également créer un nouveau devis dans l'admin pour un autre projet.
Avec un nouveau client nommé James.`;

const DELETE_TOMORROW = 'Supprime toute les tache de demain et on refait ca ensmble';
const ENRICHED_DELETE = `${DELETE_TOMORROW}

[Suite de conversation — ne redemande pas ce qui est déjà ci-dessus]
Utilisateur: Demain finition banc olive, mail The NNS
Lia: Planning mardi — 2 étape(s) :
• 08 h 30 — Finition banc olive
• 09 h 30 — Mail The NNS`;

describe('isMultiIntentErpMessage', () => {
  it('détecte client + devis + calendrier multi-jours', () => {
    assert.equal(isMultiIntentErpMessage(PROSE_BUG), true);
  });

  it('ne déclenche pas sur une vraie liste atelier', () => {
    assert.equal(
      isMultiIntentErpMessage('Demain finition banc olive, mail pour The NNS, débitage table chêne'),
      false
    );
  });
});

describe('isClearDayIntent', () => {
  it('détecte suppression bulk demain (fautes OK)', () => {
    assert.equal(isClearDayIntent(DELETE_TOMORROW), true);
  });

  it('détecte même avec historique collé', () => {
    assert.equal(isClearDayIntent(ENRICHED_DELETE), true);
  });

  it('détecte vide le planning', () => {
    assert.equal(isClearDayIntent('Vide le planning de demain'), true);
  });

  it('ne confond pas avec une vraie liste atelier', () => {
    assert.equal(
      isClearDayIntent('Demain finition banc olive, mail pour The NNS'),
      false
    );
  });
});

describe('isDeleteTaskIntent', () => {
  it('accepte impératif sans accent', () => {
    assert.equal(isDeleteTaskIntent('Supprime la tache finition'), true);
  });

  it('laisse le clear-day au bulk', () => {
    assert.equal(isDeleteTaskIntent(DELETE_TOMORROW), false);
  });
});

describe('isDayPlanMessage', () => {
  it('refuse la prose dictée multi-intentions', () => {
    assert.equal(isDayPlanMessage(PROSE_BUG), false);
  });

  it('accepte une liste journée compacte', () => {
    assert.equal(
      isDayPlanMessage('Demain finition banc olive, mail pour The NNS, débitage table chêne'),
      true
    );
  });

  it('accepte « planifie ma journée demain … »', () => {
    assert.equal(
      isDayPlanMessage('Planifie ma journée demain : finition ETEL, assemblage cadres'),
      true
    );
  });

  it('refuse une suppression demain même enrichie d\'historique atelier', () => {
    assert.equal(isDayPlanMessage(ENRICHED_DELETE), false);
    assert.equal(isDayPlanMessage(DELETE_TOMORROW), false);
  });
});

describe('stripAssistantMeta / sanitizeAssistantReply', () => {
  it('coupe le bloc Suite de conversation', () => {
    assert.equal(stripAssistantMeta(ENRICHED_DELETE), DELETE_TOMORROW);
  });

  it('retire préfixe Lia: et fuites', () => {
    assert.equal(
      sanitizeAssistantReply('Lia: Je note Sauna Cloud.\n[Suite de conversation — x]\nUtilisateur: foo'),
      'Je note Sauna Cloud.'
    );
  });
});

describe('splitPlanItems', () => {
  it('ne découpe pas une prose sur chaque point', () => {
    const items = splitPlanItems(PROSE_BUG);
    assert.ok(!items.some(i => /^(mercredi|jeudi|la semaine prochaine)$/i.test(i)));
    assert.ok(items.length < 6, `trop de segments: ${items.join(' | ')}`);
  });

  it('découpe une liste virgule / puis', () => {
    const items = splitPlanItems('finition banc olive, mail The NNS puis débitage table');
    assert.equal(items.length, 3);
  });
});
