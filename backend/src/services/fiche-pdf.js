/**
 * PDF fiche de fabrication — formulaire remplissable (AcroForm)
 * Compatible Acrobat, Edge, Preview (macOS)
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { SANDING_GRAINS, EDGE_PROFILES, FINISH_TYPES } from '../data/fiches-fabrication.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../../brand/logo-orange.png');

const M = 45;
const W = 522;
const PH = 792;
const R = M + W;

const C = {
  orange: rgb(0.847, 0.42, 0.188),
  ink: rgb(0.165, 0.149, 0.133),
  muted: rgb(0.42, 0.42, 0.39),
  line: rgb(0.91, 0.87, 0.84),
  cream: rgb(0.976, 0.945, 0.918),
};

const CIRCLED = ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)', '(8)', '(9)'];

/** Helvetica WinAnsi — remplace caractères non encodables */
function pdfSafe(str) {
  let s = String(str ?? '')
    .replace(/≈/g, '~')
    .replace(/[–—]/g, '-')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/①/g, '(1)').replace(/②/g, '(2)').replace(/③/g, '(3)')
    .replace(/④/g, '(4)').replace(/⑤/g, '(5)').replace(/⑥/g, '(6)')
    .replace(/⑦/g, '(7)').replace(/⑧/g, '(8)').replace(/⑨/g, '(9)')
    .replace(/☐/g, '[ ]')
    .replace(/⌒/g, '^').replace(/⌣/g, 'v')
    .replace(/«|»/g, '"')
    .replace(/…/g, '...');

  // Retire tout caractère hors plage WinAnsi (évite les crashs pdf-lib)
  return Array.from(s).map((ch) => {
    const c = ch.charCodeAt(0);
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) return ch;
    return '?';
  }).join('');
}

function parseMeta(meta) {
  return typeof meta === 'string' ? JSON.parse(meta) : (meta || {});
}

function parseSteps(steps) {
  return typeof steps === 'string' ? JSON.parse(steps) : (steps || []);
}

function toPdfY(yTop, height = 0) {
  return PH - yTop - height;
}

class FicheLayout {
  constructor(pdfDoc, page, form, fonts) {
    this.pdfDoc = pdfDoc;
    this.page = page;
    this.form = form;
    this.fonts = fonts;
    this.y = M;
    this.pageNum = 1;
    this.meta = {};
    this.sku = '';
  }

  newPage() {
    if (this.meta) drawFooter(this.page, this.fonts, this.meta, this.pageNum);
    this.pageNum += 1;
    this.page = this.pdfDoc.addPage([612, PH]);
    this.form = this.pdfDoc.getForm();
    this.y = M + 8;
    this.drawText(`— suite (page ${this.pageNum}) —`, { size: 8, color: C.muted });
    this.y += 18;
  }

  ensure(need) {
    if (this.y + need > PH - 55) this.newPage();
    return false;
  }

  drawText(text, opts = {}) {
    const { size = 8, font = this.fonts.regular, color = C.ink, x = M, width = W, bold = false } = opts;
    const f = bold ? this.fonts.bold : font;
    this.page.drawText(pdfSafe(text), {
      x, y: toPdfY(this.y, size), size, font: f, color, maxWidth: width,
    });
  }

  line(yOff = 0) {
    const yy = this.y + yOff;
    this.page.drawLine({
      start: { x: M, y: toPdfY(yy) },
      end: { x: R, y: toPdfY(yy) },
      thickness: 1,
      color: C.line,
    });
  }

  section(title) {
    this.ensure(28);
    this.y += 8;
    this.drawText(title, { size: 11, bold: true, color: C.orange });
    this.y += 14;
    this.line();
    this.y += 10;
  }

  textField(name, x, w, h, value = '', multiline = false) {
    const field = this.form.createTextField(name);
    if (value) field.setText(pdfSafe(value));
    if (multiline) field.enableMultiline();
    field.addToPage(this.page, {
      x, y: toPdfY(this.y, h), width: w, height: h,
      borderWidth: 0.5,
      borderColor: C.line,
      backgroundColor: rgb(1, 1, 1),
    });
    field.updateAppearances(this.fonts.regular);
    return field;
  }

  checkBox(name, x, label, box = 11) {
    const field = this.form.createCheckBox(name);
    field.addToPage(this.page, {
      x, y: toPdfY(this.y, box), width: box, height: box,
      borderWidth: 0.5,
      borderColor: C.muted,
    });
    this.page.drawText(pdfSafe(label), {
      x: x + box + 4,
      y: toPdfY(this.y, 9),
      size: 7.5,
      font: this.fonts.regular,
      color: C.ink,
    });
    return field;
  }

