# Fiches pages NEYA ERP — génération Lovable une par une

**Usage :** après le design system (cahier principal), génère **une seule page** à la fois avec le prompt de la fiche.  
**Format livrable par page :** Desktop 1440 + Mobile 390 + états (vide / loading / erreur / succès) + annotations handoff (Tailwind, mesures, motion).  
**Ordre recommandé :** 00 → 01 → 02 → … (ne saute pas le shell).

Fichier compagnon : `docs/cahier-des-charges-design-lovable.md`

---

## Comment coller dans Lovable (chaque page)

```text
Contexte : NEYA ERP (atelier meubles Québec). Brand : orange #D86B30, ink #0A0A0A, surface #FAFAFA.
Logo : logo-orange.png · Picto : picto-orange.png.
Respecte le design system déjà validé (PAGE 00). Génère UNIQUEMENT l’écran demandé ci-dessous.
Livrables obligatoires :
1) Desktop 1440
2) Mobile 390
3) États vide / loading (skeleton) / erreur / succès
4) Notes motion (max 2–3 intentions)
5) Specs handoff Cursor (tokens, spacing, composants, comportement)
Langue UI : français Québec. Pas de violet AI. Pas de dashboard surchargé.
Ne redesign pas le shell sauf si la fiche le demande.
[COLLER LA FICHE PAGE COMPLÈTE ICI]
```

### Règle d’or Lovable
- **1 message = 1 page** (ou 1 état d’une page, ex. sheet ERP ouvert).
- Quand validé : « Page NN validée. Passe à PAGE NN+1 uniquement. »

---

# 00 — Design system & Shell global

**Route :** global (toutes les pages)  
**Priorité :** P0 — **faire en premier**

### Objectif
Définir le cadre commun : sidebar desktop, bottom nav mobile, header, typo, boutons, cards, toasts, sheets.

### Zones desktop
1. **Sidebar gauche** (~240–260px) : logo NEYA, tagline « Espace atelier », sections Atelier / Opérations / Outils / Facturation / Commercial, item actif (dot + accent orange), footer Manuel / Paramètres / Roadmap / Déconnexion + lien neyafurniture.ca
2. **Header** sticky : titre page + actions droites
3. **Main** : contenu max-width ~1400px wide / 1152px standard, padding confortable
4. **Orbe assistant** flottant bas-droite (picto orange), au-dessus du contenu

### Zones mobile
1. **Top bar** 48px : logo + titre page
2. **Bottom nav** 5 items : Accueil, Prod, Projets, Mail, Plus (safe area)
3. **Orbe** au-dessus de la bottom nav (ne pas masquer le 5e tab)

### Composants à designer (page dédiée tokens)
Button primary / secondary / ghost / danger · Input · Select · Textarea · Checkbox · Switch · Card · Badge (statuts) · Tabs · Modal · Bottom sheet · Toast · Avatar · Empty state · Skeleton · Nav item · Progress bar · FAB · Divider · Tooltip

### Tokens à figer
Couleurs (ink, orange, muted, border, surface, success/warn/error) · typo (display + body) · radii · shadows (1–2 niveaux max) · spacing 4/8/12/16/24/32 · motion 150ms hover / 350ms sheet spring

### Prompt Lovable
```text
PAGE 00 — Design system + Shell NEYA ERP
Crée 3 frames :
(A) Design system : tokens + tous les composants listés
(B) Shell desktop : sidebar peuplée + main « Page exemple »
(C) Shell mobile : top bar + bottom nav 5 items + orbe
Nav Atelier : Dashboard, Production, Sauna Cloud, Plans de coupe, Session admin, Projets
Opérations : Courses, Achats, Stock, Équipe, Calendrier, Dépenses
Outils : Drive, Courriel | Facturation | Commercial : Clients, Standards, Site web
Footer : Manuel, Paramètres, Roadmap, Déconnexion
Motion : hover nav 150ms, sheet 350ms spring. Brand orange #D86B30.
```

### Critères acceptation
- [ ] Sidebar lisible, item actif évident
- [ ] Bottom nav 44px+ touch, labels FR
- [ ] Tokens exportables (noms + hex)

---

# 01 — Login

**Route :** `/login`  
**Priorité :** P1

### Objectif
Connexion simple, confiance marque, mobile-first. Pas de signup public.

