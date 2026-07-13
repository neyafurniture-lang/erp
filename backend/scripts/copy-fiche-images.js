/**
 * Copie et renomme les images extraites du docx
 * Usage: npm run fiches:copy-images
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOCX_IMAGE_FILES } from '../src/data/fiche-images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../../frontend/public/fiches');
const ROOT = path.join(__dirname, '../../frontend/public/fiches');

for (const rel of Object.values(DOCX_IMAGE_FILES)) {
  const dir = path.dirname(path.join(ROOT, rel));
  fs.mkdirSync(dir, { recursive: true });
}

let copied = 0;
for (const [hash, dest] of Object.entries(DOCX_IMAGE_FILES)) {
  const src = path.join(SRC, hash);
  const out = path.join(ROOT, dest);
  if (!fs.existsSync(src)) {
    console.warn('Manquant:', hash);
    continue;
  }
  fs.copyFileSync(src, out);
  copied++;
}
console.log(`✓ ${copied} images → frontend/public/fiches/`);
