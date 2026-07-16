/**
 * Manuel NEYA ERP — source unique (API, assistant, page /manual)
 */

export const ERP_MANUAL_VERSION = '1.0';

export const ERP_MANUAL_SECTIONS = [
  {
    id: 'demarrage',
    title: 'Démarrage',
    icon: '🚀',
    summary: 'Connexion, navigation, permissions utilisateur.',
    links: [
      { href: '/login', label: 'Connexion' },
      { href: '/', label: 'Dashboard' },
      { href: '/settings', label: 'Paramètres' },
    ],
    tips: [
      'Chaque utilisateur voit uniquement les modules autorisés (admin = tout).',
      'Sur mobile : barre du bas + menu « Plus » pour Drive, Courriel, Paramètres.',
      'L’assistant (orbe en bas à droite) fonctionne sur toutes les pages — Parler, Écrire ou Joindre un fichier.',
    ],
  },
  {
    id: 'assistant',
    title: 'Assistant IA & commandes',
    icon: '🤖',
    summary: 'Orbe vocal, skills, pièces jointes, planification.',
    links: [
      { href: '/manual#assistant', label: 'Cette section' },
      { href: '/settings?tab=assistant', label: 'Clés IA (Claude/OpenAI)' },
      { href: '/settings?tab=skills', label: 'Gérer les skills' },
    ],
    tips: [
      'Parler : enregistrez → révisez le texte → « Construire le plan » → confirmez.',
      'Exemples : « Demain finition banc olive Mehdi, mail client », « Cocher débitage », « Dépense 120$ matériaux ».',
      'Joindre 📎 : photos, PDF, plans, reçus — l’IA peut lire l’image (scan ticket, facture).',
      'Sur une fiche projet/client, l’assistant connaît le contexte automatiquement.',
      'Dites « manuel », « aide ERP » ou « comment faire » pour ouvrir ce guide.',
    ],
  },
  {
    id: 'production',
    title: 'Production & projets',
    icon: '🏭',
    summary: 'File atelier, bancs catalogue, projets sur mesure.',
    links: [
      { href: '/production', label: 'Production' },
      { href: '/projects', label: 'Projets' },
      { href: '/sauna-cloud', label: 'Sauna Cloud' },
      { href: '/standards', label: 'Fiches standards' },
    ],
    tips: [
      'Production : bancs catalogue (fiche standard) vs sur mesure (checklist libre).',
      'Avancer une étape met à jour les tâches et le calendrier.',
      'Chaque projet peut avoir client, budget, deadline, tâches, dépenses, courriels liés.',
      'Depuis une fiche standard : « Créer projet depuis cette fiche ».',
      'Sauna Cloud (/sauna-cloud) : liste des frames à fabriquer, cocher pour l’avancement %, notes par frame et notes projet. Permission Production.',
    ],
  },
  {
    id: 'calendrier',
    title: 'Calendrier & équipe',
    icon: '📅',
    summary: 'Planning, tâches planifiées, congés.',
    links: [
      { href: '/calendar', label: 'Calendrier' },
      { href: '/team', label: 'Équipe' },
    ],
    tips: [
      'Planifier via l’assistant : « Demain 9h débitage projet X ».',
      'Congés : calendrier → « Ajouter un congé » (lié au profil employé dans Utilisateurs).',
      'Les tâches avec horaire apparaissent dans la vue semaine.',
    ],
  },
  {
    id: 'courriel',
    title: 'Courriel (Gmail)',
    icon: '✉️',
    summary: 'Boîte intégrée, scan factures, synthèse IA des fils.',
    links: [
      { href: '/mail', label: 'Courriel' },
      { href: '/settings?tab=integrations', label: 'Connecter Google' },
    ],
    tips: [
      'Première fois : Paramètres → Intégrations → Connecter Google (Gmail + Drive).',
      'Ouvrir un message → panneau Contexte ERP : liaison auto client (email ou nom) + projet, puis synthèse IA.',
      'Si la synthèse échoue : Paramètres → Assistant IA activé + clé Claude ou OpenAI. Bouton « Synthèse » pour relancer.',
      'Renseigner l’email sur la fiche client améliore le lien automatique des fils.',
      'Brouillons IA et envois devis/facture utilisent la signature Mehdi (company.json → emailSignature).',
      '« Analyser (20) » : pré-traite les derniers fils (liaison auto + base conversation).',
      'Scan factures fournisseurs (Home Depot, Rona…) : file en haut de la page Courriel.',
      'Erreur 404 ? Le backend VPS doit être à jour (Paramètres → Déploiement VPS).',
    ],
  },
  {
    id: 'drive',
    title: 'Google Drive',
    icon: '📁',
    summary: 'Explorateur fichiers, accès par utilisateur.',
    links: [
      { href: '/drive', label: 'Drive' },
      { href: '/settings?tab=users', label: 'Accès Drive par utilisateur' },
    ],
    tips: [
      'Admin : accès complet. Autres utilisateurs : dossiers limités (projet/client) dans Utilisateurs.',
      'Prévisualisation PDF, images, vidéos. Fichiers Google Docs ouverts via lien externe.',
      'Modèles 3D : exporter SolidWorks en GLB pour aperçu navigateur.',
    ],
  },
  {
    id: 'depenses',
    title: 'Dépenses & tickets',
    icon: '🧾',
    summary: 'Scan reçus, classement, Drive.',
    links: [
      { href: '/expenses', label: 'Dépenses' },
    ],
    tips: [
      'Scanner un ticket → IA extrait montant, taxes, fournisseur → confirmer → dépense + option Drive.',
      'Catégories : matériaux, outils, transport, atelier, admin.',
      'Lier au projet lors de la confirmation pour le suivi marge.',
    ],
  },
  {
    id: 'finance',
    title: 'Factures & devis',
    icon: '💰',
    summary: 'Devis, factures, envoi courriel client.',
    links: [
      { href: '/invoices', label: 'Factures & devis' },
      { href: '/clients', label: 'Clients' },
    ],
    tips: [
      'Client doit avoir un courriel pour l’envoi PDF.',
      'Assistant : « Créer devis », « Envoyer facture », « Convertir devis ».',
      'Lignes devis/facture : tableau éditable (Entrée = nouvelle ligne, coller depuis Excel/Sheets).',
      'Liste factures : colonnes Déjà payé et Reste. Bouton Paiement → options rapides (solde, 50 %, 30 %, Interac…).',
      'Fiche facture : barre de progression, historique des paiements, suppression d’un paiement si erreur.',
    ],
  },
  {
    id: 'achats',
    title: 'Achats & stock',
    icon: '🛒',
    summary: 'Liste de courses, besoins atelier, inventaire.',
    links: [
      { href: '/liste-courses', label: 'Liste de courses' },
      { href: '/purchases', label: 'Achats atelier' },
      { href: '/inventory', label: 'Stock' },
    ],
    tips: [
      'Liste de courses : besoins consommables à commander.',
      'Achats atelier : bons de commande fournisseurs.',
    ],
  },
  {
    id: 'commercial',
    title: 'Clients & site web',
    icon: '🌐',
    summary: 'CRM, standards, sync WooCommerce.',
    links: [
      { href: '/clients', label: 'Clients' },
      { href: '/web', label: 'Site web' },
    ],
    tips: [
      'Email client = liaison auto des courriels + envoi devis/factures.',
      'Site web : sync produits, commandes, photos depuis neyafurniture.ca.',
      'Assistant : « sync site », « commandes web ».',
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    icon: '⚙️',
    summary: 'Utilisateurs, déploiement, rollback.',
    links: [
      { href: '/settings?tab=users', label: 'Utilisateurs' },
      { href: '/settings?tab=deploy', label: 'Déploiement VPS' },
      { href: '/settings?tab=integrations', label: 'Intégrations' },
      { href: '/roadmap', label: 'Roadmap' },
    ],
    tips: [
      'Déploiement : quand le local fonctionne → générer package ZIP + script VPS.',
      'Site planté ? SSH : back.sh (restaure backup DB + commit précédent).',
      'Clés Claude/OpenAI dans Paramètres → Assistant IA (sinon skills par mots-clés seulement).',
    ],
  },
];

export const ERP_MANUAL_SKILL_INSTRUCTION = `Tu es l'assistant NEYA ERP. Quand l'utilisateur demande de l'aide, le manuel, « comment faire », ou une fonctionnalité obscure :
1. Réponds en français, court et actionnable (2-5 phrases).
2. Indique le lien ERP pertinent (/manual, /mail, /settings?tab=integrations, etc.).
3. Pour Courriel : rappeler connexion Google + bouton Analyser + panneau Assistant ERP.
4. Pour déploiement/404 : Paramètres → Déploiement VPS ou commande back.sh sur le serveur.
5. Propose d'ouvrir le manuel complet : /manual`;

export function getManualForApi() {
  return {
    version: ERP_MANUAL_VERSION,
    title: 'Manuel NEYA ERP',
    sections: ERP_MANUAL_SECTIONS,
    skill_instruction: ERP_MANUAL_SKILL_INSTRUCTION,
  };
}

export function getManualPromptBlock() {
  const lines = ERP_MANUAL_SECTIONS.map(s =>
    `- ${s.title} (${s.id}): ${s.summary} → liens: ${(s.links || []).map(l => l.href).join(', ')}`
  );
  return `MANUEL NEYA (résumé — renvoyer vers /manual pour le détail):\n${lines.join('\n')}\n\n${ERP_MANUAL_SKILL_INSTRUCTION}`;
}

export function findManualTopic(message) {
  const lower = String(message || '').toLowerCase();
  const keywords = {
    courriel: ['mail', 'courriel', 'gmail', 'email', 'facture fournisseur', 'scan mail'],
    assistant: ['assistant', 'vocal', 'orbe', 'parler', 'skill', 'commande vocale'],
    drive: ['drive', 'dossier', 'fichier', 'google drive'],
    depenses: ['dépense', 'depense', 'ticket', 'reçu', 'recu'],
    production: ['production', 'projet', 'tâche', 'tache', 'banc', 'finition', 'standard'],
    calendrier: ['calendrier', 'congé', 'conge', 'planning', 'planifier'],
    admin: ['deploy', 'déploiement', 'deploiement', 'vps', '404', 'planté', 'plante', 'backup', 'rollback', 'back.sh'],
    finance: ['devis', 'facture client', 'invoice', 'paiement'],
    demarrage: ['connexion', 'login', 'mot de passe', 'permission'],
    achats: ['liste de courses', 'achat atelier', 'stock', 'inventaire'],
    commercial: ['woocommerce', 'site web', 'commande web', 'client'],
  };
  for (const [sectionId, words] of Object.entries(keywords)) {
    if (words.some(w => lower.includes(w))) {
      return ERP_MANUAL_SECTIONS.find(s => s.id === sectionId) || null;
    }
  }
  return null;
}

export function buildManualReply(message) {
  const lower = String(message || '').toLowerCase();
  if (/manuel|aide erp|guide|tuto|comment (faire|utiliser)|help/i.test(lower)) {
    return {
      reply: `Le manuel complet est sur /manual — ${ERP_MANUAL_SECTIONS.length} sections : démarrage, assistant, production, courriel, Drive, dépenses, finance, admin…\n\nPosez une question précise (ex. « comment connecter Gmail ») ou ouvrez le manuel.`,
      href: '/manual',
      section: null,
    };
  }
  const topic = findManualTopic(message);
  if (topic) {
    const tips = topic.tips.slice(0, 4).map((t, i) => `${i + 1}. ${t}`).join('\n');
    const links = topic.links.map(l => `• ${l.label} → ${l.href}`).join('\n');
    return {
      reply: `**${topic.title}**\n\n${topic.summary}\n\n${tips}\n\nAccès rapides :\n${links}\n\nManuel complet : /manual#${topic.id}`,
      href: `/manual#${topic.id}`,
      section: topic.id,
    };
  }
  return {
    reply: `Je peux vous guider — essayez « manuel courriel », « aide dépenses », ou ouvrez /manual.\n\nRaccourcis : Production /projects, Courriel /mail, Paramètres /settings.`,
    href: '/manual',
    section: null,
  };
}