### Layout
- Fond atmosphérique soft (grain / dégradé atelier subtil — pas photo lourde)
- Carte centrale (max ~400px) : logo, titre « Connexion », sous-titre optionnel « Espace atelier »
- Champs : Email, Mot de passe (show/hide)
- Checkbox « Se souvenir »
- Bouton pleine largeur « Entrer »
- Erreur inline sous le formulaire (pas d’alert navigateur)
- Pas de long landing marketing

### États
| État | UI |
|------|-----|
| Défaut | champs vides |
| Focus | ring ink/orange |
| Loading | bouton disabled + spinner « Connexion… » |
| Erreur | « Identifiants incorrects » |
| Succès | toast bref → redirect `/` |

### Prompt Lovable
```text
PAGE 01 — Login /login
Desktop + mobile. Carte login centrée, brand orange NEYA, email/password, « Se souvenir », CTA « Entrer ».
États : erreur « Identifiants incorrects », loading bouton.
Pas de signup. Look premium calme, pas landing longue.
Livre aussi frame erreur + frame loading.
```

### Critères acceptation
- [ ] Touch targets ≥ 44px mobile
- [ ] Erreur accessible (texte, pas couleur seule)

---

# 02 — Dashboard

**Route :** `/`  
**Priorité :** P0

### Objectif
Vue atelier du jour : **quoi faire maintenant**, alertes, raccourcis. Une composition, pas 12 widgets.

### Zones desktop (haut → bas)
1. **Salutation + date** — « Bonjour Mehdi · jeudi 17 juil. »
2. **4 KPI max** en rangée : Projets actifs · Mails à répondre · Tâches du jour · En retard
3. **Bloc principal « Aujourd’hui »** (60–70% largeur) : liste tâches / jobs prod avec assigné + heure
4. **Colonne droite alertes** : factures à classer, devis en attente, stock bas
5. **Raccourcis** : Nouveau projet · Courriel · Production · Plans de coupe

### Données mock
- KPI : 8 · 3 · 5 · 1  
- Tâches : « Débitage Haltigan — Mehdi 9h », « Finition banc Olive — Olive », « Assemblage frames Jared »  
- Alerte : « 2 factures Home Depot à classer » · « Devis Sierra en attente »

### Mobile
- KPI scroll horizontal (pills/cards)
- Liste Aujourd’hui pleine largeur
- Alertes en dessous
- FAB optionnel « + » (nouveau projet) — ou raccourcis en chips

### États
Empty (aucune tâche) · Skeleton KPI+liste · Erreur partial « Impossible de charger les alertes »

### Prompt Lovable
```text
PAGE 02 — Dashboard /
Composition « quoi faire maintenant » (inspire Linear/Attio).
Desktop : salutation + 4 KPI + Aujourd’hui + alertes + raccourcis.
Mobile : KPI scroll + liste + alertes. Empty + skeleton.
Accent orange #D86B30. Pas de grille 8 widgets.
```

### Critères acceptation
- [ ] Premier viewport = une intention claire
- [ ] Mobile sans grille dense

---

# 03 — Courriel (liste)

**Route :** `/mail` (état liste, aucun message sélectionné)  
**Priorité :** P0

### Objectif
Boîte Gmail intégrée + tri NEYA, lecture rapide.

### Desktop — 3 colonnes
| Col | Contenu |
|-----|---------|
| 1 (~220px) | Dossiers Gmail : Boîte, Envoyés · Tri NEYA : À répondre, Clients, Fournisseurs, Projets, Promotions, Non classés · compteurs |
| 2 (~360px) | Liste messages |
| 3 (flex) | Empty lecture : orbe + « Sélectionnez un message » |

### Ligne message (liste)
Avatar · **Expéditeur** · sujet · aperçu 1 ligne trunc · date relative · badge catégorie · point non-lu orange

### Toolbar
Recherche pill · refresh · « Trier la boîte »

### Mobile
- Liste seule pleine largeur
- Select dossier + « Trier »
- Tap message → PAGE 04
- **Pas** de panneau ERP visible sur la liste

### Mock messages (min. 6)
1. Louise — « Sierra frames pricing » — À répondre — **non-lu**  
2. Home Depot — « Facture #4421 » — Fournisseur  
3. Client Haltigan — « Question livraison » — Clients — **non-lu**  
4. Rona — « Confirmation commande » — Fournisseur  
5. Toi — « Devis révisé » (Envoyés)  
6. Newsletter — Promotions