  advance(dy) {
    this.ensure(dy);
    this.y += dy;
  }
}

async function drawHeader(layout, pdfDoc, standard, meta, sku) {
  const { page, fonts } = layout;
  if (existsSync(LOGO_PATH)) {
    const png = await pdfDoc.embedPng(readFileSync(LOGO_PATH));
    page.drawImage(png, { x: M, y: toPdfY(layout.y, 36), width: 64, height: 28 });
  }
  page.drawText(pdfSafe('Mobilier en bois massif — Montréal'), {
    x: M + 72, y: toPdfY(layout.y, 7), size: 7, font: fonts.regular, color: C.muted,
  });
  page.drawText(pdfSafe('Fiche d\'aide à la fabrication — usage interne'), {
    x: M + 72, y: toPdfY(layout.y + 10, 7), size: 7, font: fonts.regular, color: C.muted,
  });
  page.drawText(pdfSafe('Atelier : 2177 rue Masson, local 404, Montréal'), {
    x: M + 72, y: toPdfY(layout.y + 20, 7), size: 7, font: fonts.regular, color: C.muted,
  });
  layout.advance(38);

  const name = standard.name.replace(/^[A-Z0-9ÕÄÜ]+\s+—\s+/, '');
  layout.drawText(`${sku}  —  ${name}`, { size: 15, bold: true });
  layout.advance(18);
  layout.line();
  layout.advance(12);

  layout.drawText('Suivi production', { size: 7, color: C.muted });
  layout.advance(10);
  const fw = (W - 20) / 3;
  layout.textField('meta_commande', M, fw, 16, '');
  layout.page.drawText('N° commande', { x: M, y: toPdfY(layout.y, 8), size: 6, font: fonts.regular, color: C.muted });
  layout.textField('meta_date', M + fw + 10, fw, 16, '');
  layout.page.drawText('Date', { x: M + fw + 10, y: toPdfY(layout.y, 8), size: 6, font: fonts.regular, color: C.muted });
  layout.textField('meta_finisseur', M + 2 * (fw + 10), fw, 16, '');
  layout.page.drawText('Finisseur', { x: M + 2 * (fw + 10), y: toPdfY(layout.y, 8), size: 6, font: fonts.regular, color: C.muted });
  layout.advance(22);
}

function drawMetaGrid(layout, meta) {
  const rows = [
    ['Prix public', meta.price],
    ['Essence(s)', meta.wood],
    ['Dimensions produit', meta.dimensions],
    ['Finition', meta.finish],
    ['Délai', meta.lead_time],
  ].filter(([, v]) => v);

  const colW = W / 2;
  for (let i = 0; i < rows.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * colW;
    const yy = layout.y + row * 26;
    layout.page.drawText(pdfSafe(rows[i][0].toUpperCase()), {
      x, y: toPdfY(yy, 7), size: 6.5, font: layout.fonts.regular, color: C.muted,
    });
    layout.page.drawText(pdfSafe(String(rows[i][1])), {
      x, y: toPdfY(yy + 9, 9), size: 8.5, font: layout.fonts.bold, color: C.ink, maxWidth: colW - 8,
    });
  }
  layout.advance(Math.ceil(rows.length / 2) * 26 + 4);
}

function drawDebitage(layout, meta, sku) {
  const rows = [...(meta.debitage || [])];
  while (rows.length < 6) rows.push({ piece: '', wood: '', qty: '', dimensions: '', notes: '' });

  layout.section('Débitage');
  if (meta.debitage_note) {
    layout.drawText(meta.debitage_note, { size: 7.5, color: C.muted });
    layout.advance(12);
  }

  const cols = [
    { label: 'Pièce', x: M, w: 108 },
    { label: 'Essence', x: M + 108, w: 68 },
    { label: 'Qté', x: M + 176, w: 42 },
    { label: 'Dimensions (É × L × Lo)', x: M + 218, w: 148 },
    { label: 'Notes', x: M + 366, w: W - 366 },
  ];

  layout.page.drawRectangle({
    x: M, y: toPdfY(layout.y, 14), width: W, height: 14, color: C.cream,
  });
  for (const c of cols) {
    layout.page.drawText(pdfSafe(c.label), {
      x: c.x + 3, y: toPdfY(layout.y, 9), size: 6.5, font: layout.fonts.bold, color: C.muted,
    });
  }
  layout.advance(16);

  rows.forEach((row, i) => {
    const h = 18;
    layout.page.drawRectangle({
      x: M, y: toPdfY(layout.y, h), width: W, height: h,
      borderColor: C.line, borderWidth: 0.5,
    });
    const prefix = `debitage_${sku}_${i}`;
    const piece = row.piece || '';
    const wood = row.wood || '';
    if (piece) {
      layout.page.drawText(pdfSafe(piece), { x: cols[0].x + 3, y: toPdfY(layout.y, 10), size: 7.5, font: layout.fonts.regular, color: C.ink, maxWidth: cols[0].w - 6 });
    } else {
      layout.textField(`${prefix}_piece`, cols[0].x + 2, cols[0].w - 4, h - 2);
    }
    if (wood && !wood.includes('___')) {
      layout.page.drawText(pdfSafe(wood), { x: cols[1].x + 3, y: toPdfY(layout.y, 10), size: 7.5, font: layout.fonts.regular, color: C.ink, maxWidth: cols[1].w - 6 });
    } else {
      layout.textField(`${prefix}_wood`, cols[1].x + 2, cols[1].w - 4, h - 2, wood);
    }
    layout.textField(`${prefix}_qty`, cols[2].x + 2, cols[2].w - 4, h - 2, row.qty || '');
    layout.textField(`${prefix}_dim`, cols[3].x + 2, cols[3].w - 4, h - 2, row.dimensions || '');
    layout.textField(`${prefix}_notes`, cols[4].x + 2, cols[4].w - 4, h - 2, row.notes || '');
    layout.advance(h + 2);
  });
  layout.advance(4);
}

