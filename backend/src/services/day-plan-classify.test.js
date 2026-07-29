import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDayPlanMessage,
  isMultiIntentErpMessage,
  splitPlanItems,
  wantsSmartTaskPlan,
  cleanTaskTitle,
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

describe('wantsSmartTaskPlan', () => {
  it('capture la prose multi-intent', () => {
    assert.equal(wantsSmartTaskPlan(PROSE_BUG), true);
  });

  it('capture « créer des tâches depuis ce texte »', () => {
    assert.equal(
      wantsSmartTaskPlan('Analyse ce texte et crée des tâches : appeler James, payer Olive, débitage mardi'),
      true
    );
  });

  it('ne capture pas une courte consigne simple', () => {
    assert.equal(wantsSmartTaskPlan('ajoute finition sur projet Olive'), false);
  });

  it('ne capture pas une vraie liste journée (reste plan_day)', () => {
    assert.equal(
      wantsSmartTaskPlan('Demain finition banc olive, mail pour The NNS, débitage table chêne'),
      false
    );
  });
});

describe('cleanTaskTitle', () => {
  it('retire le préfixe « crée une tâche »', () => {
    assert.equal(cleanTaskTitle('crée une tâche appeler James demain'), 'Appeler James demain');
  });

  it('coupe une phrase trop longue', () => {
    const long = `ajoute ${'x'.repeat(120)}`;
    assert.ok(cleanTaskTitle(long).length <= 90);
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
      isDayPlanMessage('planifie ma journée demain : finition olive puis débitage NNS'),
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