### Prompt Lovable
```text
PAGE 03 — Courriel LISTE /mail
Desktop 3 col (dossiers | liste | empty lecture orbe).
Mobile liste seule. Non-lus point orange. Badges Répondre/Client/Fournisseur.
Recherche rounded-full. Pas de panneau ERP sur mobile ici.
6 messages mock ci-dessus.
```

### Critères acceptation
- [ ] Compteurs dossiers visibles
- [ ] Hiérarchie non-lu / lu claire

---

# 04 — Courriel (lecture + réponse)

**Route :** `/mail` (message ouvert)  
**Priorité :** P0

### Objectif
Lire et répondre comme une app mail native. **Corps jamais écrasé.**

### Desktop
1. Colonne lecture : sujet, From, date, actions (Archiver, Contexte)
2. Corps mail large (lisibilité prose)
3. **Compose** bas : carte « Répondre » élevée · boutons Orthographe / IA · Envoyer
4. **Contexte ERP** droite (~320px) : client lié, projet, synthèse IA, points clés, CTA ouvrir projet

### Mobile
1. Plein écran lecture + ← retour liste
2. Corps **full width** (JAMAIS colonne ~2 caractères)
3. Compose sticky bas
4. Contexte ERP = **bottom sheet** (icône sparkles), slide-up spring — **livrer 2e frame sheet ouvert**

### États
Loading corps · synthèse IA skeleton · envoi toast succès · erreur « Échec envoi »

### Prompt Lovable
```text
PAGE 04 — Courriel LECTURE /mail
Desktop : lecture + compose card + panneau Contexte ERP.
Mobile : plein écran + 2e frame bottom sheet ERP ouvert.
Texte corps large. Motion : slide lecture, sheet spring 350ms.
Message mock : Louise « Sierra frames pricing ».
```

### Critères acceptation
- [ ] Corps lisible mobile ≥ ~90% largeur utile
- [ ] Sheet ERP ne casse pas le compose

---

# 05 — Projets (liste)

**Route :** `/projects`  
**Priorité :** P1

### Objectif
Retrouver un projet vite (statut, client, deadline).

### Zones
1. Header : titre « Projets » + CTA primary « Nouveau projet »
2. Filtres chips : Tous / Actifs / Terminés / En retard
3. Recherche texte
4. Liste desktop (table dense) ou cards : nom, client, progress %, deadline, badge statut
5. Mobile : cards empilées, progress bar fine orange

### Mock
| Projet | Client | % | Deadline | Statut |
|--------|--------|---|----------|--------|
| Haltigan sauna | Haltigan | 62% | 28 juil | Actif |
| Jared frames | Jared | 20% | — | Actif |
| Banc olive | Catalogue | 100% | — | Terminé |

### États
Empty « Aucun projet — crée le premier » · Loading skeleton rows · Filtre sans résultat

### Interactions
- Clic ligne → `/projects/[id]`
- CTA → modal ou page création (montrer modal « Nouveau projet » : nom, client select, deadline)

### Prompt Lovable
```text
PAGE 05 — Projets liste /projects
Desktop table dense + CTA Nouveau. Mobile cards + progress orange.
Filtres chips + recherche. Empty + skeleton.
Montre aussi modal « Nouveau projet » (2e frame).
Données mock Haltigan / Jared / Banc olive.
```

---

# 06 — Projet (détail / workspace)

**Route :** `/projects/[id]`  
**Priorité :** P0

### Objectif
Hub du projet : avancement, tâches, mails, fichiers, notes.

### Zones
1. **Header** : nom « Haltigan — Sauna », lien client, badge Actif, progress 62%, budget optionnel
2. **Actions** : Lier client · Ouvrir mail · Ajouter tâche · Drive
3. **Tabs** : Aperçu | Tâches | Courriel | Drive | Dépenses | Notes
4. **Aperçu** : checklist prod, prochaines échéances, activité récente

### Mobile
Header compact · tabs scroll horizontal · un onglet à la fois

### Mock Aperçu
- Tâches : Débitage ✓ · Usinage ○ · Assemblage ○  
- Mail récent : « Question livraison »  
- Fichier : `plans-sauna.pdf`

### Prompt Lovable
```text
PAGE 06 — Projet détail /projects/[id]
Hub « Haltigan — Sauna ». Tabs Aperçu/Tâches/Courriel/Drive.
Desktop header riche. Mobile tabs scroll. Onglet Aperçu peuplé.
États : loading tabs, empty tâches.
```

