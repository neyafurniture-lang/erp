# Cahier des charges — NEYA ERP v2

> Centre de contrôle complet de Neya Furniture. Amélioration incrémentale du projet existant — **ne pas repartir de zéro**.

## Vision

L'ERP devient le **système d'exploitation** de l'entreprise : CRM, fabrication, inventaire, achats, équipe, IA, intégrations Google, marketing, développement.

## Principes techniques

- **Architecture modulaire** : chaque intégration activable/désactivable (`modules_config`)
- **Permissions agents IA** : accès limité par module + journal d'audit
- **Confirmations** : suppressions, envois mail, modifications code → validation utilisateur
- **OAuth officiel** pour Google (Gmail, Drive)
- **VPS** : Docker, HTTPS, backups, reverse proxy, monitoring

---

## Déjà livré (MVP actuel)

| Module | Détail |
|--------|--------|
| **Auth & permissions** | Login, rôles, zones d'accès par section, gestion utilisateurs |
| **Dashboard** | Projets actifs, alertes, finances, tâches jour/semaine |
| **Production** | Vue atelier, priorités, cartes projets |
| **Projets** | Workspace modulaire (tâches, matériaux depuis devis, Drive, Mail, plan 3D basique) |
| **Calendrier / Équipe** | Shifts, tâches atelier, drag-and-drop, **édition au clic** (horaires, titre, etc.) |
| **Gestion admin** | Marchés, factures, site web, pub/SEO, tâches admin + sync factures/site |
| **Achats atelier** | Liste consommables manquants, import stock bas, cycle à acheter → commandé → reçu |
| **Stock** | Inventaire par catégories, alertes stock bas |
| **Factures / devis** | PDF style NEYA/Sierra, suivi paiements |
| **Clients, dépenses, standards** | CRM de base, catalogue produits |
| **Site web** | Sync WooCommerce, commandes → projets |
| **Google Drive** | OAuth, explorateur `/drive`, dossier par projet, arborescence dans l'IA |
| **Gmail** | OAuth, inbox `/mail`, liaison emails ↔ projet |
| **Assistant IA** | Chat, skills, actions ERP, contexte Drive injecté |
| **Connexion** | Mémorisation mot de passe (option) |

---

## Phases de livraison — statut réel

| Phase | Contenu | Statut |
|-------|---------|--------|
| **A** | Design system, dashboard projets, espace projet modulaire | **Partiel** — base OK, polish Linear/Notion à poursuivre |
| **B** | Stock, achats, fournisseurs, coûts production, rentabilité | **Partiel** — stock + achats atelier OK ; rentabilité avancée manquante |
| **C** | Équipe, shifts, planning, tâches avancées | **Partiel** — Mehdi/Olive, calendrier OK ; dépendances tâches, planning IA manquants |
| **D** | IA évolutive (mémoire, feedback, RAG ERP, dictée vocale) | **Partiel** — chat + skills ; RAG complet, micro, feedback loop manquants |
| **E** | Google Drive explorateur + liaison projet | **Partiel** — explorateur + lien projet ; **tri/catégorisation IA manquante** |
| **F** | Gmail + liaison email ↔ projet | **Partiel** — inbox + liaison ; workflows auto (devis→mail) manquants |
| **G** | Visualiseur 3D (GLB/STEP, SolidWorks via Drive) | **À faire** |
| **H** | Marketing Meta (FB/IG/Ads) + **gestion posts réseaux** | **À faire** |
| **I** | Espace Développement (IDE + Git + terminal) + **liste tâches dev** | **À faire** |
| **J** | Agents spécialisés (commercial, fabrication, compta, marketing, dev) | **À faire** |
| **K** | Déploiement VPS production | **À faire** |

---

## Backlog — demandes explicites non encore développées

### 🔴 Priorité haute (demande récente)

#### 1. IA + tri & rangement Google Drive
L'assistant doit **demander à l'utilisateur de trier le Drive** et permettre de **décrire les éléments** pour que l'IA puisse les **ranger et catégoriser** automatiquement.

