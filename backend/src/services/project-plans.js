/**
 * Découpe un PDF en pages individuelles pour un projet (plans 2D).
 */
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

function safeBaseName(name) {
  return String(name || 'plan')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'plan';
}

/**
 * @param {number} projectId
 * @param {Buffer|Uint8Array} pdfBuffer
 * @param {string} [sourceName]
 * @returns {Promise<Array<{id:string,name:string,page:number,url:string,source:string}>>}
 */
export async function splitPdfForProject(projectId, pdfBuffer, sourceName = 'plan.pdf') {
  const dir = path.join(UPLOADS_ROOT, 'projects', String(projectId), 'plans');
  fs.mkdirSync(dir, { recursive: true });

  const src = await PDFDocument.load(pdfBuffer);
  const pageCount = src.getPageCount();
  if (!pageCount) throw new Error('PDF vide');

  const base = safeBaseName(sourceName);
  const plans = [];

  for (let i = 0; i < pageCount; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    const filename = `${base}-p${String(i + 1).padStart(2, '0')}.pdf`;
    const fullPath = path.join(dir, filename);
    fs.writeFileSync(fullPath, Buffer.from(await doc.save()));
    plans.push({
      id: `${base}-p${i + 1}`,
      name: `${base.replace(/_/g, ' ')} — p.${i + 1}`,
      page: i + 1,
      url: `/uploads/projects/${projectId}/plans/${filename}`,
      source: sourceName,
    });
  }

  return plans;
}