---

# 07 — Production

**Route :** `/production`  
**Priorité :** P1

### Objectif
File atelier : jobs à faire avancer par étape.

### Layout
- **Desktop :** kanban colonnes OU liste groupée par étape  
  Étapes : Débitage → Usinage → Assemblage → Finition → Livraison
- **Carte job :** titre, client, assigné (avatar Mehdi/Olive), checkbox étape, deadline
- Filtres : Assigné · Type (catalogue / sur-mesure)

### Mobile
Liste verticale par étape (accordion) · grandes checkboxes

### Mock jobs
Haltigan — Débitage — Mehdi  
Banc olive — Finition — Olive  
Jared frames — Usinage — Mehdi

### Prompt Lovable
```text
PAGE 07 — Production /production
Kanban desktop (5 colonnes étapes) OU liste groupée si plus lisible.
Mobile accordion par étape. Cards cochables. Filtres assigné.
Empty + job sélectionné (highlight).
```

---

# 08 — Sauna Cloud

**Route :** `/sauna-cloud`  
**Priorité :** P2

### Objectif
Suivi frames sauna à fabriquer + % global.

### Zones
1. Titre + notes projet (textarea)
2. Progress global % + barre
3. Liste frames (10 items) : checkbox done, titre éditable inline, notes courte
4. CTA « Ajouter frame »

### Mock
Frames 1–10 type « Frame A1 », 6/10 done → 60%

### Prompt Lovable
```text
PAGE 08 — Sauna Cloud /sauna-cloud
Checklist 10 frames mock, progress %, notes projet haut.
Touch targets grands. Look atelier clean. Empty si 0 frame.
```

---

# 09 — Plans de coupe (studio)

**Route :** `/cutting-plans`  
**Priorité :** P1

### Objectif
Studio type CutList : pièces → patterns planches 8 pi / panneaux 4×8.

### Zones desktop
1. **Top bar** : titre · toggle Planches | Panneaux · stats rendement % · Démo · Optimiser · Sauver · PDF
2. **Sidebar** : kerf mm · liste pièces (L ou W×H + qty) · Ajouter pièce
3. **Canvas** : planches = barres colorées segments redimensionnables · panneaux = rectangles draggables

### Mobile
Tabs **Pièces** | **Canvas** · Optimiser sticky bas

### Mock
3 planches 8 pi, pièces colorées distinctes, rendement ~78%

### Prompt Lovable
```text
PAGE 09 — Plans de coupe /cutting-plans
Studio CutList-like. Desktop sidebar pièces + canvas 3 planches colorées.
Mobile tabs Pièces/Canvas. Mode Planches 8 pi. UI outil pro (pas Excel).
Stats rendement visibles. Empty pièces + loading optimiser.
```

---

# 10 — Clients (liste)

**Route :** `/clients`  
**Priorité :** P1

### Objectif
CRM léger : retrouver un client et ouvrir sa fiche.

### Zones
1. Header + CTA « Nouveau client »
2. Recherche (nom, email, téléphone)
3. Desktop table : Nom · Email · Téléphone · Nb projets · Dernier contact
4. Mobile cards : nom + email + chip nb projets

### Mock
Haltigan · Louise Sierra · Jared · Acme Interiors

### États
Empty · Loading · Résultat recherche vide

### Prompt Lovable
```text
PAGE 10 — Clients /clients
Table desktop / cards mobile. Recherche + CTA Nouveau client.
4 clients mock. Empty « Aucun client ». Modal création (2e frame) : nom, email, téléphone, adresse.
```

---

# 11 — Client (fiche)

**Route :** `/clients/[id]`  
**Priorité :** P1

### Objectif
Profil client + projets liés + activité.

### Zones desktop (2 colonnes)
**Gauche :** nom, email, téléphone, adresse, notes, CTA Éditer  
**Droite :** projets liés (cartes) · mails récents · activité

### Mobile
Stack vertical · projets en liste

### Mock
Client « Haltigan » · projets Sauna 62% · mail « Question livraison »

### Prompt Lovable
```text
PAGE 11 — Fiche client /clients/[id]
Profil Haltigan. Coordonnées + projets liés + activité.
Desktop 2 col. Mobile stack. Mode édition inline ou modal.
```

---

# 12 — Devis & factures (liste)

**Route :** `/invoices`  
**Priorité :** P1

### Objectif
Liste documents commerciaux, séparation claire Devis / Factures.

