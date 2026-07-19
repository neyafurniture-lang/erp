import * as drive from './google-drive.js';
import { filterSearchResults, getRequestUser, resolveDriveRoots } from './drive-access.js';

const PLATFORMS = ['instagram', 'facebook', 'pinterest', 'tiktok', 'linkedin'];

const CAPTION_TEMPLATES = [
  (name) => `✨ Pièce d’atelier NEYA — ${cleanName(name)}\nFait main au Québec 🇨🇦\n\n#NeyaFurniture #FaitMain #AtelierQuebec #MobilierSurMesure`,
  (name) => `Nouveau regard sur ${cleanName(name)}.\nBois, précision, chaleur — fabriqué dans notre atelier.\n\n👉 neyafurniture.ca\n#Menuiserie #DesignInterieur #Neya`,
  (name) => `Derrière chaque pièce, des heures d’atelier.\n${cleanName(name)} — disponible / sur commande.\n\n#Woodworking #CustomFurniture #NeyaFurniture`,
  (name) => `Détail qui change tout 👀\n${cleanName(name)}\n\nEnregistrez pour plus tard · partagez à quelqu’un qui aime le bois massif.`,
];

function cleanName(name) {
  return String(name || 'pièce NEYA')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'pièce NEYA';
}

function scorePhoto(file) {
  const n = (file.name || '').toLowerCase();
  let score = 0;
  if (/final|livr|showroom|hero|cover|beauty|produit|table|buffet|banquette|sauna/.test(n)) score += 3;
  if (/avant|raw|tmp|test|screenshot|capture|plan|dwg|pdf/.test(n)) score -= 4;
  if (file.thumbnailLink) score += 1;
  const ageDays = file.modifiedTime
    ? (Date.now() - new Date(file.modifiedTime).getTime()) / 86400000
    : 999;
  if (ageDays < 30) score += 2;
  else if (ageDays < 90) score += 1;
  return score;
}

function buildCaption(file, index = 0) {
  const tpl = CAPTION_TEMPLATES[index % CAPTION_TEMPLATES.length];
  return tpl(file.name);
}

function nextSlot(index = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1 + Math.floor(index / 2));
  d.setHours(index % 2 === 0 ? 10 : 18, 0, 0, 0);
  return d.toISOString();
}

/**
 * Cherche de belles photos Drive et propose des brouillons de posts cross-platform.
 */
export async function proposePostsFromDrive(req, { limit = 6, query = null } = {}) {
  const user = await getRequestUser(req);
  let files = [];

  try {
    const recent = await drive.listRecentImages({ pageSize: 40, query });
    files = await filterSearchResults(user, recent.files || []);
  } catch (err) {
    // Pas de Drive / OAuth : retourner propositions vides avec hint
    return {
      proposals: [],
      error: err.message || 'Drive indisponible',
      hint: 'Connectez Google Drive dans Paramètres → Intégrations pour les propositions auto.',
    };
  }

  const images = files
    .filter(f => f.mimeType?.startsWith('image/') && !f.isFolder)
    .map(f => ({ ...f, _score: scorePhoto(f) }))
    .filter(f => f._score >= 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, Math.min(Number(limit) || 6, 12));

  // Si peu de résultats filtrés, élargir
  let pool = images;
  if (pool.length < 3) {
    pool = files
      .filter(f => f.mimeType?.startsWith('image/'))
      .slice(0, Math.min(Number(limit) || 6, 12));
  }

  const roots = await resolveDriveRoots(user).catch(() => null);

  const proposals = pool.map((file, i) => ({
    key: `drive-${file.id}-${i}`,
    platforms: i % 3 === 0 ? ['instagram', 'facebook', 'pinterest'] : ['instagram', 'facebook'],
    title: cleanName(file.name),
    caption: buildCaption(file, i),
    scheduled_at: nextSlot(i),
    media: [{
      drive_file_id: file.id,
      name: file.name,
      thumbnailLink: file.thumbnailLink,
      webViewLink: file.webViewLink,
      mimeType: file.mimeType,
    }],
    source: 'drive_auto',
    score: file._score ?? 0,
  }));

  return {
    proposals,
    drive_ready: true,
    roots_count: roots?.roots?.length ?? null,
    platforms: PLATFORMS,
  };
}

export { PLATFORMS, buildCaption, cleanName };
