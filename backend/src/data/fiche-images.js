/** Chemins publics des visuels fiches (frontend/public) */
const P = (p) => `/fiches/${p}`;

/** Fichier disque → chemin URL (hash docx → nom lisible) */
export const DOCX_IMAGE_FILES = {
  '2d52b7023a505a50a054021dee61f6e11df07485.png': 'ops/securite.png',
  '466bcb34be14f6341fd4bcaa2021c68208d8367d.png': 'ops/collage-cernes.png',
  'c937cc83be9e5967de7b8c68f1b0db796aec97e4.png': 'ops/collage-serres.png',
  '10d1296f78356701c8a94a54d07210c9da4c7a10.png': 'ops/timesaver.png',
  '74024896d67d9ecaef02909e537e5cf3883f0621.png': 'ops/domino-etroit.png',
  '1a1eff05c6d9fa117b3536629dc04fe11f74b40d.png': 'ops/domino-plus1.png',
  'f01a86ad89f01620d7b43faafbf773d6fe9b8dc5.png': 'ops/domino-plus2.png',
  '6a90d8db3388dedd00e08f761d977a6e5fa4fde8.png': 'ops/domino-placement.png',
  'cf35e2874a597dd5663049bfb53f4c6ef9135bc9.png': 'ops/domino-hauteur.png',
  '9e4c6d8e3598508941cc0fdd1bbf7c9afbbeda5d.png': 'ops/aretes-profiles.png',
  '5d582312aa63cc2a458705518a78061f6c3fcc3e.png': 'ops/aretes-tailles.png',
  '312de3a82d1d2a5fffa8d3b788959e7d1fd6773d.png': 'ops/aretes-toupie.png',
  '12b96219dc29ee4f48b96052f8e1b73a81f39515.png': 'ops/aretes-test-chute.png',
  '4b73e1b39bfced286b41eaf77f410f97c66d83c4.png': 'products/L3.png',
  'dfe592b4e38289d95c023a034fbc779b2da70b8b.png': 'ops/l3-l7-vague-etapes.png',
  '6adc5cd9bdcc1eb5fc69328c1b1adf96bea4ef20.png': 'products/L7.png',
  'a8ef54b465900a4e769f4a363676744e2d9bf6e3.png': 'ops/l7-suspension.png',
  '5c9517a90d076cf69a40df56e236fc57918e1606.png': 'products/MOA.png',
  'b4576fe1d734bb8b9d160f8417b48d4bc6cd4f8f.png': 'products/ONDULA.png',
  'e1e25be24323fb789c3bf950d6eb36e20867314b.png': 'products/SERA.png',
  '88af95736eece76e47005fe777e69060ff4978e2.png': 'products/HARE.png',
  '7da649cd8f8b57b2db8339b8e5acaf181a8e8b54.png': 'products/RIVAGE.png',
  'acb7fa96b6c30ec8e7122bd93548b34f7cece7fb.png': 'products/AZAD.png',
};

export const SKU_FILE = {
  L3: 'L3', L7: 'L7', 'MÕA': 'MOA', 'ÕNDULA': 'ONDULA',
  SERA: 'SERA', HARE: 'HARE', RIVAGE: 'RIVAGE', AZAD: 'AZAD',
};

export const OPS = {
  securite: P('ops/securite.png'),
  collageCernes: P('ops/collage-cernes.png'),
  collageSerres: P('ops/collage-serres.png'),
  timesaver: P('ops/timesaver.png'),
  dominoEtroit: P('ops/domino-etroit.png'),
  dominoPlus1: P('ops/domino-plus1.png'),
  dominoPlus2: P('ops/domino-plus2.png'),
  dominoPlacement: P('ops/domino-placement.png'),
  dominoHauteur: P('ops/domino-hauteur.png'),
  aretesProfiles: P('ops/aretes-profiles.png'),
  aretesTailles: P('ops/aretes-tailles.png'),
  aretesToupie: P('ops/aretes-toupie.png'),
  aretesTestChute: P('ops/aretes-test-chute.png'),
  vagueEtapes: P('ops/l3-l7-vague-etapes.png'),
  l7Suspension: P('ops/l7-suspension.png'),
};

export function productImage(sku) {
  const file = SKU_FILE[sku];
  return file ? P(`products/${file}.png`) : null;
}

export const DOMINO_IMAGES = [
  OPS.dominoEtroit, OPS.dominoPlus1, OPS.dominoPlus2,
  OPS.dominoPlacement, OPS.dominoHauteur,
];

export const ARETES_IMAGES = [
  OPS.aretesProfiles, OPS.aretesTailles, OPS.aretesToupie, OPS.aretesTestChute,
];