Cibles typiques :
- **Photos de production** (avant/après, détail, ambiance)
- **Fichiers 3D** (GLB, STEP, exports SolidWorks)
- **Plans / PDF techniques**
- **Documents client / devis scannés**

Fonctionnalités à concevoir :
- Mode « session de rangement » guidé par l'IA (fichier par fichier ou par lot)
- Formulaire description → tags, dossier cible, liaison projet
- Règles de nommage NEYA (ex. `PROJET_type_date`)
- Déplacement réel dans Drive via API + validation utilisateur
- Détection doublons / fichiers orphelins

#### 2. Gestion des posts réseaux sociaux
Module pour **planifier, rédiger et suivre les publications** (Facebook, Instagram, etc.) :
- Calendrier éditorial
- Brouillons de posts (texte + médias depuis Drive/stock photos)
- Statut : idée → brouillon → programmé → publié
- Lien avec tâches admin « Pub & SEO »
- Intégration Meta API (phase H) — à terme

#### 3. Espace Dev + liste de tâches développement
Dans l'ERP, un module **Développement** avec :
- **Liste de tâches dev** (bugs, features, dette technique)
- Priorité, statut, lien module ERP concerné
- Plus tard : éditeur code, Git, terminal intégré (phase I complète)

---

### 🟠 Fonctionnalités cahier initial — reste à faire

| # | Module | Détail manquant |
|---|--------|-----------------|
| 1 | **Visualiseur 3D** | Viewer GLB/STEP dans projet, lecture fichiers depuis Drive |
| 2 | **IA vocale** | Dictée micro → transcription → commande assistant |
| 3 | **IA mémoire / RAG** | Mémoire long terme, feedback utilisateur, contexte ERP complet |
| 4 | **Agents spécialisés** | Commercial, fabrication, compta, marketing, dev — outils séparés |
| 5 | **Rentabilité** | Tableau CA, marge, heures, capacité, prévisions temps réel |
| 6 | **Tâches intelligentes** | Dépendances entre tâches, suggestion planning IA |
| 7 | **Achats avancés** | Créer bon de commande fournisseur depuis liste « à acheter », regroupement IA |
| 8 | **Fournisseurs** | UI complète gestion fournisseurs (CRUD existe en API) |
| 9 | **Inventaire** | Ajout/édition articles depuis UI, mouvements stock |
| 10 | **Gmail workflows** | Créer devis/facture depuis email, réponses suggérées |
| 11 | **Admin avancé** | Rappels échéance, tâches récurrentes (marchés mensuels) |
| 12 | **Meta Ads** | Campagnes publicitaires, stats, liaison dépenses |
| 13 | **VPS production** | Docker Compose, HTTPS, backups auto, monitoring |
| 14 | **Modules on/off** | UI Paramètres pour activer/désactiver chaque intégration |
| 15 | **Audit agents IA** | Journal des actions IA sensibles + confirmations |
| 16 | **OAuth Google** | Test end-to-end production (credentials, refresh token) |
| 17 | **Design polish** | Sidebar, cartes, densité Linear/Notion sur tout l'ERP |
| 18 | **Mobile** | Expérience atelier optimisée téléphone (production, tâches) |

---

### 🟡 Idées mentionnées — à structurer plus tard

- Plateforme devis/factures/projets standalone (vision long terme)
- Organisation vacances équipe (Olive)
- Intégration planning sous-traitants (ex. peinture ZNNS)
- Idée « plateforme tacos » / évolutions site web spécifiques
- Lien factures admin ↔ relances clients automatiques
- Sync matériaux projet → liste achats automatique

---

## Prochaines étapes suggérées (ordre logique)

1. **Drive + IA rangement** — gros gain quotidien atelier (photos, 3D)
2. **Visualiseur 3D** dans projet — complément naturel des fichiers Drive
3. **Posts réseaux** — module léger (liste + calendrier) avant API Meta
4. **Tâches dev** — module simple dans `/dev` avant IDE intégré
5. **Rentabilité projet** — dashboard financier production
6. **VPS** — quand le MVP métier est stable

---

*Document vivant — mis à jour le 7 juillet 2026.*
