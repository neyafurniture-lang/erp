import {
  generatePublicToken,
  sanitizeShopUrl,
  toPublicShopPayload,
  normalizeUrgency,
} from './client-shop-lists-security.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(generatePublicToken().length >= 40, 'token trop court');
assert(generatePublicToken() !== generatePublicToken(), 'tokens doivent différer');

assert(sanitizeShopUrl('https://example.com/a') === 'https://example.com/a', 'https ok');
assert(sanitizeShopUrl(null) === null, 'null ok');
try {
  sanitizeShopUrl('javascript:alert(1)');
  throw new Error('javascript aurait dû échouer');
} catch (e) {
  assert(/http|autorisé|invalide/.test(e.message), 'rejette javascript');
}
try {
  sanitizeShopUrl('https://user:pass@evil.com/');
  throw new Error('creds auraient dû échouer');
} catch (e) {
  assert(/identifiants/.test(e.message), 'rejette userinfo');
}

assert(normalizeUrgency('CRITICAL') === 'critical', 'urgency');
assert(normalizeUrgency('x') === 'normal', 'urgency fallback');

const pub = toPublicShopPayload(
  {
    title: 'Atelier',
    subtitle: 'Sub',
    show_client_name: true,
    client_name: 'Saunacloud',
    updated_at: '2026-01-01',
    client_id: 99,
    public_token: 'secret',
  },
  [{ id: 1, title: 'Scie', price: '12.5', currency: 'CAD', url: 'https://x.test', urgency: 'high', notes_public: 'note', status: 'todo', internal: 'leak' }]
);
assert(pub.client_name === 'Saunacloud', 'client name');
assert(pub.items[0].price === 12.5, 'price number');
assert(!('client_id' in pub), 'pas de client_id public');
assert(!('public_token' in pub), 'pas de token dans payload');
assert(!('internal' in pub.items[0]), 'pas de champ interne');

const hidden = toPublicShopPayload(
  { title: 'T', show_client_name: false, client_name: 'Secret', updated_at: null },
  []
);
assert(hidden.client_name === null, 'masquer nom client');

console.log('client-shop-lists.test.js OK');
