import PDFDocument from 'pdfkit';
import { getCompanyConfig } from './company-config.js';

const C = {
  ink: '#1A1A1A',
  muted: '#6B6B6B',
  faint: '#A3A3A3',
  line: '#CCCCCC',
  accent: '#D86B30',
};

const M = 36;
const PAGE_W = 612;
const R = PAGE_W - M;
const W = R - M;

/** Libellés courts pour colonnes étroites (évite le wrap PDFKit). */
const DEDUCTION_SHORT = {
  fed_tax: 'Impôt fédéral',
  ei: 'Assurance-emploi',
  qc_tax: 'Impôt Québec',
  qpp: 'RRQ',
  qpip: 'RQAP',
  qpp2: 'RRQ (2e cotisation)',
};

function money(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(num(n));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('fr-CA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtHours(h) {
  return num(h).toFixed(2);
}

/** Texte à position fixe — ne laisse pas le wrap décaler le curseur. */
function cell(doc, text, x, y, width, { align = 'left', bold = false, size = 8, color = C.ink } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  doc.text(String(text ?? ''), x, y, {
    width,
    align,
    lineBreak: false,
    ellipsis: true,
  });
}

function row(doc, y, cols) {
  const [c0, c1, c2, c3, c4] = cols;
  if (c0 != null) cell(doc, c0, M, y, 120);
  if (c1 != null) cell(doc, c1, M + 125, y, 40, { align: 'right' });
  if (c2 != null) cell(doc, c2, M + 170, y, 40, { align: 'right' });
  if (c3 != null) cell(doc, c3, M + 215, y, 55, { align: 'right' });
  if (c4 != null) cell(doc, c4, M + 275, y, 55, { align: 'right' });
  return y + 13;
}

/**
 * Talon de paie style QuickBooks — colonnes Actuel / CDA (cumul à date).
 */
export async function generatePayStubPdf(stub, res) {
  const doc = new PDFDocument({ margin: M, size: 'LETTER' });
  doc.pipe(res);

  const { company, employee, period, line, current, ytd } = stub;
  const co = company || await getCompanyConfig();

  let y = M;

  // En-tête employeur (coin supérieur gauche)
  cell(doc, co.legalName || co.tradeName, M, y, 260, { bold: true, size: 10 });
  y += 12;
  cell(doc, co.addressLine1 || co.address?.line1 || '', M, y, 260, { size: 8, color: C.muted });
  y += 10;
  cell(doc, co.addressLine2 || co.address?.line2 || '', M, y, 260, { size: 8, color: C.muted });

  // Coin supérieur droit — net + date
  cell(doc, 'Détails sur la fiche de paie', M + 280, M, 260, { bold: true, size: 9, align: 'right' });
  cell(doc, `DATE DE PAIE ${fmtDate(period.payDate)}`, M + 280, M + 14, 260, {
    size: 8, color: C.muted, align: 'right',
  });
  cell(doc, `RÉMUNÉRATION NETTE : ${money(line.net)}`, M + 280, M + 28, 260, {
    bold: true, size: 10, align: 'right',
  });

  y = M + 70;

  // Blocs employeur / période
  cell(doc, 'EMPLOYEUR', M, y, 250, { bold: true, size: 7, color: C.faint });
  cell(doc, 'PÉRIODE DE PAIE', M + 280, y, 260, { bold: true, size: 7, color: C.faint });
  y += 12;
  cell(doc, co.legalName || '', M, y, 250, { size: 8 });
  cell(doc, `Période commençant : ${fmtDate(period.startDate)}`, M + 280, y, 260, { size: 8 });
  y += 11;
  cell(doc, co.addressLine1 || '', M, y, 250, { size: 8 });
  cell(doc, `Période se terminant : ${fmtDate(period.endDate)}`, M + 280, y, 260, { size: 8 });
  y += 11;
  cell(doc, co.addressLine2 || '', M, y, 250, { size: 8 });
  cell(doc, `Date de paie : ${fmtDate(period.payDate)}`, M + 280, y, 260, { size: 8 });
  y += 11;
  cell(doc, `Total des heures : ${fmtHours(line.hours)}`, M + 280, y, 260, { size: 8 });
  y += 18;

  cell(doc, 'EMPLOYÉ', M, y, 250, { bold: true, size: 7, color: C.faint });
  y += 12;
  cell(doc, employee.name || '', M, y, 250, { size: 8 });
  y += 11;
  if (employee.addressLine1) {
    cell(doc, employee.addressLine1, M, y, 250, { size: 8 });
    y += 11;
  }
  const empCity = [employee.city, employee.province, employee.postalCode].filter(Boolean).join(' ');
  if (empCity) {
    cell(doc, empCity, M, y, 250, { size: 8 });
    y += 11;
  }

  cell(doc, `RÉMUNÉRATION NETTE : ${money(line.net)}`, M + 280, y - 22, 260, {
    bold: true, size: 9, align: 'right',
  });
  if (line.memo) {
    cell(doc, `MÉMO : ${line.memo}`, M, y + 6, W, { size: 8, color: C.muted });
    y += 16;
  }
  y += 10;

  doc.moveTo(M, y).lineTo(R, y).strokeColor(C.line).lineWidth(0.5).stroke();
  y += 10;

  // En-têtes colonnes — paie gauche / retenues droite
  const RX = M + 340; // début colonne retenues
  const RL = 105; // largeur libellé
  const RA = RX + RL; // Actuel
  const RC = RA + 55; // CDA

  cell(doc, 'PAIE', M, y, 120, { bold: true, size: 7, color: C.faint });
  cell(doc, 'Heures', M + 125, y, 40, { bold: true, size: 7, color: C.faint, align: 'right' });
  cell(doc, 'Taux', M + 170, y, 40, { bold: true, size: 7, color: C.faint, align: 'right' });
  cell(doc, 'Actuel', M + 215, y, 55, { bold: true, size: 7, color: C.faint, align: 'right' });
  cell(doc, 'CDA', M + 275, y, 55, { bold: true, size: 7, color: C.faint, align: 'right' });
  cell(doc, 'RETENUES', RX, y, RL, { bold: true, size: 7, color: C.faint });
  cell(doc, 'Actuel', RA, y, 52, { bold: true, size: 7, color: C.faint, align: 'right' });
  cell(doc, 'CDA', RC, y, 52, { bold: true, size: 7, color: C.faint, align: 'right' });
  y += 14;

  const earn = (current.earnings || [])[0] || {};
  y = row(doc, y, [
    earn.label || 'Paie normale',
    fmtHours(earn.hours ?? line.hours),
    num(earn.rate ?? line.rate).toFixed(2),
    money(earn.amount ?? line.gross),
    money(ytd.gross ?? ytd.earnings),
  ]);

  y += 4;
  const deductions = current.deductions || [];
  let dy = y;
  for (const d of deductions) {
    const ytdAmt = ytd.deductions?.[d.code] ?? 0;
    const label = DEDUCTION_SHORT[d.code] || d.label || d.code;
    cell(doc, label, RX, dy, RL);
    cell(doc, money(d.employee), RA, dy, 52, { align: 'right' });
    cell(doc, money(ytdAmt), RC, dy, 52, { align: 'right' });
    dy += 13;
  }
  y = Math.max(y + 14, dy + 8);

  // Sommaire
  cell(doc, 'SOMMAIRE', RX, y, RL, { bold: true, size: 7, color: C.faint });
  y += 12;
  const summaryRows = [
    ['Rémunération totale', money(line.gross), money(ytd.gross)],
    ['Retenues', money(line.deductions), money(Object.values(ytd.deductions || {}).reduce((s, v) => s + num(v), 0))],
    ['Déduction', money(line.advances), money(0)],
    ['Paie nette', money(line.net), money(ytd.net)],
  ];
  for (const [label, actuel, cda] of summaryRows) {
    cell(doc, label, RX, y, RL);
    cell(doc, actuel, RA, y, 52, { align: 'right' });
    cell(doc, cda, RC, y, 52, { align: 'right' });
    y += 13;
  }

  y += 12;
  cell(doc, 'EMPLOYEUR (part)', M, y, 250, { bold: true, size: 7, color: C.faint });
  y += 12;
  for (const er of current.employer || []) {
    cell(doc, `${er.label} : ${money(er.amount)}`, M, y, W, { size: 8, color: C.muted });
    y += 11;
  }

  doc.end();
}
