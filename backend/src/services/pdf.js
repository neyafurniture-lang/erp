import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getCompanyConfig } from './company-config.js';
import { normalizeQuoteDocument, flattenQuoteLines } from './quote-document.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const C = {
  green: '#4D5446',
  orange: '#D86B30',
  cream: '#F9F1EA',
  creamSoft: '#FBF6F0',
  black: '#2A2F27',
  muted: '#6B7264',
  light: '#9A9F96',
  line: '#E8DFD6',
  white: '#FFFFFF',
};

const BRAND_DIR = path.join(__dirname, '../../brand');
const LOGO_PATH = path.join(BRAND_DIR, 'logo-orange.png');

const M = 48;
const PAGE_W = 612;
const PAGE_H = 792;
const W = PAGE_W - M * 2;
const R = M + W;
const LOGO_W = 84;
const LOGO_RATIO = 596 / 842;
const FOOTER_Y = PAGE_H - 42;
const BODY_LIMIT = FOOTER_Y - 24;

function money(n) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function parseLines(lines) {
  return typeof lines === 'string' ? JSON.parse(lines) : (lines || []);
}

function calcTaxes(subtotal, co) {
  const gst = subtotal * co.tax.gstRate;
  const qst = subtotal * co.tax.qstRate;
  return { gst, qst, total: subtotal + gst + qst };
}

/**
 * En-tête : logo à gauche, type de document + numéro à droite,
 * règle orange, puis coordonnées société sur une ligne.
 */
function docHeader(doc, co, { docType, number, compact = false }) {
  let y = M - 12;

  if (existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, M, y, { width: compact ? 56 : LOGO_W });
  } else {
    doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(20).text('Neya', M, y);
  }
  const logoBottom = y + (compact ? 56 : LOGO_W) * LOGO_RATIO;

  // Type de document en gros à droite
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(compact ? 16 : 26)
    .text(String(docType).toUpperCase(), M + 200, y + (compact ? 6 : 8), {
      width: W - 200, align: 'right', characterSpacing: 2,
    });
  if (number) {
    doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(compact ? 9 : 11)
      .text(`Nº ${number}`, M + 200, y + (compact ? 26 : 42), { width: W - 200, align: 'right' });
  }

  y = Math.max(logoBottom, y + (compact ? 38 : 58)) + 8;
  doc.moveTo(M, y).lineTo(R, y).strokeColor(C.orange).lineWidth(2).stroke();
  y += 8;

  const contactBits = [
    co.tradeName,
    co.address.line1 && `${co.address.line1}, ${co.address.line2 || ''}`.trim().replace(/,\s*$/, ''),
    co.phone,
    co.email,
  ].filter(Boolean);
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
    .text(contactBits.join('   ·   '), M, y, { width: W });
  y += 12;

  return y + (compact ? 6 : 10);
}

function ensureSpace(doc, y, need, ctx) {
  if (y + need < BODY_LIMIT) return y;
  doc.addPage();
  return docHeader(doc, ctx.co, { ...ctx, compact: true });
}

function roundedCard(doc, x, y, w, h, { fill = C.cream } = {}) {
  doc.roundedRect(x, y, w, h, 6).fillColor(fill).fill();
}

/**
 * Deux cartes côte à côte : client à gauche, détails du document à droite.
 * rows = [[label, value], …]
 */
