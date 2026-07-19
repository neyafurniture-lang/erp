import * as drive from './google-drive.js';
import { filterSearchResults, getRequestUser, resolveDriveRoots } from './drive-access.js';

const PLATFORMS = ['instagram', 'facebook', 'pinterest', 'tiktok', 'linkedin'];

/** Termes typiques factures / admin — JAMAIS proposés en post social. */
const REJECT_NAME = /\b(facture|invoice|devis|quote|soumission|re[cç]u|receipt|ticket|caisse|paiement|payment|commande\s*#|order\s*#|bon\s*de|contrat|statement|tps|tvq|gst|qst|admin|compta|accounting|po\s*\d|bill|remboursement|refund|fournisseur|supplier|scan[-_]?doc|document)\b/i;

const REJECT_PATH_HINT = /\b(facture|invoice|devis|admin|compta|accounting|finance|fournisseur|receipts?|tickets?|documents?)\b/i;

const PRODUCT_BOOST = /\b(final|livr|showroom|hero|cover|beauty|produit|product|table|buffet|banquette|sauna|banc|chaise|etagere|meuble|atelier|detail|finition|assemblage|bois|oak|walnut|noyer|chene)\b/i;

const WEAK_REJECT = /\b(avant|raw|tmp|test|screenshot|capture|plan|dwg|pdf|wireframe|mockup|screenshot|ecran)\b/i;

const CAPTION_TEMPLATES = [
  (name) => `Pièce d’atelier NEYA — ${cleanName(name)}\nFait main au Québec\n\n#NeyaFurniture #FaitMain #AtelierQuebec #MobilierSurMesure`,
  (name) => `Nouveau regard sur ${cleanName(name)}.\nBois, précision, chaleur — fabriqué dans notre atelier.\n\nneyafurniture.ca\n#Menuiserie #DesignInterieur #Neya`,
  (name) => `Derrière chaque pièce, des heures d’atelier.\n${cleanName(name)} — disponible / sur commande.\n\n#Woodworking #CustomFurniture #NeyaFurniture`,
  (name) => `Détail qui change tout.\n${cleanName(name)}\n\nEnregistrez pour plus tard · partagez à quelqu’un qui aime le bois massif.`,
];

function cleanName(name) {
  return String(name || 'pièce NEYA')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'pièce NEYA';
}

function isRejectedMedia(file) {
  const name = String(file.name || '');
  if (REJECT_NAME.test(name)) return { reject: true, reason: 'document_admin' };
  // Chemin / parents parfois dans name composé
  if (REJECT_PATH_HINT.test(name) && !PRODUCT_BOOST.test(name)) {
    return { reject: true, reason: 'dossier_admin' };
  }
  if (!file.mimeType?.startsWith('image/')) {
    return { reject: true, reason: 'not_image' };
  }
  // Miniatures PDF / icônes Drive
  if (/application\/pdf|google-apps/i.test(file.mimeType || '')) {
    return { reject: true, reason: 'pdf' };
  }
  return { reject: false };
}

/**
 * Analyse une photo pour le publishing social (type Buffer / Later).
 * Score 0–100 + verdict produit vs document.
 */
export function analyzePhoto(file) {
  const rejected = isRejectedMedia(file);
  if (rejected.reject) {
    return {
      suitable: false,
      score: 0,
      verdict: 'reject',
      reason: rejected.reason,
      labels: ['exclu'],
      platforms_ok: [],
      aspect: null,
      width: file.imageWidth || null,
      height: file.imageHeight || null,
    };
  }

  const name = String(file.name || '');
  let score = 40;
  const labels = [];

  if (PRODUCT_BOOST.test(name)) {
    score += 25;
    labels.push('produit');
  }
  if (WEAK_REJECT.test(name)) {
    score -= 30;
    labels.push('faible');
  }
  if (file.thumbnailLink) {
    score += 8;
    labels.push('apercu');
  }

  const w = Number(file.imageWidth) || 0;
  const h = Number(file.imageHeight) || 0;
  let aspect = null;
  if (w > 0 && h > 0) {
    aspect = Math.round((w / h) * 100) / 100;
    if (Math.min(w, h) >= 1080) {
      score += 15;
      labels.push('hd');
    } else if (Math.min(w, h) >= 800) {
      score += 8;
      labels.push('ok');
    } else if (Math.min(w, h) > 0 && Math.min(w, h) < 600) {
      score -= 20;
      labels.push('basse_res');
    }
    // Instagram portrait / carré / paysage
    if (aspect >= 0.8 && aspect <= 1.25) {
      score += 8;
      labels.push('carre');
    } else if (aspect >= 0.7 && aspect <= 0.9) {
      score += 10;
      labels.push('portrait_ig');
    } else if (aspect > 1.6) {
      score -= 5;
      labels.push('paysage');
    }
  }

  const ageDays = file.modifiedTime
    ? (Date.now() - new Date(file.modifiedTime).getTime()) / 86400000
    : 999;
  if (ageDays < 45) {
    score += 10;
    labels.push('recent');
  } else if (ageDays > 365) {
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));
  const suitable = score >= 45 && !labels.includes('faible');
  const platforms_ok = [];
  if (suitable) {
    platforms_ok.push('instagram', 'facebook');
    if (aspect == null || aspect <= 1.2) platforms_ok.push('pinterest');
    if (aspect == null || aspect >= 0.5) platforms_ok.push('tiktok');
  }

  return {
    suitable,
    score,
    verdict: suitable ? (score >= 70 ? 'excellent' : 'ok') : 'weak',
    reason: suitable ? null : 'score_faible',
    labels,
    platforms_ok,
    aspect,
    width: w || null,
    height: h || null,
  };
}