### Zones
1. Tabs **Devis** | **Factures**
2. Filtres statut : Tous / Brouillon / Envoyé / Payé (factures) / Accepté (devis)
3. CTA « Nouveau »
4. Table : N° · Client · Date · Montant CAD · Badge statut
5. Mobile : cards montant mis en avant

### Mock
Devis D-1042 Haltigan 4 850 $ — Envoyé  
Facture F-2201 Jared 1 200 $ — Payé  
Facture F-2202 Louise — Brouillon

### Prompt Lovable
```text
PAGE 12 — Devis & factures /invoices
Tabs Devis/Factures. Table desktop, cards mobile. Badges statut. Montants $ CA.
CTA Nouveau. Empty par tab. Skeleton.
```

---

# 13 — Devis / Facture (détail)

**Route :** `/invoices/[id]` ou `/invoices/quotes/[id]`  
**Priorité :** P1

### Objectif
Document premium imprimable + actions.

### Zones
1. **Barre actions** : Éditer · PDF · Envoyer Gmail · Marquer payé (facture) / Accepté (devis)
2. **Aperçu document** : en-tête logo NEYA, infos client, tableaux lignes, sous-totaux, taxes QC (TPS/TVQ), total, notes
3. Mobile : document scroll + actions sticky bas (sheet ou barre)

### Mock
Devis Haltigan — 3 lignes matériaux/main-d’œuvre — total ~4 850 $ CA

### Prompt Lovable
```text
PAGE 13 — Document devis/facture
Aperçu document imprimable premium + barre actions PDF/Envoyer/Éditer.
Mobile : scroll + sticky actions. Taxes QC visibles. État envoyé succès toast.
```

---

# 14 — Dépenses

**Route :** `/expenses`  
**Priorité :** P2

### Objectif
Suivre dépenses atelier liées projets / fournisseurs.

### Zones
1. Header + total période + CTA « Ajouter »
2. Filtres : projet · période · fournisseur
3. Liste : date, fournisseur, projet, catégorie, montant, reçu (icône)
4. Mobile cards ; option « scan reçu » (bouton caméra, UI only)

### Mock
Home Depot 186,42 $ — Haltigan — 12 juil  
Rona 54,00 $ — Stock — 10 juil

### Prompt Lovable
```text
PAGE 14 — Dépenses /expenses
Liste dépenses + total + filtres projet. CTA Ajouter (modal : montant, fournisseur, projet, date).
Mobile cards. Empty + skeleton.
```

---

# 15 — Liste de courses

**Route :** `/liste-courses`  
**Priorité :** P2

### Objectif
Checklist matériaux à acheter, groupée par magasin, items éditables.

### Zones
1. Header + CTA « Ajouter article »
2. Groupes : Home Depot · Rona · Autre
3. Ligne : checkbox · nom · qty · prix optionnel · notes · éditer
4. Progress « 4/12 achetés »

### Mobile
Grandes checkboxes · swipe optionnel (annoter seulement)

### Prompt Lovable
```text
PAGE 15 — Liste de courses /liste-courses
Checklist groupée par magasin. Items éditables. Progress X/Y.
Touch targets grands. Empty « Liste vide ». Modal ajout article.
```

---

# 16 — Achats atelier

**Route :** `/purchases`  
**Priorité :** P2

### Objectif
Besoins / commandes fournisseurs et statuts.

### Zones
1. Header + CTA « Nouveau besoin »
2. Liste : article, qty, fournisseur, projet lié, badge statut (À commander / Commandé / Reçu)
3. Filtres statut

### Mock
Vis 2½" × 200 — Fastenal — À commander  
Colle Titebond — Rona — Commandé

### Prompt Lovable
```text
PAGE 16 — Achats atelier /purchases
Liste besoins + badges statut. Simple ops. Mobile cards. Empty state.
```

---

# 17 — Stock / Inventaire

**Route :** `/inventory`  
**Priorité :** P2

### Objectif
Voir quantités et alertes seuil bas.

### Zones
1. Recherche + CTA « Ajouter article »
2. Table : SKU/nom · qty · unité · seuil · emplacement · alerte
3. Badge rouge/ambre si qty ≤ seuil
4. Mobile liste avec qty mise en avant

### Mock
Chêne 8/4 — 12 pi — seuil 20 — **bas**  
Vis 2½" — 850 — OK

