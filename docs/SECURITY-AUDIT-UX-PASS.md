# Audit sécurité — pass UX (`cursor/ux-pro-motion-6499`)

Date : 2026-09-14. Scope : auth JWT, permissions, SQLi, XSS, uploads, secrets, CORS/rate-limit, Finance PIN, Google OAuth/Drive, `/api/public`.

## Correctifs appliqués (ce pass)

| Zone | Correctif |
|------|-----------|
| Finance PIN | Unlock émet un JWT `finance_unlock` (4 h) ; `monthly-pnl`, `profitability`, `finance-sync` exigent `X-Finance-Token` + permissions finance/invoices/expenses. Fallback client `31250` **supprimé**. |
| Settings | `PUT /settings` → `requirePermission('settings')` ; `seed-skills` → `requireAdmin` ; `api-routes` → settings. |
| Drive / Gmail | `router.use(requirePermission('drive'|'mail'))`. |
| Google OAuth | `authorize` / `disconnect` → `requireAdmin` (évite prise de contrôle du compte Google partagé). |
| JWT | `algorithms: ['HS256']` sur verify uploads, SketchUp embed, OAuth state Google. |

Fichiers clés : `backend/src/routes/analytics.js`, `middleware/finance-unlock.js`, `routes/settings.js`, `routes/google-drive.js`, `routes/google-gmail.js`, `routes/integrations.js`, `routes/finance-sync.js`, `frontend/lib/finance-session.js`, `frontend/components/FinanceSessionGate.js`, `frontend/lib/api.js`.

---

## Top findings (sévérité)

### 1. Critique → **patché** — P&L sans verrou serveur
- **Avant** : `POST /analytics/unlock` renvoyait `{ok:true}` sans jeton ; `GET /analytics/monthly-pnl` accessible à tout JWT. Fallback UI acceptait le PIN hardcodé `31250` même si le PIN custom côté API différait.
- **Fichiers (avant)** : `routes/analytics.js`, `frontend/components/FinanceSessionGate.js`, `frontend/lib/finance-session.js`.

### 2. Critique → **patché** — écriture Settings / secrets sans permission
- Tout utilisateur authentifié pouvait `PUT /api/settings` (clés API, PIN Finance, OAuth secrets).
- **Fichier** : `backend/src/routes/settings.js:16` (désormais `requirePermission('settings')`).

### 3. Critique → **patché** — Drive & Gmail sans permission API
- Routes sous JWT seul : un compte atelier sans `drive`/`mail` pouvait lister/télécharger/envoyer via le token Google partagé.
- **Fichiers** : `google-drive.js:20`, `google-gmail.js:14`.

### 4. Critique → **patché** — OAuth Google connect/disconnect non admin
- N’importe quel JWT pouvait démarrer OAuth ou `POST /integrations/google/disconnect` et remplacer/supprimer le token entreprise.
- **Fichier** : `backend/src/routes/integrations.js` (`authorize` / `disconnect`).

### 5. Élevé — PIN Finance / bootstrap encore `31250` par défaut
- **Sévérité** : élevée (connaissance publique dans le repo / UI).
- **Lignes** :
  - `backend/src/routes/analytics.js:34` (fallback resolve PIN)
  - `backend/src/services/settings.js:46` (`DEFAULTS.project_admin_pin`)
  - `backend/src/services/settings.js:123` (`project_admin_pin_configured` toujours vrai à cause de `|| '31250'`)
  - `frontend/app/login/page.js:41` (préremplissage setup)
  - `backend/src/db/init.js` (seed Mehdi / admin faibles en non-prod)
- **Reco** : forcer un PIN fort en production (fail-closed si défaut), retirer le défaut des DEFAULTS, corriger le booléen `configured`.

### 6. Élevé — permissions métier surtout côté UI
- **Sévérité** : élevée.
- La plupart des routes (`clients`, `invoices`, `expenses`, `projects`, etc.) n’ont **pas** `requirePermission` ; seul le JWT suffit. Le frontend filtre via `canAccessPath`.
- **Ex.** : `backend/src/index.js` monte `protectedRouter` avec `authMiddleware` seulement ; `payroll.js:28-44` est une exception positive.
- **Reco** : appliquer `requirePermission` / `requireAnyPermission` route par route (au minimum finance, paie, users, deploy, assistant destructif).

### 7. Moyen — Drive ACL vide = Drive entier
- **Sévérité** : moyenne (après patch permission `drive`).
- `backend/src/services/drive-access.js:39` : si `drive_access` est vide et non-admin → `restricted: false` (accès global au Drive connecté).
- **Reco** : mode « deny by default » pour non-admin (liste vide = aucun dossier), ou flag explicite `drive_full: true`.

### 8. Moyen — mot de passe login en `localStorage` (base64)
- **Sévérité** : moyenne.
- `frontend/lib/api.js:89-97` (`saveLoginCredentials`) — « Se souvenir » stocke le mot de passe (encodage trivial, pas un chiffrement).
- **Reco** : ne stocker que l’email ; ou session cookie httpOnly + refresh.

### 9. Moyen — JWT session dans `?access_token=` pour `/uploads`
- **Sévérité** : moyenne.
- `frontend/lib/api.js:125`, `backend/src/middleware/security.js:39-55` — le token fuit dans Referer, logs proxy, historique.
- **Reco** : blob URLs / cookies httpOnly SameSite ; TTL court pour tokens fichier.

### 10. Moyen — Meta / Pinterest OAuth `state` non signé
- **Sévérité** : moyenne.
- `backend/src/routes/integrations.js:88-92` : `state` = JSON base64url sans HMAC (CSRF OAuth possible si un admin clique un lien forgé).
- Google state est correctement signé JWT (`google-oauth.js` + `algorithms: ['HS256']`).
- **Reco** : même schéma JWT que Google pour Meta/Pinterest.

---

## Autres observations (basse / informatif)

| Sujet | Détail | Fichier:ligne |
|-------|--------|----------------|
| XSS mails | HTML dans iframe `sandbox` sans `allow-scripts` + `sanitizeEmailHtml` — résiduel bas. | `GmailInbox.js:155-230` |
| SQLi | Requêtes majoritairement paramétrées (`$1`) ; filtres status en allowlist (`production.js`). Pas d’injection claire trouvée. | — |
| Path traversal uploads | `safeResolve`, noms générés côté serveur, SketchUp `rel` sans `..`. | `security.js:58-63`, `project-sketchup.js:58-63` |
| `/api/public/sketchup` | Token JWT purpose `skp_embed`, TTL 2 h, CORS InnerScene. Risque accepté (lien utilisable seulement avec secret). | `public-sketchup.js`, `project-sketchup.js:123-128` |
| Rate limit | Login 8/15 min ; global 200/min mémoire (multi-instance faible). | `auth.js:17-21`, `index.js:89` |
| CORS | Origins via `FRONTEND_URL` ; match host http/https. | `index.js:65-87` |
| Secrets repo | Pas de `.env` réel commité ; `.env.example` avec placeholders faibles — OK pour exemple. | `backend/.env.example` |
| Setup premier admin | Public tant qu’aucun admin — rate-limité ; MDP min 4 chars. | `auth.js:29-65`, `bootstrap-admin.js` |

---

## Actions recommandées (hors ce pass)

1. Changer PIN Finance + mots de passe seed en production ; supprimer défaut `31250` du code.
2. Étendre `requirePermission` aux routes métier restantes.
3. Deny-by-default Drive ACL.
4. Arrêter le stockage du mot de passe navigateur.
5. Signer les `state` OAuth Meta/Pinterest.