function metaCards(doc, y, leftTitle, leftLines, rightTitle, rightRows) {
  const gap = 12;
  const cw = (W - gap) / 2;
  const pad = 12;

  // Hauteurs
  doc.font('Helvetica').fontSize(9);
  let lh = 16; // titre
  for (const line of leftLines) {
    lh += doc.heightOfString(line.text, { width: cw - pad * 2 }) + 3;
  }
  let rh = 16;
  for (const [, v] of rightRows) {
    rh += doc.heightOfString(String(v), { width: cw - pad * 2 - 70 }) + 5;
  }
  const h = Math.max(lh, rh, 64) + pad * 1.5;

  roundedCard(doc, M, y, cw, h);
  roundedCard(doc, M + cw + gap, y, cw, h);

  // Carte gauche
  let ly = y + pad;
  doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(7.5)
    .text(leftTitle.toUpperCase(), M + pad, ly, { characterSpacing: 1 });
  ly += 14;
  for (const line of leftLines) {
    doc.fillColor(line.strong ? C.black : C.muted)
      .font(line.strong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(line.strong ? 10.5 : 9);
    doc.text(line.text, M + pad, ly, { width: cw - pad * 2 });
    ly += doc.heightOfString(line.text, { width: cw - pad * 2 }) + 3;
  }

  // Carte droite
  const rx = M + cw + gap + pad;
  let ry = y + pad;
  doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(7.5)
    .text(rightTitle.toUpperCase(), rx, ry, { characterSpacing: 1 });
  ry += 14;
  for (const [k, v] of rightRows) {
    doc.fillColor(C.muted).font('Helvetica').fontSize(8.5).text(k, rx, ry, { width: 70 });
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(8.5)
      .text(String(v), rx + 70, ry, { width: cw - pad * 2 - 70 });
    ry += Math.max(doc.heightOfString(String(v), { width: cw - pad * 2 - 70 }), 10) + 5;
  }

  return y + h + 16;
}

const COL = {
  desc: { x: M + 10, w: 286 },
  qty: { x: M + 300, w: 50 },
  price: { x: M + 356, w: 74 },
  amount: { x: M + 436, w: W - 436 - 10 },
};

function tableHeader(doc, y) {
  doc.roundedRect(M, y, W, 20, 4).fillColor(C.green).fill();
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8);
  const ty = y + 6;
  doc.text('DESCRIPTION', COL.desc.x, ty, { width: COL.desc.w, characterSpacing: 0.5 });
  doc.text('QTÉ', COL.qty.x, ty, { width: COL.qty.w, align: 'right' });
  doc.text('PRIX UNIT.', COL.price.x, ty, { width: COL.price.w, align: 'right' });
  doc.text('MONTANT', COL.amount.x, ty, { width: COL.amount.w, align: 'right' });
  return y + 26;
}

function linesTable(doc, lines, startY, ctx) {
  let y = startY;
  y = ensureSpace(doc, y, 60, ctx);
  y = tableHeader(doc, y);

  let i = 0;
  for (const line of parseLines(lines)) {
    const qty = Number(line.qty) || 0;
    const price = Number(line.price) || 0;
    const amount = qty * price;
    const desc = line.description || '';

    doc.font('Helvetica').fontSize(9);
    const descH = doc.heightOfString(desc, { width: COL.desc.w });
    const rowH = Math.max(descH, 11) + 9;

    if (y + rowH >= BODY_LIMIT) {
      y = ensureSpace(doc, y, rowH + 30, ctx);
      y = tableHeader(doc, y);
    }

    if (i % 2 === 1) {
      doc.rect(M, y - 4, W, rowH).fillColor(C.creamSoft).fill();
    }
    doc.fillColor(C.black).font('Helvetica').fontSize(9);
    doc.text(desc, COL.desc.x, y, { width: COL.desc.w });
    doc.fillColor(C.muted);
    doc.text(String(line.qty ?? qty), COL.qty.x, y, { width: COL.qty.w, align: 'right' });
    doc.text(money(price), COL.price.x, y, { width: COL.price.w, align: 'right' });
    doc.fillColor(C.black).font('Helvetica-Bold');
    doc.text(money(amount), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += rowH;
    i += 1;
  }
  doc.moveTo(M, y).lineTo(R, y).strokeColor(C.line).lineWidth(0.6).stroke();
  return y + 8;
}

/**
 * Bloc totaux : boîte crème à droite, ligne TOTAL sur fond orange.
 * Retourne { y, total, gst, qst }.
 */
function totalsBlock(doc, subtotal, startY, co, label, ctx, { depositNote = false } = {}) {
  const { gst, qst, total } = calcTaxes(subtotal, co);
  const bw = 240;
  const bx = R - bw;
  const rowH = 16;
  const padX = 12;
  const boxH = rowH * 3 + 8 + 24 + 10;

  let y = ensureSpace(doc, startY, boxH + (depositNote ? 34 : 10), ctx);

  roundedCard(doc, bx, y, bw, boxH, { fill: C.cream });
  let ty = y + 10;

  const row = (caption, value) => {
    doc.fillColor(C.muted).font('Helvetica').fontSize(9)
      .text(caption, bx + padX, ty, { width: bw - padX * 2 - 80 });
    doc.fillColor(C.black).font('Helvetica').fontSize(9)
      .text(money(value), bx + padX, ty, { width: bw - padX * 2, align: 'right' });
    ty += rowH;
  };
  row('Sous-total', subtotal);
  row(co.tax.labelGst || 'TPS 5 %', gst);
  row(co.tax.labelQst || 'TVQ 9,975 %', qst);

  ty += 2;
  doc.roundedRect(bx + 6, ty, bw - 12, 24, 5).fillColor(C.orange).fill();
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(10)
    .text(label.toUpperCase(), bx + padX, ty + 7, { width: bw - padX * 2 - 90, characterSpacing: 0.5 });
  doc.fontSize(11)
    .text(money(total), bx + padX, ty + 6, { width: bw - padX * 2, align: 'right' });

  y += boxH + 8;

  if (depositNote) {
    doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
      .text(
        `Acompte 50 % à la commande : ${money(total / 2)}   ·   Solde à la livraison : ${money(total / 2)}`,
        bx - 60, y, { width: bw + 60, align: 'right' }
      );
    y += 16;
  }

  return { y, total, gst, qst };
}

function sectionTitle(doc, text, y) {
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10.5).text(text, M, y);
  doc.moveTo(M, y + 15).lineTo(M + 32, y + 15).strokeColor(C.orange).lineWidth(2).stroke();
  return y + 24;
}

