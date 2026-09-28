# UX bug pass — branche `cursor/ux-pro-motion-6499`

Pass après polish motion / Craft Flow (tokens, boutons lift, dashboard, login).

## Corrigé dans ce pass

| Bug | Action |
|-----|--------|
| `.cf-panel` / `.cf-kpi` définis 2× (bloc dashboard + bloc UX Pro) | Une seule définition ; hover lift unifié ; `min-h` + `h-full` sur KPI |
| `.nav-item` / `.mobile-dock*` redéfinis hors `@layer` (cascade imprévisible) | Motion / ombre / dot actif fusionnés dans `@layer components` |
| Login : `input pl-10` vs `px-3.5` (risque icône/texte) | Classe `.input-icon` (`padding-left: 2.5rem`) |
| Menu mobile sans `/marches` (présent en sidebar) | Entrée ajoutée sous Bureau |

## PATH_MAP / imports

- Toutes les routes `frontend/app/*` ont une entrée PATH_MAP (y compris `/atelier-zotique`, `/paie`, `/marches`).
- Pas d’imports cassés sur les fichiers touchés par le polish UX (`page.js`, `login`, `AppShell`, `globals.css`).

## Conflits git vs `main`

- Branche = commits UX uniquement sur `globals.css`, login, dashboard, AppShell, `tailwind.config.js`, doc design.
- `merge-tree` vs `origin/main` : **pas de conflit texte** au moment du pass.
- **Risque résiduel** : autres PR qui retouchent `globals.css` ou `login/page.js` (ex. `fix-logo-padding`, mail compose) — rebase prudent.

## Restants (non bloquants / hors scope polish)

1. **Z-index mobile** — dock `z-55`, sheet mail ERP `z-56`, chat / voice `55–65`, menu mobile `z-70`. Mail à peine au-dessus du dock ; chevauchement possible si chat + sheet mail ouverts ensemble.
2. **Recherche header AppShell** — champ ⌘K décoratif (pas de handler).
3. **Bouton notifications** — UI sans wiring.
4. **`PERMISSION_AREAS`** — pas de clé `hours` (accès via `canAccessHours` seulement) ; `roadmap` mappe vers permission `settings` dans PATH_MAP.
5. **Overflow** — pages denses (mail, cutting studio, éditeur devis) : padding `pb-shell` / dock clearance à revalider sur petits viewports réels.
6. **Contrast boutons** — `btn-primary` / `btn-secondary` / `btn-ink` OK ; liens header `btn-ghost` et CTA ink custom hors classes `.btn-*` (cohérent mais hétérogène).
7. **`neya-ambient` + `background-attachment: fixed`** — perf / scroll sur iOS à surveiller.

## Fichiers touchés (ce pass)

- `frontend/app/globals.css`
- `frontend/app/login/page.js`
- `frontend/components/MobileNav.js`
- `docs/UX-BUG-PASS.md`
