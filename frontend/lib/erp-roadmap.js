/**
 * Source unique des points roadmap NEYA ERP (page /roadmap).
 * status: next | doing | backlog | done
 * impact: high | medium | low
 */

export const ROADMAP_AREAS = {
  atelier: { label: 'Atelier', cls: 'bg-orange-50 text-orange-800 border-orange-100' },
  ops: { label: 'Ops', cls: 'bg-stone-100 text-stone-700 border-stone-200' },
  comms: { label: 'Comms', cls: 'bg-sky-50 text-sky-800 border-sky-100' },
  growth: { label: 'Croissance', cls: 'bg-violet-50 text-violet-800 border-violet-100' },
  platform: { label: 'Plateforme', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
};

export const IMPACT_LABEL = {
  high: 'Impact fort',
  medium: 'Impact moyen',
  low: 'Plus tard',
};

/** Priorités lancables via Agent Cursor (ids = backend ROADMAP_ACTIONS) */
export const ROADMAP_NEXT = [
  {
    id: 'drive-ai-sort',
    label: 'IA + tri Google Drive',
    detail: 'Session guidée : décrire photos / 3D / plans → tags, dossier cible, liaison projet, renommage NEYA, déplacement avec confirmation.',
    why: 'Le Drive grossit vite ; un tri assisté évite de perdre les fichiers chantier.',
    impact: 'high',
    area: 'ops',
    launchable: true,
    href: '/drive',
  },
  {
    id: 'viewer-3d',
    label: 'Visualiseur 3D dans le projet',
    detail: 'Prévisualiser un GLB (depuis Drive) dans la fiche projet — preview simple, pas un CAD complet.',
    why: 'Voir le meuble sans quitter l’ERP, surtout en atelier / chez le client.',
    impact: 'high',
    area: 'atelier',
    launchable: true,
    href: '/projects',
  },
  {
    id: 'social-posts',
    label: 'Posts réseaux (FB / IG)',
    detail: 'Calendrier éditorial, brouillons, planification, statut publié — branché sur l’atelier (photos prod).',
    why: 'Transformer la prod en contenu sans outil externe séparé.',
    impact: 'medium',
    area: 'growth',
    launchable: true,
    href: '/admin',
  },
  {
    id: 'dev-space',
    label: 'Espace Dev (bugs & features)',
    detail: 'Liste interne bugs / features ERP (CRUD, priorités, statut), prête pour IDE / Git plus tard.',
    why: 'Centraliser ce qu’il reste à coder au lieu de notes dispersées.',
    impact: 'medium',
    area: 'platform',
    launchable: true,
    href: '/roadmap',
  },
];

/** En cours / quasi prêt (pas forcément agent) */
export const ROADMAP_DOING = [
  {
    id: 'po-from-needs',
    label: 'Bons de commande depuis les achats',
    detail: 'Créer un BC par fournisseur depuis les besoins « À acheter », puis marquer commandé / reçu.',
    why: 'Boucler liste courses → commande → stock sans Excel.',
    impact: 'high',
    area: 'ops',
    href: '/purchases',
  },
  {
    id: 'design-lovable',
    label: 'Design system Lovable → UI ERP',
    detail: 'Porter le sheet Lovable (shell, mail, dashboard, projets) écran par écran dans le frontend actuel.',
    why: 'Look produit ~20k$ sans casser les APIs métier.',
    impact: 'high',
    area: 'platform',
    href: '/mail',
  },
  {
    id: 'mail-actions',
    label: 'Actions depuis synthèse mail',
    detail: 'Transformer les « À faire » IA du panneau ERP en tâches projet / créneaux calendrier en 1 tap.',
    why: 'Le courriel devient du travail atelier, pas seulement de la lecture.',
    impact: 'high',
    area: 'comms',
    href: '/mail',
  },
];

export const ROADMAP_BACKLOG = [
  {
    id: 'voice-ia',
    label: 'IA vocale atelier (micro → commandes)',
    detail: 'Mode Parler plus robuste : bruit atelier, confirmation claire, actions production / courses.',
    why: 'Mains occupées → dicter plutôt que taper.',
    impact: 'high',
    area: 'atelier',
  },
  {
    id: 'rag-memory',
    label: 'Mémoire IA / RAG complet',
    detail: 'Indexer manuels, projets, mails, standards pour réponses contextualisées durablement.',
    why: 'L’assistant « se souvient » de l’atelier Neya, pas seulement du dernier message.',
    impact: 'medium',
    area: 'platform',
  },
  {
    id: 'agents-specialized',
    label: 'Agents spécialisés',
    detail: 'Compta, fab, marketing, commercial — permissions, confirmations, skills dédiés.',
    why: 'Moins d’erreurs : chaque agent reste dans son métier.',
    impact: 'medium',
    area: 'platform',
    launchable: true,
  },
  {
    id: 'meta-ads',
    label: 'Meta Ads + stats',
    detail: 'Suivi campagnes FB/IG et indicateurs simples dans l’ERP.',
    why: 'Lier pub et commandes / leads sans quitter Neya.',
    impact: 'low',
    area: 'growth',
  },
  {
    id: 'profit-board',
    label: 'Tableau rentabilité temps réel',
    detail: 'Marge par projet (main-d’œuvre + matériaux + dépenses) vs devis / facture.',
    why: 'Savoir si un job est rentable avant la livraison.',
    impact: 'high',
    area: 'ops',
  },
  {
    id: 'gmail-workflows',
    label: 'Workflows Gmail → devis',
    detail: 'Depuis un courriel client : créer / préremplir un devis et lier le fil.',
    why: 'Accélérer le commercial sans copier-coller.',
    impact: 'high',
    area: 'comms',
  },
  {
    id: 'admin-recurring',
    label: 'Rappels & tâches admin récurrentes',
    detail: 'Tâches admin périodiques (taxes, assurances, pub, SEO) avec rappels.',
    why: 'Ne plus rater les obligations hors atelier.',
    impact: 'medium',
    area: 'ops',
    href: '/admin',
  },
  {
    id: 'suppliers-stock-ui',
    label: 'UI fournisseurs & mouvements stock',
    detail: 'CRUD fournisseurs + entrées/sorties stock liées aux BC et projets.',
    why: 'Inventaire fiable, pas seulement une liste d’articles.',
    impact: 'medium',
    area: 'ops',
    href: '/inventory',
  },
  {
    id: 'modules-toggle',
    label: 'Modules on/off dans Paramètres',
    detail: 'Activer / masquer Sauna Cloud, Plans de coupe, Site web, etc. selon l’équipe.',
    why: 'Simplifier la nav pour les artisans.',
    impact: 'low',
    area: 'platform',
    href: '/settings',
  },
  {
    id: 'https-domain',
    label: 'Durcir HTTPS / backups VPS',
    detail: 'Vérifier Caddy, DNS, backups auto et restore documentés (prod déjà en ligne).',
    why: 'Tranquillité ops : reprise après incident.',
    impact: 'medium',
    area: 'platform',
    launchable: true,
  },
];

export const ROADMAP_DONE = [
  {
    id: 'done-cutting',
    label: 'Plans de coupe (studio CutList)',
    detail: 'Planches 8 pi + panneaux 4×8, optimiser, PDF, lien projet.',
    area: 'atelier',
    href: '/cutting-plans',
  },
  {
    id: 'done-mail',
    label: 'Courriel Gmail (mobile + tri NEYA)',
    detail: 'Liste → lecture, sheet ERP, polish premium, tri À répondre / Clients / Fournisseurs.',
    area: 'comms',
    href: '/mail',
  },
  {
    id: 'done-production',
    label: 'Production + projets + calendrier',
    detail: 'Catalogue / sur mesure, étapes, planning semaine, shifts.',
    area: 'atelier',
    href: '/production',
  },
  {
    id: 'done-sauna',
    label: 'Sauna Cloud (frames)',
    detail: 'Checklist frames + avancement %.',
    area: 'atelier',
    href: '/sauna-cloud',
  },
  {
    id: 'done-purchases',
    label: 'Achats atelier & liste de courses',
    detail: 'Besoins consommables, édition inline, liens prix magasins.',
    area: 'ops',
    href: '/liste-courses',
  },
  {
    id: 'done-drive',
    label: 'Drive + permissions + assistant',
    detail: 'Explorateur Drive, rôles, orbe IA (parler / écrire / joindre).',
    area: 'ops',
    href: '/drive',
  },
  {
    id: 'done-billing',
    detail: 'Devis / factures, taxes QC, envoi Gmail, dépenses séparées.',
    label: 'Facturation & dépenses',
    area: 'ops',
    href: '/invoices',
  },
  {
    id: 'done-admin',
    label: 'Session admin + site + roadmap',
    detail: 'PIN admin, tâches P0/P1/P2, bridge WordPress, page roadmap.',
    area: 'platform',
    href: '/admin',
  },
  {
    id: 'done-deploy',
    label: 'Déploiement VPS (Docker / HTTPS)',
    detail: 'Mise à jour en un clic, compose prod, domaine erp.neyafurniture.ca.',
    area: 'platform',
    href: '/settings',
  },
];
