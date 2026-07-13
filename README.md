# NEYA ERP MVP

ERP artisanal pour atelier de fabrication de meubles — **NEYA Furniture**.

## Modules

| Module | Description |
|--------|-------------|
| **Dashboard** | CA, dépenses, profit, tâches du jour |
| **Projets** | CRUD, checklist sur mesure, réordonnancement tâches |
| **Calendrier** | Drag & drop (projets catalogue + option custom) |
| **Facturation** | Devis, factures, PDF, envoi courriel, conversion |
| **Dépenses** | Suivi par catégorie, lien projet |
| **Standards** | Fiches fabrication, PDF remplissable, sync WooCommerce |
| **Clients** | Fiche détail, devis/factures/projets |
| **Assistant** | Chat contextuel + skills extensibles + IA optionnelle |
| **Paramètres** | API, OpenAI, SMTP, WordPress, skills, mot de passe |

## Installation locale

```bash
docker-compose up -d          # PostgreSQL
cd backend && cp .env.example .env && npm install && npm run dev
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

- App : http://localhost:3000  
- API : http://localhost:4000  
- Login : `admin@neya.local` / `neya2024`

## Production (Docker)

```bash
cp backend/.env.example backend/.env   # éditer secrets
docker compose -f docker-compose.prod.yml up -d --build
```

## Lien site web (neyafurniture.ca)

1. **WooCommerce** → Réglages → Avancé → REST API → Créer une clé (lecture)
2. **Paramètres → Site web** : URL `https://neyafurniture.ca`, coller clé + secret
3. **Tester connexion** puis **Synchroniser** — lie les produits WooCommerce aux fiches ERP par SKU
4. Les fiches standards affichent photo + lien vers le produit web

Via chat : `sync site` ou `sync wordpress`

## Courriel (devis / factures)

**Paramètres → Courriel** : SMTP (ex. Gmail app password, SendGrid…)

Depuis une fiche devis/facture : bouton **Envoyer par courriel**  
Via chat : `envoyer devis` / `envoyer facture` (sur fiche client)

## Assistant & skills

- Chat avec **contexte de page** (projet, client, fiche)
- **Paramètres → Skills** : créer/modifier les commandes
- **Paramètres → Assistant IA** : clé OpenAI pour langage naturel

Exemples :
```
Cocher finition
Créer devis 2500$
Envoyer facture
Sync site
Deadline 15 juillet
```

## API principale

| Route | Description |
|-------|-------------|
| `PUT /api/auth/password` | Changer mot de passe |
| `GET/PUT /api/settings` | Paramètres ERP |
| `POST /api/wordpress/sync` | Sync WooCommerce |
| `GET/POST /api/assistant/*` | Chat + skills |
| `GET /api/invoices/quotes/:id` | Détail devis |
| `POST /api/invoices/quotes/:id/send` | Envoyer devis |
| `GET /api/invoices/:id` | Détail facture |
| `POST /api/invoices/:id/send` | Envoyer facture |
| CRUD `/api/projects`, `/api/tasks`, `/api/clients`… | |

## Stack

Next.js 14 · Express · PostgreSQL · pdf-lib · WooCommerce REST API