function drawFabricationSteps(layout, steps) {
  layout.section('Étapes de fabrication');
  let num = 0;
  for (const s of steps) {
    if (s.phase === 'finition' && s.description.includes('Cardon')) break;
    const prefix = s.num != null ? CIRCLED[s.num - 1] || `${s.num}.` : CIRCLED[num] || `${num + 1}.`;
    if (s.num == null) num++;
    layout.drawText(`${prefix} ${s.description}`, { size: 9.5, bold: true, color: C.orange });
    layout.advance(12);
    if (s.instructions) {
      layout.drawText(s.instructions, { x: M + 8, size: 7.5, color: C.muted });
      layout.advance(Math.min(36, 10 + Math.ceil(s.instructions.length / 90) * 9));
    } else {
      layout.advance(4);
    }
  }
}

function drawDomino(layout, domino, sku) {
  if (!domino) return;
  layout.section(domino.title || 'Assemblage Domino — DF 700');
  if (domino.note) {
    layout.drawText(domino.note, { size: 7.5, color: C.muted });
    layout.advance(12);
  }
  const checks = domino.checklist || ['ÉTROIT (0 clic)', '+1 CLIC', '+2 CLICS'];
  checks.forEach((label, i) => {
    layout.checkBox(`domino_${sku}_clk_${i}`, M + (i % 3) * 170, label);
  });
  layout.advance(18);

  const fields = [
    ['Fraise (Ø)', 'fraise'],
    ['Profondeur', 'profondeur'],
    ['Hauteur appui', 'hauteur'],
    ['Nb dominos / jonction', 'nb'],
  ];
  for (const [label, key] of fields) {
    layout.page.drawText(pdfSafe(`${label} :`), { x: M, y: toPdfY(layout.y, 9), size: 8, font: layout.fonts.regular, color: C.ink });
    layout.textField(`domino_${sku}_${key}`, M + 115, W - 115, 16);
    layout.advance(20);
  }
  layout.drawText('Position des dominos (croquis / notes) :', { size: 7.5, color: C.muted });
  layout.advance(10);
  layout.textField(`domino_${sku}_croquis`, M, W, 48, '', true);
  layout.advance(52);
}

function drawEdges(layout, sku) {
  layout.section('Cardon des arêtes — cocher le profil');
  EDGE_PROFILES.forEach((label, i) => {
    const col = i % 3;
    layout.checkBox(`edge_${sku}_${i}`, M + col * 172, label, 11);
    if (col === 2 || i === EDGE_PROFILES.length - 1) layout.advance(14);
  });
  layout.advance(6);
  const aretes = ['Toutes', 'Dessus seulement', 'Dessus + dessous', 'Sélection'];
  layout.drawText('Arêtes traitées sur :', { size: 7.5, color: C.muted });
  layout.advance(12);
  aretes.forEach((label, i) => {
    layout.checkBox(`aretes_${sku}_${i}`, M + i * 125, label, 11);
  });
  layout.advance(18);
}