function paragraph(doc, text, y, { size = 9 } = {}) {
  doc.font('Helvetica').fontSize(size).fillColor(C.muted);
  doc.text(text, M, y, { width: W });
  return y + doc.heightOfString(text, { width: W }) + 10;
}

/** Pied de page sur toutes les pages (numérotation incluse). */
function stampFooters(doc, co, footerLeft) {
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    // Écrire sous la marge basse sans déclencher l'auto-pagination de pdfkit
    doc.page.margins.bottom = 0;
    doc.moveTo(M, FOOTER_Y).lineTo(R, FOOTER_Y).strokeColor(C.line).lineWidth(0.5).stroke();
    doc.fillColor(C.light).font('Helvetica').fontSize(7);
    doc.text(footerLeft, M, FOOTER_Y + 6, { width: W - 80, lineBreak: false });
    doc.text(`Page ${p - range.start + 1} / ${range.count}`, R - 76, FOOTER_Y + 6, {
      width: 76, align: 'right', lineBreak: false,
    });
    doc.fillColor(C.light).fontSize(6.5)
      .text(`${co.legalName} · TPS ${co.gstNumber} · TVQ ${co.qstNumber}`, M, FOOTER_Y + 15, {
        width: W, lineBreak: false,
      });
    doc.page.margins.bottom = M;
  }
}

function paymentBlock(doc, y, co, ctx, { compact = false } = {}) {
  y = ensureSpace(doc, y, 120, ctx);
  y = sectionTitle(doc, 'Paiement', y);
  y = paragraph(doc, co.payment.intro, y, { size: compact ? 8 : 9 });

  const gap = 12;
  const cw = (W - gap) / 2;
  const pad = 10;
  const h = 74;
  y = ensureSpace(doc, y, h + 10, ctx);

  roundedCard(doc, M, y, cw, h, { fill: C.creamSoft });
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8.5)
    .text(co.payment.interac.label, M + pad, y + pad);
  doc.fillColor(C.muted).font('Helvetica').fontSize(8);
  doc.text(`Envoyer à : ${co.payment.interac.email}`, M + pad, y + pad + 14, { width: cw - pad * 2 });
  doc.text(co.payment.interac.note, M + pad, y + pad + 27, { width: cw - pad * 2 });

  const rx = M + cw + gap;
  roundedCard(doc, rx, y, cw, h, { fill: C.creamSoft });
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8.5)
    .text(co.payment.bank.label, rx + pad, y + pad);
  doc.fillColor(C.muted).font('Helvetica').fontSize(8);
  doc.text(co.payment.bank.institution, rx + pad, y + pad + 14, { width: cw - pad * 2 });
  doc.text(
    `Transit ${co.payment.bank.transit} · Inst. ${co.payment.bank.institutionNumber} · Compte ${co.payment.bank.account}`,
    rx + pad, y + pad + 27, { width: cw - pad * 2 }
  );
  doc.text(`Bénéficiaire : ${co.payment.bank.beneficiary}`, rx + pad, y + pad + 44, { width: cw - pad * 2 });

  return y + h + 14;
}

