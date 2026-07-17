# Cahier des charges — Design system & UI NEYA ERP

**Pour :** agent Lovable (design UI/UX)  
**Client :** Neya Furniture / NEYA ERP  
**Objectif :** produire un design produit **niveau 20k$** (SaaS pro, tracking & growing), mobile-first type app iPhone, desktop type dashboard premium.  
**Stack réelle (à respecter pour l’implémentation) :** Next.js + React + Tailwind, ERP existant déjà en production (`erp.neyafurniture.ca`).

---

## 1. Prompt prêt à coller dans Lovable

Copie-colle ceci en premier message à Lovable :

```text
Tu es un designer produit senior (ex-Linear / Stripe / Lovable). Tu dois concevoir le design system + les écrans clés de NEYA ERP, un logiciel d’atelier de meubles (Québec) déjà en production.

CONTEXTE PRODUIT
- ERP atelier : production, projets clients, Gmail intégré, Drive, devis/factures, dépenses, équipe, calendrier, stock, plans de coupe, assistant IA vocal.
- Utilisateurs : propriétaire (Mehdi), artisans (Mehdi/Olive), admin.
- Usage intensif sur iPhone + desktop atelier.
- Marque : Neya Furniture — orange #D86B30, noir #0A0A0A, surfaces claires #FAFAFA. Logo/pictos déjà existants (orange).
- Ton : artisanal premium, moderne, calme, efficace. PAS de look “AI purple”, PAS de glassmorphism excessif, PAS de dashboard générique surchargé.

MISSION
1) Pose-moi TOUTES les questions nécessaires avant de designer (voir section questions du cahier).
2) Propose une direction visuelle claire (moodboard textuel + principes).
3) Livre un design system (tokens, typo, spacing, composants, motion).
4) Design les écrans prioritaires (desktop + mobile) listés dans le cahier.
5) Pour chaque écran : wireframe → hi-fi, états vides/chargement/erreur, micro-interactions.
6) Livre des specs d’export utilisables par un développeur Cursor (classes Tailwind, mesures, variants).

QUALITÉ ATTENDUE
- Niveau produit SaaS 20k$ : hiérarchie impeccable, rythme, respiration, animations intentionnelles (2–3 max par écran).
- Mobile = app native (liste → détail, bottom sheets, touch 44px).
- Desktop = shell latéral + contenu large, densité maîtrisée.
- Accessibilité : contraste AA, focus visibles, labels clairs (FR).

Réponds d’abord UNIQUEMENT par la liste de questions (section 8 du cahier), puis attends mes réponses avant de designer.
```

---

## 2. Vision produit

| Élément | Description |
|--------|-------------|
| **Nom** | NEYA ERP |
| **Entreprise** | Neya Furniture (atelier de fabrication, Québec) |
| **Promesse** | Un seul outil pour fabriquer, vendre, communiquer et suivre l’atelier — aussi beau qu’efficace. |
| **Positionnement design** | Produit pro “ops + craft” : précision d’atelier + polish SaaS (inspire Linear, Attio, Arc, Base44 dashboards, Lovable polish). |
| **Langue UI** | Français (Québec) |
| **URL** | `https://erp.neyafurniture.ca` |

### Personas
1. **Mehdi (owner / admin)** — décide, lit mails, devis, pilote prod, mobile souvent.
2. **Artisan** — coche étapes prod, consulte planning, peu de admin.
3. **Futur collab / client interne** — permissions limitées.

---

## 3. Brand existante (contraintes non négociables)

### Couleurs actuelles
| Token | Hex | Usage |
|-------|-----|--------|
| `neya-ink` | `#0A0A0A` | texte, focus |
| `neya-ink-light` | `#3D3D3D` | secondaire |
| `neya-orange` | `#D86B30` | CTA, accent, actif |
| `neya-orange-dark` | `#B85A28` | hover CTA |
| `neya-muted` | `#737373` | labels |
| `neya-border` | `#E5E5E5` | borders |
| `neya-surface` | `#FAFAFA` | fonds sidebar / cards plates |
| success / warning / error | verts / ambre / rouge | statuts |

### Assets
- Logo : `/brand/logo-orange.png`
- Picto : `/brand/picto-orange.png`
- Favicons / PWA icons présents