function drawSanding(layout, sku) {
  layout.section('Sablage');
  layout.checkBox(`ts_${sku}_oui`, M, 'Time Saver — OUI (calibrage)');
  layout.checkBox(`ts_${sku}_non`, M + 200, 'NON — sablage manuel');
  layout.advance(16);
  layout.drawText('Grains utilisés (cocher) :', { size: 7.5, color: C.muted });
  layout.advance(12);
  const grains = [...SANDING_GRAINS.map(g => (g === '0000' ? '0000 laine' : g))];
  grains.forEach((g, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    layout.checkBox(`grain_${sku}_${g.replace(/\s/g, '_')}`, M + col * 100, g, 11);
    if (col === 4) layout.advance(14);
  });
  layout.advance(16);
  layout.drawText('Règle : « si ça passe pas au Time Saver, on fait 80 puis 0 »', { size: 7, color: C.muted });
  layout.advance(14);
}

function drawFinish(layout, meta, sku) {
  layout.section('Finition');
  FINISH_TYPES.forEach((label, i) => {
    layout.checkBox(`finish_${sku}_${i}`, M, label, 11);
    layout.advance(13);
  });
  layout.advance(4);
  layout.page.drawText('Nombre de couches :', { x: M, y: toPdfY(layout.y, 9), size: 8, font: layout.fonts.regular, color: C.ink });
  layout.textField(`finish_${sku}_couches`, M + 105, 60, 16, meta.finish_coats || '');
  layout.page.drawText('Usage déclaré :', { x: M + 180, y: toPdfY(layout.y, 9), size: 8, font: layout.fonts.regular, color: C.ink });
  layout.textField(`finish_${sku}_usage`, M + 255, W - 255, 16, meta.finish_usage || '');
  layout.advance(22);
  layout.checkBox(`finish_${sku}_sand_oui`, M, 'Sablage entre couches — Oui, grain :', 11);
  layout.textField(`finish_${sku}_sand_grain`, M + 175, 50, 16);
  layout.checkBox(`finish_${sku}_sand_non`, M + 240, 'Non', 11);
  layout.advance(18);
  layout.drawText('Vérifier à la lumière rasante. Étiquette Neya : essence, date, finisseur, n° commande.', { size: 7, color: C.muted });
  layout.advance(12);
}

function drawNotes(layout, sku) {
  layout.section(`Notes spécifiques ${sku}`);
  for (let i = 0; i < 4; i++) {
    layout.textField(`notes_${sku}_${i}`, M, W, 18);
    layout.advance(20);
  }
}

function drawFooter(page, fonts, meta, pageNum) {
  page.drawText(pdfSafe(meta.source || 'Neya Fiches Fabrication v1.1'), {
    x: M, y: 28, size: 6.5, font: fonts.regular, color: C.muted, maxWidth: W,
  });
  page.drawText(`Page ${pageNum}`, {
    x: R - 40, y: 28, size: 6.5, font: fonts.regular, color: C.muted,
  });
}

async function buildFichePdf(standard) {
  const meta = parseMeta(standard.meta);
  const steps = parseSteps(standard.steps);
  const sku = (meta.sku || standard.product_type || 'fiche').replace(/[^a-zA-Z0-9_]/g, '_');
  const isGuide = standard.product_type === 'guide';

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Fiche ${meta.sku || sku} — Neya`);
  pdfDoc.setAuthor('Neya Furniture');
  pdfDoc.setSubject('Fiche de fabrication atelier');

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  const page = pdfDoc.addPage([612, PH]);
  const form = pdfDoc.getForm();
  const layout = new FicheLayout(pdfDoc, page, form, fonts);
  layout.meta = meta;
  layout.sku = sku;

  await drawHeader(layout, pdfDoc, standard, meta, sku);

  if (!isGuide) {
    drawMetaGrid(layout, meta);
    drawDebitage(layout, meta, sku);
    drawFabricationSteps(layout, steps);
    drawDomino(layout, meta.domino, sku);
    drawEdges(layout, sku);
    drawSanding(layout, sku);
    drawFinish(layout, meta, sku);
    drawNotes(layout, sku);
  } else {
    layout.section('Guides atelier');
    for (const s of steps) {
      layout.drawText(s.description, { size: 9, bold: true });
      layout.advance(11);
      if (s.instructions) {
        layout.drawText(s.instructions, { size: 7.5, color: C.muted });
        layout.advance(14);
      }
    }
  }

  drawFooter(layout.page, fonts, meta, layout.pageNum);
  pdfDoc.getForm().updateFieldAppearances(regular);

  return pdfDoc.save();
}

/** @deprecated sync pipe — use generateFichePdfAsync */
export function generateFichePdf(standard, res) {
  generateFichePdfAsync(standard, res).catch(err => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
}

export async function generateFichePdfAsync(standard, res) {
  const bytes = await buildFichePdf(standard);
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from(bytes));
}

export { buildFichePdf };
