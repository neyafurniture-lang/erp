import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDayPlanMessage,
  isMultiIntentErpMessage,
  splitPlanItems,
} from './day-plan-classify.js';

const PROSE_BUG = `La semaine prochaine. Il faut avancer sur le projet (nom non clair.
Entendu 'iCloud' - à vérifier). Créer des tâches dans le calendrier pour mardi.
Mercredi. Jeudi concernant l'avancement des cadres.
Également créer un nouveau devis dans l'admin pour un autre projet.
Avec un nouveau client nommé James.`;

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