### Ce que Lovable PEUT faire
- Affiner palette (teintes dérivées, surfaces, overlays)
- Proposer typographie expressive **compatible web** (pas Inter par défaut si mieux — mais rester lisible atelier)
- Définir rayons, ombres, motion, densité
- Redesigner layouts sans casser les flux métier

### Ce que Lovable NE DOIT PAS faire
- Rebrand violet / indigo “AI default”
- Dark mode forcé (optionnel seulement)
- Remplacer l’orange NEYA
- Inventer des modules hors scope sans le dire

---

## 4. Architecture fonctionnelle (modules à couvrir)

### Navigation actuelle
**Atelier :** Dashboard, Production, Sauna Cloud, Plans de coupe, Session admin, Projets  
**Opérations :** Liste de courses, Achats, Stock, Équipe, Calendrier, Dépenses  
**Outils :** Drive, Courriel (Gmail)  
**Facturation :** Devis & factures  
**Commercial :** Clients, Standards, Site web  
**Système :** Paramètres, Manuel, Assistant IA (orbe flottant)

### Priorité design (ordre)

#### P0 — doit être parfait
1. **Shell global** (sidebar desktop + bottom nav mobile + header)
2. **Courriel / Gmail** (`/mail`) — liste → lecture → réponse → contexte ERP (sheet)
3. **Dashboard** (`/`)
4. **Projet détail** (`/projects/[id]`) — hub client/prod/mails/drive

#### P1 — très important
5. **Login**
6. **Production** (kanban / file atelier)
7. **Clients** liste + fiche
8. **Devis & factures**
9. **Plans de coupe** (studio 1D/2D)
10. **Assistant IA** (orbe + sheet chat)

#### P2 — ensuite
11. Drive, Calendrier, Équipe, Achats, Stock, Sauna Cloud, Settings

---

## 5. Exigences UX / UI détaillées

### Principes
1. **Une composition claire** par viewport (pas un dashboard fourre-tout).
2. **Mobile = app** : transitions liste↔détail, sheets, FAB si utile, zones touch ≥ 44px.
3. **Desktop = productivité** : densité contrôlée, raccourcis visibles, panneaux optionnels.
4. **Motion utile** : entrée page, slide panneau, sheet bottom spring, hover lift — max 2–3 intentions fortes.
5. **États complets** : loading skeletons, empty states brandés, erreurs récupérables, succès discrets.
6. **Accessibilité** : contraste, focus ring, pas d’info seulement par couleur.

### Courriel (écran critique)
- Inspiré Gmail iOS + Linear polish
- Dossiers Gmail + tri NEYA (À répondre, Clients, Fournisseurs…)
- Non-lus visibles immédiatement
- Corps mail lisible (jamais colonne écrasée)
- Contexte ERP = bottom sheet mobile / side panel desktop
- Compose réponse = carte élevée, CTA clair
- Recherche premium (pill / glass soft)

### Plans de coupe
- Studio type CutList : pièces à gauche, canvas planches/panneaux
- Édition tactile segments + rectangles
- Stats rendement visibles

### Assistant
- Orbe flottant brandé (picto NEYA)
- Modes Parler / Écrire / Joindre
- Ne pas concurrencer le contenu principal

---

## 6. Livrables attendus de Lovable

1. **Moodboard / direction** (3 options max, recommandation claire)
2. **Design system**
   - Tokens couleur (base + sémantique)
   - Typo (display / title / body / caption)
   - Spacing scale (4/8)
   - Radius, elevation, borders
   - Motion (durées, easing)
3. **Bibliothèque composants**
   - Button, Input, Select, Card, Badge, Tabs, Toast, Modal, Sheet, Nav, Avatar, Empty
4. **Maquettes hi-fi**
   - Desktop 1440 et Mobile 390 pour chaque écran P0 (+ P1 si possible)
5. **Specs dev**
   - Mesures, gaps, couleurs hex, états hover/active/disabled
   - Annotations “comportement”
6. **Prototype cliquable** (si Lovable le permet) : Login → Dashboard → Mail (liste/détail) → Projet
7. **Checklist handoff Cursor** : ce qu’il faut coder en premier

### Format préféré pour le handoff
- Screens nommés : `01-shell-desktop`, `02-mail-list-mobile`, etc.
- Pour chaque composant : variants listés
- Export texte structuré (markdown) + captures

