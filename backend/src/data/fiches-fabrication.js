/** Données catalogue — Fiches fabrication Neya v1.1 */
import { OPS, productImage, DOMINO_IMAGES } from './fiche-images.js';

export const SOURCE = 'Neya_Fiches_Fabrication v1.1 — Mai 2026';

export const SANDING_GRAINS = ['80', '120', '150', '180', '220', '320', '0000'];
export const EDGE_PROFILES = [
  'Arête vive', 'Chanfrein', '1/4 de rond', 'Double chanfrein', '(aucun usinage)',
];
export const FINISH_TYPES = [
  'Huile Osmo LED Smart Oil (UV)',
  'Huile / cire alimentaire',
  'Vernis à l\'eau (sans COV)',
];

function step(phase, description, instructions, minutes = 60, tools = [], num = null, image = null) {
  const s = { phase, description, instructions, estimated_minutes: minutes, tools };
  if (num != null) s.num = num;
  if (image) s.image = image;
  return s;
}

function sandingSteps(finishType, usage, coats = '2') {
  return [
    step('finition', 'Cardon des arêtes — profil Neya', 'Cocher le profil : arête vive, chanfrein, 1/4 rond, double chanfrein (1/8", 1/4", 3/8"). Test sur chute obligatoire.', 30, ['toupie'], null, OPS.aretesProfiles),
    step('finition', 'Sablage', 'Time Saver : ☐ OUI  ☐ NON. Grains : 80 → 120 → 180 → 220. Règle : « si ça passe pas au Time Saver, on fait 80 puis 0 ». 0000 entre couches d\'huile seulement.', 75, ['Time Saver'], null, OPS.timesaver),
    step('finition', 'Finition', `Type : ${finishType}. ${coats} couche(s). Usage : ${usage}. Vérifier lumière rasante. Étiquette Neya.`, 90, ['Osmo', 'vernis'], null),
  ];
}

function dominoBlock() {
  return {
    title: 'Assemblage Domino — DF 700',
    checklist: ['ÉTROIT (0 clic)', '+1 CLIC', '+2 CLICS'],
    fields: ['Fraise (Ø)', 'Profondeur', 'Hauteur appui', 'Nb dominos / jonction'],
    note: 'Extrémités en ÉTROIT. Intermédiaires +1 ou +2 clics. Espacer 6–8".',
    images: DOMINO_IMAGES,
  };
}

export const WORKSHOP_GUIDES = {
  name: 'Guides atelier — Fiches fabrication',
  product_type: 'guide',
  meta: { sku: 'GUIDE', source: SOURCE, version: '1.1', images: [OPS.securite, OPS.collageCernes, OPS.timesaver, ...DOMINO_IMAGES.slice(0, 1)] },
  steps: [
    step('admin', 'Sécurité — règles non négociables', 'Dégauchisseuse + banc de scie : Mehdi seul. Lunettes + auditive. P100 sablage/finition. Poussoir < 6". Aspirateur partout sauf ruban capot ouvert.', 5, [], null, OPS.securite),
    step('admin', 'Machines assistant vs Mehdi', 'Assistant : ruban, toupie, Domino DF 700, perceuse, sableuses, défonceuse. Mehdi : dégauchisseuse, banc scie, CNC.', 5),
    step('assemblage', 'Guide collage', 'Alterner cernes. 1 serre / 3". Titebond III : 45 min serrage, 1h manipulation, 24h usinage.', 10, ['Titebond III'], null, OPS.collageCernes),
    step('finition', 'Guide sablage', '80→120→180→220. Sens du fil (180+). Marquer au crayon entre grains.', 10, ['Time Saver'], null, OPS.timesaver),
    step('assemblage', 'Domino DF 700', 'Fraises 8–14 mm. Extrémités ÉTROIT, intermédiaires +1/+2. Profondeur = moitié domino.', 15, ['Domino DF 700'], null, OPS.dominoEtroit),
    step('finition', 'Profils arêtes Neya', '4 profils × tailles 1/8", 1/4", 3/8". Toupie ou râpe + 180.', 10, [], null, OPS.aretesProfiles),
    step('finition', 'Produits finition', 'Osmo LED UV. Saman planches découper. Vernis eau RIVAGE/AZAD/MÕA.', 10),
  ],
};