### Prompt Lovable
```text
PAGE 17 — Stock /inventory
Table stock + alerte qty basse. Mobile liste. Empty + skeleton.
Highlight lignes sous seuil.
```

---

# 18 — Équipe

**Route :** `/team`  
**Priorité :** P2

### Objectif
Employés, taux, skills, lien planning.

### Zones
1. Header + CTA « Ajouter »
2. Cards employés : avatar, nom, rôle, taux $/h, chips skills, lien Calendrier
3. Mobile : stack cards

### Mock
Mehdi — Owner/Artisan — 85 $/h — débitage, finition  
Olive — Artisan — 45 $/h — assemblage, finition

### Prompt Lovable
```text
PAGE 18 — Équipe /team
Cards employés skills + taux. Look RH léger premium. Empty.
```

---

# 19 — Calendrier

**Route :** `/calendar`  
**Priorité :** P2

### Objectif
Planifier tâches atelier et congés.

### Zones
1. Toggle Semaine | Mois (desktop) · Jour/Agenda (mobile)
2. Grille events : tâches prod (orange soft) · congés (muted)
3. Clic event → popover détail (projet, assigné)
4. CTA « Ajouter »

### Mock
Lun 9h Débitage Haltigan — Mehdi  
Mer congé Olive  
Ven livraison Jared

### Prompt Lovable
```text
PAGE 19 — Calendrier /calendar
Vue semaine desktop, agenda jour mobile. Events atelier + congés.
Popover détail. Empty semaine. Pas de surcharge Google Calendar clone.
```

---

# 20 — Drive

**Route :** `/drive`  
**Priorité :** P2

### Objectif
Explorateur Google Drive (Clients / Projets).

### Zones desktop
1. Tabs : Mes fichiers | Admin Clients
2. Sidebar dossiers (arborescence)
3. Breadcrumb
4. Grille/liste fichiers : icône type, nom, date, taille
5. Actions : Upload · Nouveau dossier · Ouvrir externe

### Mobile
Liste fichiers + breadcrumb · pas de double sidebar

### Mock
Dossiers Clients/Haltigan · `plans-sauna.pdf` · `photos/` 

### Prompt Lovable
```text
PAGE 20 — Drive /drive
Explorer : sidebar dossiers + grille. Tabs Mes fichiers / Admin Clients.
Mobile liste + breadcrumb. Empty dossier. Loading skeleton grille.
```

---

# 21 — Standards (catalogue)

**Route :** `/standards`  
**Priorité :** P2

### Objectif
Catalogue bancs / produits standards atelier.

### Zones
1. Header + recherche + CTA « Nouvelle fiche »
2. Grille cards : image, titre, tags, hover CTA « Voir »
3. Mobile 1 colonne

### Mock
Banc Olive · Banc Sierra · Frame standard

### Prompt Lovable
```text
PAGE 21 — Standards /standards
Grille fiches catalogue image+titre. Hover CTA. Empty catalogue.
```

---

# 22 — Standard (fiche)

**Route :** `/standards/[id]`  
**Priorité :** P2

### Objectif
Détail produit + étapes fabrication + créer projet.

### Zones
1. Hero image + titre + description
2. Étapes fabrication numérotées
3. CTA primary « Créer un projet depuis cette fiche »
4. Galerie secondaire

### Prompt Lovable
```text
PAGE 22 — Fiche standard /standards/[id]
Détail « Banc Olive » : image, étapes, CTA Créer projet.
Mobile stack. Pas de e-commerce panier.
```

---

# 23 — Session admin

**Route :** `/admin`  
**Priorité :** P2

### Objectif
Zone protégée PIN + tâches admin prioritaires.

### Frames obligatoires
1. **Verrou** : pad PIN 4–6 chiffres (UI), message « Session admin »
2. **Déverrouillé** : listes P0 / P1 / P2, notes sensibles, CTA

### Prompt Lovable
```text
PAGE 23 — Session admin /admin
Frame A : écran PIN. Frame B : dashboard tâches admin P0/P1/P2 après unlock.
Sobre, sécurisé, pas gadget.
```

---

# 24 — Paramètres

**Route :** `/settings`  
**Priorité :** P1

### Objectif
Config compte, Google, IA, users, entreprise.

### Zones
1. Nav tabs ou sidebar settings : Profil · Intégrations Google · Assistant IA · Utilisateurs · Entreprise · Cursor agent
2. **Frame principale à livrer :** Intégrations — Gmail + Drive connecté/déconnecté, bouton Connecter Google
3. Desktop 2 colonnes (nav | contenu) · Mobile tabs scroll

