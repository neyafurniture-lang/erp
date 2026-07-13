/**
 * Mappe les images du docx aux sections (guides + produits)
 * Usage: node backend/scripts/map-docx-images.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOC_XML = path.join(__dirname, '../tmp_docx/word/document.xml');
const RELS = path.join(__dirname, '../tmp_docx/word/_rels/document.xml.rels');

const relsXml = fs.readFileSync(RELS, 'utf8');
const ridToFile = {};
for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]+Target="media\/([^"]+)"/g)) {
  ridToFile[m[1]] = m[2];
}

const xml = fs.readFileSync(DOC_XML, 'utf8');

function stripXml(s) {
  return s
    .replace(/<w:tab[^/]*\/>/g, '\t')
    .replace(/<w:br[^/]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

const paragraphs = xml.split(/<w:p[ >]/).slice(1);
let section = 'intro';
const SKUS = ['L3', 'L7', 'MÕA', 'MÕA', 'ÕNDULA', 'SERA', 'HARE', 'RIVAGE', 'AZAD'];
const mapping = [];

for (const p of paragraphs) {
  const text = stripXml(p);
  if (/^L3\s+—/.test(text)) section = 'L3';
  else if (/^L7\s+—/.test(text)) section = 'L7';
  else if (/^MÕA\s+—/.test(text)) section = 'MÕA';
  else if (/^ÕNDULA\s+—/.test(text)) section = 'ÕNDULA';
  else if (/^SERA\s+—/.test(text)) section = 'SERA';
  else if (/^HARE\s+—/.test(text)) section = 'HARE';
  else if (/^RIVAGE\s+—/.test(text)) section = 'RIVAGE';
  else if (/^AZAD\s+—/.test(text)) section = 'AZAD';
  else if (/^1\.\s+Sécurité/.test(text)) section = 'guide:securite';
  else if (/^2\.\s+Guide de collage/.test(text)) section = 'guide:collage';
  else if (/^3\.\s+Guide de sablage/.test(text)) section = 'guide:sablage';
  else if (/^4\.\s+Festool Domino/.test(text)) section = 'guide:domino';
  else if (/^5\.\s+Traitement des arêtes/.test(text)) section = 'guide:aretes';

  const rids = [...p.matchAll(/r:embed="(rId\d+)"/g)].map(m => m[1]);
  for (const rid of rids) {
    const file = ridToFile[rid];
    if (!file) continue;
    mapping.push({ file, section, context: text.slice(0, 120) || '(image seule)' });
  }
}

console.log(JSON.stringify(mapping, null, 2));