export async function generateInvoicePdf(invoice, res) {
  const COMPANY = await getCompanyConfig();
  const ctx = { co: COMPANY, docType: 'Facture', number: invoice.invoice_number };
  const doc = new PDFDocument({ margin: M, size: 'LETTER', bufferPages: true });
  doc.pipe(res);

  const subtotal = Number(invoice.subtotal) || 0;
  const subtitle = invoice.subtitle || invoice.notes?.split('\n')[0] || '';

  let y = docHeader(doc, COMPANY, ctx);

  if (subtitle) {
    doc.font('Helvetica').fontSize(10).fillColor(C.muted).text(subtitle, M, y, { width: W });
    y += doc.heightOfString(subtitle, { width: W }) + 10;
  }

  const clientLines = [
    { text: invoice.client_name || '—', strong: true },
    invoice.contact && { text: `Attn : ${invoice.contact}` },
    invoice.client_address && { text: invoice.client_address },
    invoice.client_city && { text: invoice.client_city },
    invoice.email && { text: invoice.email },
  ].filter(Boolean);

  const detailRows = [
    ['Numéro', invoice.invoice_number],
    ['Date', fmtDate(invoice.created_at)],
    ['Modalités', invoice.terms || COMPANY.defaultTerms],
    invoice.due_date && ['Échéance', fmtDate(invoice.due_date)],
    invoice.reference && ['Référence', invoice.reference],
  ].filter(Boolean);

  y = metaCards(doc, y, 'Facturé à', clientLines, 'Détails', detailRows);

  if (invoice.order_summary || (invoice.notes && !subtitle)) {
    y = sectionTitle(doc, 'Résumé de commande', y);
    y = paragraph(doc, invoice.order_summary || invoice.notes, y);
  }

  y = linesTable(doc, invoice.lines, y, ctx);
  let totals = totalsBlock(doc, subtotal, y, COMPANY, 'Solde à payer', ctx);
  y = totals.y;

  if (Number(invoice.amount_paid) > 0) {
    const paid = Number(invoice.amount_paid) || 0;
    const due = Math.max(0, (Number(invoice.total) || totals.total) - paid);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
      .text(`Déjà payé : ${money(paid)}`, M, y, { width: W, align: 'right' });
    y += 12;
    if (due > 0.009) {
      doc.font('Helvetica-Bold').fillColor(C.orange)
        .text(`Reste à payer : ${money(due)}`, M, y, { width: W, align: 'right' });
      y += 14;
    }
  }

  y += 6;
  y = paymentBlock(doc, y, COMPANY, ctx);
  y = ensureSpace(doc, y, 30, ctx);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(C.muted)
    .text(COMPANY.payment.referenceNote.replace('invoice number', `nº ${invoice.invoice_number}`), M, y, { width: W });
  y += 20;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.orange)
    .text('Merci pour votre commande.', M, y);

  stampFooters(doc, COMPANY, `Facture ${invoice.invoice_number} · ${COMPANY.tradeName}`);
  doc.end();
}