### Prompt Lovable
```text
PAGE 24 — Paramètres /settings
Layout settings tabs. Montre onglet Intégrations (états Google connecté ET déconnecté = 2 frames).
Desktop 2 col. Mobile tabs scroll. Autres onglets en wire léger OK.
```

---

# 25 — Manuel ERP

**Route :** `/manual`  
**Priorité :** P2

### Objectif
Centre d’aide interne.

### Zones
1. Recherche
2. Nav sections : Démarrage · Assistant · Production · Courriel · Facturation…
3. Article contenu (titre, paragraphes, liens)
4. Mobile : accordion sections

### Prompt Lovable
```text
PAGE 25 — Manuel /manual
Doc center : nav sections + article peuplé (ex. « Courriel Gmail »).
Mobile accordion. Recherche en haut.
```

---

# 26 — Assistant IA (overlay)

**Route :** global overlay  
**Priorité :** P1

### Objectif
Orbe → sheet chat Parler / Écrire / Joindre.

### Frames (4)
1. Orbe seul (picto NEYA) bas-droite  
2. Sheet ouvert mode **Écrire** (input + historique)  
3. Mode **Parler** (waveform / listening)  
4. Bulle **proposition d’action** à confirmer (« Créer tâche Débitage — Confirmer / Annuler »)

### Contraintes
Sheet ~70% hauteur mobile · ne masque pas toute l’app · au-dessus bottom nav

### Prompt Lovable
```text
PAGE 26 — Assistant IA overlay
4 frames : orbe · sheet Écrire · sheet Parler · confirmation action.
Sheet ~70% mobile. Picto NEYA. Pas de chatbot générique violet.
```

---

# 27 — Site web (WordPress bridge)

**Route :** `/web`  
**Priorité :** P2

### Objectif
Statut liaison site Neya + commandes éventuelles.

### Zones
1. Card statut : connecté / URL neyafurniture.ca
2. Cards KPIs légers (commandes récentes si mock)
3. Liste commandes web éventuelles
4. Liens externes

### Prompt Lovable
```text
PAGE 27 — Site web /web
Dashboard léger bridge WordPress. Statut + liste commandes mock.
Empty « Aucune commande ». Pas de builder site.
```

---

# 28 — Roadmap

**Route :** `/roadmap`  
**Priorité :** P2

### Objectif
Board interne features.

### Zones
Colonnes Ideas / Doing / Done · cards feature titre + tag · drag annoté seulement

### Prompt Lovable
```text
PAGE 28 — Roadmap /roadmap
Board Ideas / Doing / Done. Cards features internes. Sobre équipe.
```

---

## Ordre de génération suggéré (checklist)

| # | Page | Priorité | Statut |
|---|------|----------|--------|
| 00 | Design system + Shell | P0 | ☐ |
| 01 | Login | P1 | ☐ |
| 02 | Dashboard | P0 | ☐ |
| 03 | Mail liste | P0 | ☐ |
| 04 | Mail lecture (+ sheet ERP) | P0 | ☐ |
| 05 | Projets liste | P1 | ☐ |
| 06 | Projet détail | P0 | ☐ |
| 07 | Production | P1 | ☐ |
| 09 | Plans de coupe | P1 | ☐ |
| 24 | Settings | P1 | ☐ |
| 26 | Assistant overlay | P1 | ☐ |
| 10–11 | Clients | P1 | ☐ |
| 12–13 | Facturation | P1 | ☐ |
| 08 | Sauna Cloud | P2 | ☐ |
| 14–20 | Ops + Drive + Cal | P2 | ☐ |
| 21–23 | Standards + Admin | P2 | ☐ |
| 25, 27–28 | Manuel, Web, Roadmap | P2 | ☐ |

---

## Prompt « page suivante »

```text
Page [NN] validée. Passe à la PAGE [NN+1] uniquement.
Reprends le même design system (PAGE 00). Ne redesign pas le shell sauf si la fiche le demande.
Livre desktop 1440 + mobile 390 + états vide/loading/erreur + specs handoff Cursor.
```

## Prompt « refaire une page »

```text
Refais UNIQUEMENT la PAGE [NN] selon la fiche. Garde le design system.
Points à corriger : [liste]. Ne touche pas aux autres pages.
```