### Génération page par page (recommandé)
Après le design system, **ne pas demander tout l’ERP d’un coup**.  
Utiliser le fichier compagnon **`docs/cahier-pages-lovable-une-par-une.md`** : une fiche = un prompt Lovable (zones, mocks, états, critères, checklist 00→28).

---

## 7. Contraintes techniques (pour un design implémentable)

- Tailwind utility-first (pas de CSS-in-JS obligatoire)
- Composants React existants : `AppShell`, `Sidebar`, `MobileNav`, `GmailInbox`, `ChatAssistant`
- Pas de refonte backend dans ce lot — **UI/UX seulement**
- FR-CA copy
- PWA / safe-area iPhone (home indicator)
- Performance : pas d’animations lourdes continues

---

## 8. Questions que Lovable DOIT poser (et que tu dois répondre)

### A. Positionnement & ambition
1. Le design doit-il servir surtout **l’équipe atelier** (outil interne) ou aussi **impression clients** (quand partagé) ?
2. Niveau de “wow” souhaité : **calme premium** (Linear) vs **expressif craft** (atelier/matériaux) vs mix ?
3. As-tu des références précises (3–5 URLs / apps) hors Lovable/Base44 ?

### B. Brand
4. Garder Inter/Geist actuel ou ok pour une **typo display** distinctive (titres) + body sobre ?
5. Autoriser des **textures / grain / photos atelier** en fonds, ou rester ultra-plat ?
6. Logo : conserver orange actuel à 100 % ou explorer une version mono ink pour dark headers ?

### C. Mobile
7. Bottom nav : garder 5 onglets (Accueil / Prod / Projets / Mail / Plus) ou simplifier ?
8. Sur chantier/iPhone : quelles 3 actions doivent être en ≤2 taps ?

### D. Courriel
9. Priorité absolue : **vitesse de réponse client** ou **tri/classement ERP** ?
10. Le panneau Contexte ERP doit-il être visible par défaut sur desktop ?

### E. Contenu & data
11. Fournis 5–10 **vrais exemples** (anonymisés) : sujet mail, nom client, étape prod, montant devis.
12. Photos atelier / produits à utiliser dans empty states ?

### F. Scope & planning
13. Phase 1 = seulement Shell + Mail + Dashboard + Projet, OK ?
14. Dark mode : maintenant / plus tard / jamais ?
15. Faut-il aussi une **landing marketing** NEYA ERP, ou uniquement l’app ?

### G. Validation
16. Qui valide les maquettes (toi seul / autre) et délai de feedback ?
17. Format de livraison préféré pour Cursor (Figma link, Lovable project, PNG + markdown) ?

> **Instruction Lovable :** ne commence le design hi-fi qu’après réponses A–G. Si une réponse manque, propose une hypothèse marquée `HYPOTHÈSE` et continue.

---

## 9. Critères d’acceptation (definition of done)

Le design est accepté si :
- [ ] Un iPhone 390px du mail est **immédiatement lisible** (pas de colonne écrasée)
- [ ] Un non-designer retrouve Boîte / À répondre / Répondre en < 5 secondes
- [ ] Le design system est cohérent sur ≥ 4 écrans
- [ ] Motion présente mais non gadget
- [ ] Orange NEYA reste le signal de marque dominant
- [ ] Handoff assez précis pour qu’un agent Cursor implémente sans inventer

---

## 10. Annexes utiles à joindre à Lovable

Joins si possible :
1. Captures actuelles de `/mail`, `/`, `/projects/[id]` (desktop + mobile)
2. Logo + picto orange
3. Ce fichier `docs/cahier-des-charges-design-lovable.md`
4. Fiches pages : `docs/cahier-pages-lovable-une-par-une.md` (génération une par une)
5. URL prod : `https://erp.neyafurniture.ca` (compte démo si tu veux)

### Réponses types (à compléter)

```text
A1:
A2:
A3:
B4:
B5:
B6:
C7:
C8:
D9:
D10:
E11:
E12:
F13:
F14:
F15:
G16:
G17:
```

---

## 11. Après Lovable → retour Cursor

Quand Lovable a fini, renvoie :
1. Lien projet Lovable / exports
2. Design system (markdown ou JSON tokens)
3. Liste des écrans validés
4. Message : « Implémente le design Lovable sur NEYA ERP en gardant les APIs actuelles »

Cursor pourra alors porter le design dans `frontend/` écran par écran.