export async function generateQuotePdf(quote, res) {
  const COMPANY = await getCompanyConfig();
  const ctx = { co: COMPANY, docType: 'Devis', number: quote.quote_number };
  const doc = new PDFDocument({ margin: M, size: 'LETTER', bufferPages: true });
  doc.pipe(res);

  const document = normalizeQuoteDocument(quote.lines);
  const flatLines = flattenQuoteLines(document);
  const subtotal = flatLines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0)
    || Number(quote.subtotal) || 0;
  const title = quote.title || quote.project_name || 'Devis';
  const validUntil = quote.valid_until || (() => {
    const d = new Date(quote.created_at || Date.now());
    d.setDate(d.getDate() + COMPANY.quoteValidityDays);
    return d;
  })();

  let y = docHeader(doc, COMPANY, ctx);

  doc.fillColor(C.black).font('Helvetica-Bold').fontSize(12).text(title, M, y, { width: W });
  y += doc.heightOfString(title, { width: W }) + 10;

  const clientLines = quote.client_name
    ? [
      { text: quote.client_name, strong: true },
      quote.contact && { text: `Attn : ${quote.contact}` },
      quote.client_address && { text: quote.client_address },
      quote.client_city && { text: quote.client_city },
      quote.email && { text: quote.email },
      quote.client_phone && { text: quote.client_phone },
    ].filter(Boolean)
    : [{ text: '—' }];

  const detailRows = [
    quote.quote_number && ['Numéro', quote.quote_number],
    ['Émis le', fmtDate(quote.created_at)],
    ['Valide jusqu’au', fmtDate(validUntil)],
    quote.reference && ['Référence', quote.reference],
  ].filter(Boolean);

  y = metaCards(doc, y, 'Préparé pour', clientLines, 'Détails', detailRows);

  if (quote.notes) {
    y = sectionTitle(doc, 'Portée des travaux', y);
    y = paragraph(doc, quote.notes, y);
  }

  for (const section of document.sections) {
    y = ensureSpace(doc, y, 100, ctx);
    if (section.title) {
      doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(9)
        .text(section.title.toUpperCase(), M, y, { characterSpacing: 0.8 });
      y += 15;
    }
    y = linesTable(doc, section.lines, y, ctx) + 4;
  }

  const { y: yAfterTotals } = totalsBlock(doc, subtotal, y, COMPANY, 'Total TTC', ctx, { depositNote: true });
  y = yAfterTotals + 4;

  const addNotes = quote.additional_notes || document.additional_notes;
  if (addNotes) {
    y = ensureSpace(doc, y, 60, ctx);
    y = sectionTitle(doc, 'Notes additionnelles', y);
    y = paragraph(doc, addNotes, y);
  }

  if ((document.photos || []).length) {
    y = ensureSpace(doc, y, 200, ctx);
    y = sectionTitle(doc, 'Photos', y);
    for (const photo of document.photos.slice(0, 6)) {
      const abs = path.isAbsolute(photo.url)
        ? photo.url
        : path.join(__dirname, '../..', String(photo.url).replace(/^\//, ''));
      if (existsSync(abs)) {
        y = ensureSpace(doc, y, 180, ctx);
        try {
          doc.image(abs, M, y, { fit: [240, 160] });
          y += 170;
          if (photo.caption) {
            doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(photo.caption, M, y, { width: W });
            y += 14;
          }
        } catch { /* image illisible — ignorer */ }
      }
    }
  }

  y = ensureSpace(doc, y, 120, ctx);
  y = sectionTitle(doc, 'Conditions', y);
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  for (const term of COMPANY.quoteTerms) {
    y = ensureSpace(doc, y, 30, ctx);
    doc.text(`•  ${term}`, M, y, { width: W });
    y += doc.heightOfString(`•  ${term}`, { width: W }) + 4;
  }
  y += 10;

  if (document.options?.show_payment !== false) {
    y = paymentBlock(doc, y, COMPANY, ctx, { compact: true });
  }

  if (document.options?.show_signature !== false) {
    y = ensureSpace(doc, y, 110, ctx);
    y = sectionTitle(doc, 'Pour confirmer la commande', y);
    y = paragraph(
      doc,
      `Veuillez retourner ce devis signé à ${COMPANY.email}. Nous confirmerons ensuite le calendrier de production.`,
      y
    );
    y += 10;
    doc.fillColor(C.black).font('Helvetica').fontSize(9);
    doc.text('Signature client : ______________________________________', M, y);
    y += 22;
    const acceptLabel = quote.acceptance_date
      ? `Date d’acceptation : ${fmtDate(quote.acceptance_date)}`
      : 'Date : ______________________________________';
    doc.text(acceptLabel, M, y);
  }

  stampFooters(doc, COMPANY, `${title} · ${COMPANY.tradeName}${quote.quote_number ? ` · ${quote.quote_number}` : ''}`);
  doc.end();
}

export { calcTaxes, money as formatMoney };
