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

### 5. Élevé → **partiellement patché** — PIN Finance / bootstrap `31250`
- **Avant** : défaut toujours actif + `project_admin_pin_configured` toujours vrai (`|| '31250'`).
- **Désormais** : `DEFAULTS.project_admin_pin` vide ; booléen `configured` honnête ; en **production** unlock refuse si aucun PIN settings/env (503). Dev garde `31250` pour bootstrap local.
- **Reste** : seed Mehdi / login setup peuvent encore préremplir `31250` en non-prod (`db/init.js`, `login/page.js`).

### 6. Élevé → **patché** — permissions métier surtout côté UI
- **Avant** : la plupart des mounts `/api/*` n’avaient que `authMiddleware`.
- **Désormais** : `backend/src/index.js` applique `requirePermission` / `requireAnyPermission` / `requireAdmin` au montage (clients, projets, factures, paiements, dépenses, production, stock, achats, employés, deploy, cursor-agent, marketplace, social, marchés, etc.). Routes déjà durcies (settings, drive, gmail, analytics, payroll, users) inchangées.
- **Reste** : affiner les clés (ex. assistant, modules, habits) si besoin métier.

### 7. Moyen → **patché** — Drive ACL vide = Drive entier
- **Avant** : `drive-access.js` ouvrait tout le Drive si `drive_access` vide (non-admin).
- **Désormais** : deny-by-default — liste vide → `restricted: true`, `roots: []`.

### 8. Moyen → **patché** — mot de passe login en `localStorage`
- **Désormais** : « Se souvenir » stocke uniquement l’email ; clé password purgée à la lecture/écriture.

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