function buildCaption(fileOrName, index = 0) {
  const tpl = CAPTION_TEMPLATES[index % CAPTION_TEMPLATES.length];
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name;
  return tpl(name);
}

function nextSlot(index = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1 + Math.floor(index / 2));
  d.setHours(index % 2 === 0 ? 10 : 18, 0, 0, 0);
  return d.toISOString();
}

function localWeekProposals(limit = 6) {
  const topics = [
    { title: 'Banc atelier', focus: 'banc en bois massif' },
    { title: 'Détail assemblage', focus: 'assemblage à tenon' },
    { title: 'Table sur mesure', focus: 'table sur mesure' },
    { title: 'Finition huilée', focus: 'finition huile naturelle' },
    { title: 'Livraison client', focus: 'livraison et installation' },
    { title: 'Coulisses atelier', focus: 'coulisses de l’atelier NEYA' },
  ];
  return topics.slice(0, limit).map((t, i) => ({
    key: `local-${i}-${t.title}`,
    platforms: i % 3 === 0 ? ['instagram', 'facebook', 'pinterest'] : ['instagram', 'facebook'],
    title: t.title,
    caption: buildCaption(t.focus, i),
    scheduled_at: nextSlot(i),
    media: [],
    source: 'local_template',
    score: 60,
    analysis: { suitable: true, score: 60, verdict: 'template', labels: ['template'] },
  }));
}

/**
 * Bibliothèque médias : photos Drive analysées (produit vs facture/doc).
 */
export async function listAnalyzedMedia(req, { limit = 24, query = null } = {}) {
  const user = await getRequestUser(req);
  let files = [];
  let driveError = null;

  try {
    // Recherche par nom uniquement — pas fullText OCR (évite les scans de factures)
    const recent = await drive.listRecentImages({
      pageSize: Math.min(Math.max(Number(limit) * 3, 40), 50),
      query: query || null,
      nameOnly: true,
    });
    files = await filterSearchResults(user, recent.files || []);
  } catch (err) {
    driveError = err.message || 'Drive indisponible';
  }

  const items = [];
  let rejected = 0;
  for (const f of files) {
    if (!f.mimeType?.startsWith('image/') || f.isFolder) continue;
    const analysis = analyzePhoto(f);
    if (!analysis.suitable) {
      rejected += 1;
      continue;
    }
    items.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      thumbnailLink: f.thumbnailLink,
      webViewLink: f.webViewLink,
      modifiedTime: f.modifiedTime,
      size: f.size,
      analysis,
    });
  }

  items.sort((a, b) => (b.analysis.score || 0) - (a.analysis.score || 0));

  return {
    items: items.slice(0, Math.min(Number(limit) || 24, 48)),
    rejected_count: rejected,
    drive_ready: !driveError,
    error: driveError,
    hint: driveError
      ? 'Connectez Google Drive pour analyser vos photos produit.'
      : rejected
        ? `${rejected} fichier(s) exclus (factures, reçus, documents, plans…).`
        : null,
  };
}

/**
 * Propose des posts uniquement depuis photos produit analysées.
 */
export async function proposePostsFromDrive(req, { limit = 6, query = null } = {}) {
  const media = await listAnalyzedMedia(req, { limit: Math.max(Number(limit) * 2, 12), query });
  const pool = (media.items || []).slice(0, Math.min(Number(limit) || 6, 12));

  if (!pool.length) {
    return {
      proposals: localWeekProposals(limit),
      drive_ready: media.drive_ready,
      error: media.error || null,
      hint: media.hint
        || 'Aucune photo produit trouvée — modèles locaux proposés. Placez vos photos finales dans Drive (évitez les dossiers Factures).',
      rejected_count: media.rejected_count || 0,
      platforms: PLATFORMS,
    };
  }

  const roots = await resolveDriveRoots(await getRequestUser(req)).catch(() => null);

  const proposals = pool.map((file, i) => ({
    key: `drive-${file.id}-${i}`,
    platforms: file.analysis.platforms_ok?.length
      ? file.analysis.platforms_ok.filter(p => PLATFORMS.includes(p)).slice(0, 3)
      : ['instagram', 'facebook'],
    title: cleanName(file.name),
    caption: buildCaption(file, i),
    scheduled_at: nextSlot(i),
    media: [{
      drive_file_id: file.id,
      name: file.name,
      thumbnailLink: file.thumbnailLink,
      webViewLink: file.webViewLink,
      mimeType: file.mimeType,
      analysis: file.analysis,
    }],
    source: 'drive_auto',
    score: file.analysis.score,
    analysis: file.analysis,
  }));

  return {
    proposals,
    drive_ready: true,
    roots_count: roots?.roots?.length ?? null,
    rejected_count: media.rejected_count || 0,
    platforms: PLATFORMS,
    hint: media.rejected_count
      ? `${media.rejected_count} document(s)/facture(s) exclus automatiquement.`
      : null,
  };
}

export { PLATFORMS, buildCaption, cleanName, localWeekProposals, isRejectedMedia };