export const PRODUCTS = [
  {
    sku: 'L3',
    name: 'Planche à découper',
    meta: {
      sku: 'L3', price: '79,00 $ CAD', wood: 'Noyer (sombre) + Érable (blanc) — 1 pour 1',
      dimensions: '4,5" × 15" — épaisseur 4/4" (≈19 mm)', finish: 'Huile / cire alimentaire — 2 couches',
      lead_time: 'Stock atelier', source: SOURCE,
      image: productImage('L3'),
      finish_usage: 'contact alimentaire', finish_coats: '2',
      debitage_note: null,
      debitage: [
        { piece: 'Lattes noyer', wood: 'Noyer', qty: '3–4', dimensions: '4/4" × ≈1" × 15"', notes: 'Sens du fil régulier' },
        { piece: 'Lattes érable', wood: 'Érable', qty: '3–4', dimensions: '4/4" × ≈1" × 15"', notes: 'Alterner avec le noyer' },
      ],
    },
    steps: [
      step('assemblage', 'Collage du bloc rayé (1 pour 1)', 'Alterner noyer/érable. Coller à plat, serres alternées. 45 min, gratter colle. Time Saver après 24h.', 90, ['colle'], 1, OPS.collageSerres),
      step('usinage', 'Tracé de la vague — gabarit plexi', 'Bloc à l\'envers, ruban double face (4–6). Courbe S. Scie ruban 3/8".', 60, ['gabarit plexi'], 2, OPS.vagueEtapes),
      step('assemblage', 'Recomposition Noyer ext. / Érable centre', 'Séparer, réassembler motif signature. Recoller 45 min. Recouper 4,5" × 15".', 75, [], 3, OPS.vagueEtapes),
      ...sandingSteps('Huile / cire alimentaire', 'contact alimentaire', '2'),
    ],
  },
  {
    sku: 'L7',
    name: 'Planche à découper suspendue',
    meta: {
      sku: 'L7', price: '89,00 $ CAD', wood: 'Noyer + Érable — 1 pour 1',
      dimensions: '24" × 24" (losange) — 4/4"', finish: 'Huile / cire alimentaire — 2 couches',
      lead_time: 'Stock atelier', source: SOURCE, related: 'L3',
      image: productImage('L7'),
      finish_usage: 'contact alimentaire — suspendue', finish_coats: '2',
      debitage_note: 'Même principe que la L3 — format plus grand.',
      debitage: [
        { piece: 'Lattes noyer', wood: 'Noyer', qty: 'À calculer', dimensions: '4/4" × ≈1" × 24"', notes: '' },
        { piece: 'Lattes érable', wood: 'Érable', qty: 'À calculer', dimensions: '4/4" × ≈1" × 24"', notes: '' },
      ],
    },
    steps: [
      step('assemblage', 'Collage, vague, recomposition', 'Bloc 1:1, 4–6 serres, 45 min. Gabarit plexi, ruban 3/8". Noyer ext., érable centre. Recouper 24"×24" losange.', 120, [], 1, OPS.vagueEtapes),
      step('usinage', 'Trou de suspension (signature L7)', 'Percer selon gabarit. Vérifier équilibre.', 30, ['perceuse'], 2, OPS.l7Suspension),
      ...sandingSteps('Huile / cire alimentaire', 'contact alimentaire — suspendue', '2'),
    ],
  },
  {
    sku: 'MÕA',
    name: 'Tabouret ondulé',
    meta: {
      sku: 'MÕA', price: '380 $ (frêne) — 420 $ (noyer)', wood: 'Frêne massif OU noyer massif',
      dimensions: '9,75" × 15,5" × 18,75" (h) — ≈4,2 kg', finish: 'Vernis à l\'eau sans COV',
      lead_time: '1-2 semaines', source: SOURCE,
      image: productImage('MÕA'),
      finish_usage: 'assise quotidienne', finish_coats: '2-3',
      debitage_note: 'Tabouret 3 pieds + dessus ondulé. Vague signature sur un pied.',
      debitage: [
        { piece: 'Dessus ondulé', wood: 'Frêne ou noyer', qty: '1', dimensions: 'Collage lattes — voir plan', notes: 'Découpe scie ruban ou CNC' },
        { piece: 'Pieds', wood: 'Frêne ou noyer', qty: '3', dimensions: 'Cylindriques — voir plan', notes: 'Tournés ou CNC' },
        { piece: 'Pied signature', wood: 'Noyer (si dessus frêne)', qty: '1', dimensions: 'Voir plan', notes: 'Inséré avec vague' },
      ],
      domino: dominoBlock(),
    },
    steps: [
      step('usinage', 'Usinage dessus ondulé', 'Collage lattes puis CNC OU scie ruban + gabarit. Pieds : tour ou CNC.', 180, ['CNC'], 1),
      step('assemblage', 'Domino DF 700 — pieds/dessus', 'Documenter fraise, profondeur, hauteur appui, nb dominos.', 120, ['Domino DF 700'], 2, OPS.dominoPlacement),
      step('assemblage', 'Assemblage final', '3 pieds + dessus. Aplomb. 4 serres min.', 60, [], 3),
      ...sandingSteps('Vernis à l\'eau (sans COV)', 'assise quotidienne', '2-3'),
    ],
  },
  {
    sku: 'ÕNDULA',
    name: 'Étagère courbée',
    meta: {
      sku: 'ÕNDULA', price: '369 $ — 399 $', wood: 'À compléter', dimensions: 'À compléter',
      finish: 'Vernis à l\'eau sans COV', lead_time: '1-2 semaines', source: SOURCE,
      image: productImage('ÕNDULA'),
      finish_usage: 'étagère murale', finish_coats: '2-3',
      debitage: [
        { piece: 'Pièce principale', wood: 'À compléter', qty: '—', dimensions: 'À compléter', notes: '' },
      ],
      domino: dominoBlock(),
    },
    steps: [
      step('usinage', 'Formage courbe', 'Lamellé-collé / ruban+gabarit / CNC. Noter rayon.', 180, ['CNC'], 1),
      step('assemblage', 'Domino DF 700', 'Paramètres par jonction.', 90, ['Domino DF 700'], 2, OPS.dominoPlacement),
      step('assemblage', 'Fixation murale', 'Pattes Z ou chevilles affleurantes.', 45, [], 3),
      ...sandingSteps('Vernis à l\'eau (sans COV)', 'étagère murale', '2-3'),
    ],
  },
  {
    sku: 'SERA',
    name: 'Miroir sculptural',
    meta: {
      sku: 'SERA', price: '259 $ — 289 $', wood: 'À compléter', dimensions: 'À compléter',
      finish: 'Huile naturelle / Osmo', lead_time: '1-2 semaines', source: SOURCE,
      image: productImage('SERA'),
      finish_usage: 'miroir mural', finish_coats: '2',
      debitage: [{ piece: 'Cadre sculptural', wood: 'À compléter', qty: '—', dimensions: 'À compléter', notes: '' }],
    },
    steps: [
      step('usinage', 'Usinage cadre — profil intérieur', 'CNC / ruban / défonceuse. Feuillure miroir.', 150, ['CNC'], 1),
      step('assemblage', 'Pose du miroir', 'Pinces, adhésif ou pattes. Accrochage mural.', 60, [], 2),
      ...sandingSteps('Huile Osmo LED Smart Oil', 'miroir mural', '2'),
    ],
  },
  {
    sku: 'HARE',
    name: 'Table basse en noyer',
    meta: {
      sku: 'HARE', price: '1 049 $', wood: 'Noyer massif', dimensions: 'À compléter',
      finish: 'Huile Osmo LED Smart Oil', lead_time: '2-3 semaines', source: SOURCE,
      image: productImage('HARE'),
      finish_usage: 'table basse — intérieur', finish_coats: '2',
      debitage: [
        { piece: 'Plateau organique', wood: 'Noyer', qty: '1 (collage lattes)', dimensions: 'Forme libre — voir plan', notes: '' },
        { piece: 'Pieds', wood: 'Noyer', qty: '3 ou 4', dimensions: 'Voir plan', notes: '' },
        { piece: 'Traverse / structure', wood: 'Noyer', qty: '—', dimensions: 'Voir plan', notes: '' },
      ],
      domino: dominoBlock(),
    },
    steps: [
      step('assemblage', 'Collage plateau organique', 'Cernes alternées (⌒ ⌣). 1 serre/3" largeur. 45 min, 24h avant rabotage.', 120, [], 1, OPS.collageCernes),
      step('usinage', 'Formage plateau', 'Gabarit. Ruban + flush trim défonceuse.', 120, [], 2),
      step('assemblage', 'Domino + piètement', 'Extrémités ÉTROIT. Aplomb, 4 serres.', 120, ['Domino DF 700'], 3, OPS.dominoPlacement),
      ...sandingSteps('Huile Osmo LED Smart Oil (UV)', 'table basse', '2'),
    ],
  },
  {
    sku: 'RIVAGE',
    name: 'Table à manger',
    meta: {
      sku: 'RIVAGE', price: '1 459 $ — 1 749 $ (3 longueurs)', wood: 'À compléter',
      dimensions: '60" / 72" / 84"', finish: 'Vernis à l\'eau sans COV',
      lead_time: '3-5 semaines', source: SOURCE,
      image: productImage('RIVAGE'),
      finish_usage: 'table à manger', finish_coats: '2-3',
      debitage: [
        { piece: 'Plateau (lattes)', wood: '________', qty: 'À calculer', dimensions: 'Largeur indiv. 4–6"', notes: '' },
        { piece: 'Pieds', wood: '________', qty: '4', dimensions: 'Voir plan', notes: '' },
        { piece: 'Traverses longues', wood: '________', qty: '2', dimensions: 'Voir plan', notes: '' },
        { piece: 'Traverses courtes', wood: '________', qty: '2', dimensions: 'Voir plan', notes: '' },
      ],
      domino: dominoBlock(),
    },
    steps: [
      step('assemblage', 'Collage plateau grand format', 'Serres 1/3" + sergents transversaux. 45 min, 24h. Time Saver si passe.', 180, [], 1),
      step('assemblage', 'Domino DF 700 — plateau', 'Croquis positions dominos.', 150, ['Domino DF 700'], 2, OPS.dominoPlacement),
      step('assemblage', 'Assemblage piètement', 'Diagonales max 1 mm. Vis cale-plateau / Domino / boulons.', 120, [], 3),
      ...sandingSteps('Vernis à l\'eau (sans COV)', 'table à manger', '2-3'),
    ],
  },
  {
    sku: 'AZAD',
    name: 'Bureau assis-debout',
    meta: {
      sku: 'AZAD', price: '1 129 $ — 1 349 $ (4 options)', wood: 'À compléter',
      dimensions: 'À compléter', finish: 'Vernis à l\'eau sans COV',
      lead_time: '3-5 semaines', source: SOURCE,
      image: productImage('AZAD'),
      finish_usage: 'bureau — usage intensif', finish_coats: '2-3',
      debitage: [
        { piece: 'Plateau (lattes)', wood: '________', qty: 'À calculer', dimensions: 'Voir plan', notes: '' },
        { piece: 'Châssis assis-debout', wood: 'Acier (fourni)', qty: '1 kit', dimensions: 'Mécanisme motorisé', notes: '' },
        { piece: 'Chants / encadrement', wood: '________', qty: '—', dimensions: 'Voir plan', notes: '' },
      ],
      domino: dominoBlock(),
    },
    steps: [
      step('assemblage', 'Pré-perçage mécanisme', 'Gabarit fabricant AVANT collage. Modèle, course, fixations.', 60, [], 1),
      step('assemblage', 'Collage plateau', 'Cernes alternées, sergents. Time Saver + sablage.', 150, [], 2, OPS.collageSerres),
      step('assemblage', 'Domino + montage châssis', 'Mécanisme selon gabarit.', 120, ['Domino DF 700'], 3, OPS.dominoPlacement),
      ...sandingSteps('Vernis à l\'eau (sans COV)', 'bureau assis-debout', '2-3'),
    ],
  },
];
