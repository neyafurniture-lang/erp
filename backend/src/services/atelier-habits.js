import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONTENT = `# Bonnes habitudes NEYA — atelier

## Devis & prix

- On n’écrit **jamais** de prix à l’heure dans les devis.

## Courriels & ton

- Messages clients : clairs, polis, concrets.

## Comment ajouter une règle

- Via Paramètres → Habitudes atelier, ou dites à Lia « ajoute une habitude : … »
`;

function candidatePaths() {
  return [
    process.env.ATELIER_HABITS_PATH,
    '/workspace/ATELIER_HABITS.md',
    '/opt/neya-erp/ATELIER_HABITS.md',
    path.resolve(process.cwd(), '../ATELIER_HABITS.md'),
    path.resolve(process.cwd(), 'ATELIER_HABITS.md'),
    path.resolve(__dirname, '../../../ATELIER_HABITS.md'),
  ].filter(Boolean);
}

export function resolveHabitsPath() {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  // Préférer le workspace monté en prod
  if (fs.existsSync('/workspace')) return '/workspace/ATELIER_HABITS.md';
  return path.resolve(process.cwd(), '../ATELIER_HABITS.md');
}

export function readHabitsFile() {
  const filePath = resolveHabitsPath();
  try {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, DEFAULT_CONTENT, 'utf8');
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, path: filePath, content, updated_at: fs.statSync(filePath).mtime.toISOString() };
  } catch (err) {
    return { ok: false, path: filePath, content: DEFAULT_CONTENT, error: err.message };
  }
}

export function writeHabitsFile(content) {
  const filePath = resolveHabitsPath();
  const text = String(content || '').trimEnd() + '\n';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
  return { ok: true, path: filePath, content: text, updated_at: new Date().toISOString() };
}

/** Ajoute une règle sous une section (crée la section si besoin). */
export function appendHabit({ section = 'Général', rule }) {
  const r = String(rule || '').trim().replace(/^[-•*]\s*/, '');
  if (!r) throw new Error('Règle vide');
  const sec = String(section || 'Général').trim() || 'Général';
  const current = readHabitsFile().content || DEFAULT_CONTENT;
  const heading = `## ${sec}`;
  const bullet = `- ${r}`;

  if (current.includes(bullet) || current.toLowerCase().includes(r.toLowerCase())) {
    return { ok: true, path: resolveHabitsPath(), content: current, already: true };
  }

  let next;
  if (current.includes(heading)) {
    next = current.replace(heading, `${heading}\n\n${bullet}`);
  } else {
    next = `${current.trimEnd()}\n\n${heading}\n\n${bullet}\n`;
  }
  return { ...writeHabitsFile(next), already: false };
}

export function getHabitsPromptBlock() {
  const { content, path: filePath } = readHabitsFile();
  const trimmed = String(content || '').trim().slice(0, 6000);
  if (!trimmed) return '';
  return `BONNES HABITUDES ATELIER NEYA (fichier ${filePath} — à respecter strictement pour devis, mails, UI, code) :
${trimmed}

Si l'utilisateur demande d'ajouter une habitude → action atelier_habits avec params {"rule":"…"}.
Ne propose JAMAIS un devis avec prix à l'heure si les habitudes l'interdisent.`;
}
