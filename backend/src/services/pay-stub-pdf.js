import PDFDocument from 'pdfkit';
import { getCompanyConfig } from './company-config.js';

const C = {
  ink: '#1A1A1A',
  muted: '#6B6B6B',
  faint: '#A3A3A3',
  line: '#CCCCCC',
  accent: '#D86B30',
};

const M = 40;
const PAGE_W = 612;
const W = PAGE_W - M * 2;
const R = M + W;

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

function row(doc, y, cols, { bold = false, size = 8 } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(C.ink);
  const [c0, c1, c2, c3, c4] = cols;
  if (c0 != null) doc.text(String(c0), M, y, { width: 130 });
  if (c1 != null) doc.text(String(c1), M + 135, y, { width: 42, align: 'right' });
  if (c2 != null) doc.text(String(c2), M + 182, y, { width: 42, align: 'right' });
  if (c3 != null) doc.text(String(c3), M + 230, y, { width: 58, align: 'right' });
  if (c4 != null) doc.text(String(c4), M + 295, y, { width: 58, align: 'right' });
  return y + 14;
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
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10)
    .text(co.legalName || co.tradeName, M, y);
  y += 12;
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  doc.text(co.addressLine1 || co.address?.line1 || '', M, y);
  y += 10;
  doc.text(co.addressLine2 || co.address?.line2 || '', M, y);

  // Coin supérieur droit — net + date
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9)
    .text('Détails sur la fiche de paie', M + 280, M, { width: 280, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(C.muted)
    .text(`DATE DE PAIE ${fmtDate(period.payDate)}`, M + 280, M + 14, { width: 280, align: 'right' });
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10)
    .text(`RÉMUNÉRATION NETTE : ${money(line.net)}`, M + 280, M + 28, { width: 280, align: 'right' });

  y = M + 70;

  // Blocs employeur / période
  doc.fillColor(C.faint).font('Helvetica-Bold').fontSize(7)
    .text('EMPLOYEUR', M, y);
  doc.text('PÉRIODE DE PAIE', M + 280, y);
  y += 12;
  doc.fillColor(C.ink).font('Helvetica').fontSize(8);
  doc.text(co.legalName || '', M, y, { width: 250 });
  doc.text(`Période commençant : ${fmtDate(period.startDate)}`, M + 280, y, { width: 280 });
  y += 11;
  doc.text(co.addressLine1 || '', M, y);
  doc.text(`Période se terminant : ${fmtDate(period.endDate)}`, M + 280, y, { width: 280 });
  y += 11;
  doc.text(co.addressLine2 || '', M, y);
  doc.text(`Date de paie : ${fmtDate(period.payDate)}`, M + 280, y, { width: 280 });
  y += 11;
  doc.text(`Total des heures : ${fmtHours(line.hours)}`, M + 280, y, { width: 280 });
  y += 18;

  doc.fillColor(C.faint).font('Helvetica-Bold').fontSize(7).text('EMPLOYÉ', M, y);
  y += 12;
  doc.fillColor(C.ink).font('Helvetica').fontSize(8);
  doc.text(employee.name || '', M, y);
  y += 11;
  if (employee.addressLine1) {
    doc.text(employee.addressLine1, M, y);
    y += 11;
  }
  const empCity = [employee.city, employee.province, employee.postalCode].filter(Boolean).join(' ');
  if (empCity) {
    doc.text(empCity, M, y);
    y += 11;
  }

  doc.font('Helvetica-Bold').fontSize(9)
    .text(`RÉMUNÉRATION NETTE : ${money(line.net)}`, M + 280, y - 22, { width: 280, align: 'right' });
  if (line.memo) {
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
      .text(`MÉMO : ${line.memo}`, M, y + 6, { width: W });
    y += 16;
  }
  y += 10;

  doc.moveTo(M, y).lineTo(R, y).strokeColor(C.line).lineWidth(0.5).stroke();
  y += 10;

  // En-têtes colonnes
  doc.fillColor(C.faint).font('Helvetica-Bold').fontSize(7);
  doc.text('PAIE', M, y);
  doc.text('Heures', M + 135, y, { width: 42, align: 'right' });
  doc.text('Taux', M + 182, y, { width: 42, align: 'right' });
  doc.text('Actuel', M + 230, y, { width: 58, align: 'right' });
  doc.text('CDA', M + 295, y, { width: 58, align: 'right' });
  doc.text('RETENUES', M + 360, y);
  doc.text('Actuel', M + 460, y, { width: 58, align: 'right' });
  doc.text('CDA', M + 525, y, { width: 58, align: 'right' });
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
    doc.font('Helvetica').fontSize(8).fillColor(C.ink);
    doc.text(d.label, M + 360, dy, { width: 95 });
    doc.text(money(d.employee), M + 460, dy, { width: 58, align: 'right' });
    doc.text(money(ytdAmt), M + 525, dy, { width: 58, align: 'right' });
    dy += 13;
  }
  y = Math.max(y + 14, dy + 4);

  // Sommaire
  doc.fillColor(C.faint).font('Helvetica-Bold').fontSize(7)
    .text('SOMMAIRE', M + 360, y);
  y += 12;
  const summaryRows = [
    ['Rémunération totale', money(line.gross), money(ytd.gross)],
    ['Retenues', money(line.deductions), money(Object.values(ytd.deductions || {}).reduce((s, v) => s + num(v), 0))],
    ['Déduction', money(line.advances), money(0)],
    ['Paie nette', money(line.net), money(ytd.net)],
  ];
  for (const [label, actuel, cda] of summaryRows) {
    doc.font('Helvetica').fontSize(8).fillColor(C.ink);
    doc.text(label, M + 360, y, { width: 95 });
    doc.text(actuel, M + 460, y, { width: 58, align: 'right' });
    doc.text(cda, M + 525, y, { width: 58, align: 'right' });
    y += 13;
  }

  y += 10;
  doc.fillColor(C.faint).font('Helvetica-Bold').fontSize(7).text('EMPLOYEUR (part)', M, y);
  y += 12;
  for (const er of current.employer || []) {
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
      .text(`${er.label} : ${money(er.amount)}`, M, y);
    y += 11;
  }

  doc.end();
}
