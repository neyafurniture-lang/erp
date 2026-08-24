import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getCompanyConfig } from './company-config.js';
import { normalizeQuoteDocument, flattenQuoteLines } from './quote-document.js';
import { calcDocTaxes, roundMoney } from './tax.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Palette épurée — encre, gris, une touche orange sur le total uniquement. */
const C = {
  ink: '#1A1A1A',
  muted: '#6B6B6B',
  faint: '#A3A3A3',
  line: '#E8E8E8',
  lineStrong: '#D4D4D4',
  accent: '#D86B30',
  white: '#FFFFFF',
};
const RADIUS = 8;

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
  return calcDocTaxes(subtotal, {
    gstRate: co?.tax?.gstRate ?? 0.05,
    qstRate: co?.tax?.qstRate ?? 0.09975,
  });
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
    doc.fillColor(C.accent).font('Helvetica-Bold').fontSize(20).text('Neya', M, y);
  }
  const logoBottom = y + (compact ? 56 : LOGO_W) * LOGO_RATIO;

  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(compact ? 15 : 24)
    .text(String(docType).toUpperCase(), M + 200, y + (compact ? 6 : 8), {
      width: W - 200, align: 'right', characterSpacing: 3,
    });
  if (number) {
    doc.fillColor(C.muted).font('Helvetica').fontSize(compact ? 9 : 10)
      .text(`Nº ${number}`, M + 200, y + (compact ? 26 : 40), { width: W - 200, align: 'right' });
  }

  y = Math.max(logoBottom, y + (compact ? 38 : 58)) + 10;
  doc.moveTo(M, y).lineTo(R, y).strokeColor(C.lineStrong).lineWidth(0.75).stroke();
  y += 10;

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

/** Panneau fin : fond blanc, contour discret, coins arrondis. */
function softPanel(doc, x, y, w, h, { fill = C.white, stroke = C.line } = {}) {
  doc.roundedRect(x, y, w, h, RADIUS).fillColor(fill).fill();
  doc.roundedRect(x, y, w, h, RADIUS).strokeColor(stroke).lineWidth(0.5).stroke();
}

/**
 * Deux cartes côte à côte : client à gauche, détails du document à droite.
 * rows = [[label, value], …]
 */
function metaCards(doc, y, leftTitle, leftLines, rightTitle, rightRows) {
  const gap = 28;
  const dividerX = M + (W - gap) / 2 + gap / 2;
  const lw = (W - gap) / 2;
  const rw = lw;
  const lx = M;
  const rx = dividerX + gap / 2;

  doc.font('Helvetica').fontSize(9);
  let ly = y;
  doc.fillColor(C.faint).font('Helvetica-Bold').fontSize(7)
    .text(leftTitle.toUpperCase(), lx, ly, { characterSpacing: 1.4 });
  ly += 14;
  for (const line of leftLines) {
    doc.fillColor(line.strong ? C.ink : C.muted)
      .font(line.strong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(line.strong ? 11 : 9);
    doc.text(line.text, lx, ly, { width: lw });
    ly += doc.heightOfString(line.text, { width: lw }) + 4;
  }

  let ry = y;
  doc.fillColor(C.faint).font('Helvetica-Bold').fontSize(7)
    .text(rightTitle.toUpperCase(), rx, ry, { characterSpacing: 1.4 });
  ry += 14;
  for (const [k, v] of rightRows) {
    doc.fillColor(C.muted).font('Helvetica').fontSize(8.5).text(k, rx, ry, { width: 72 });
    doc.fillColor(C.ink).font('Helvetica').fontSize(8.5)
      .text(String(v), rx + 72, ry, { width: rw - 72 });
    ry += Math.max(doc.heightOfString(String(v), { width: rw - 72 }), 11) + 4;
  }

  const bottom = Math.max(ly, ry) + 6;
  doc.moveTo(dividerX, y).lineTo(dividerX, bottom - 4)
    .strokeColor(C.line).lineWidth(0.5).stroke();
  doc.moveTo(M, bottom).lineTo(R, bottom).strokeColor(C.line).lineWidth(0.5).stroke();

  return bottom + 18;
}

const COL = {
  desc: { x: M + 10, w: 286 },
  qty: { x: M + 300, w: 50 },
  price: { x: M + 356, w: 74 },
  amount: { x: M + 436, w: W - 436 - 10 },
};

function tableHeader(doc, y) {
  doc.fillColor(C.faint).font('Helvetica-Bold').fontSize(7);
  const ty = y + 2;
  doc.text('DESCRIPTION', COL.desc.x, ty, { width: COL.desc.w, characterSpacing: 0.8 });
  doc.text('QTÉ', COL.qty.x, ty, { width: COL.qty.w, align: 'right', characterSpacing: 0.8 });
  doc.text('PRIX UNIT.', COL.price.x, ty, { width: COL.price.w, align: 'right', characterSpacing: 0.8 });
  doc.text('MONTANT', COL.amount.x, ty, { width: COL.amount.w, align: 'right', characterSpacing: 0.8 });
  y += 16;
  doc.moveTo(M, y).lineTo(R, y).strokeColor(C.lineStrong).lineWidth(0.75).stroke();
  return y + 10;
}

function fmtDateShort(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function linesTable(doc, lines, startY, ctx) {
  let y = startY;
  const visible = parseLines(lines).filter((line) => String(line?.description || '').trim());
  if (!visible.length) return y;

  y = ensureSpace(doc, y, 60, ctx);
  y = tableHeader(doc, y);

  let i = 0;
  for (const line of visible) {
    const qty = Number(line.qty) || 0;
    const price = Number(line.price) || 0;
    const amount = qty * price;
    const desc = String(line.description || '').trim();

    doc.font('Helvetica').fontSize(9);
    const descH = doc.heightOfString(desc, { width: COL.desc.w });
    const rowH = Math.max(descH, 11) + 10;

    if (y + rowH >= BODY_LIMIT) {
      y = ensureSpace(doc, y, rowH + 30, ctx);
      y = tableHeader(doc, y);
    }

    doc.fillColor(C.ink).font('Helvetica').fontSize(9);
    doc.text(desc, COL.desc.x, y, { width: COL.desc.w });
    doc.fillColor(C.muted);
    doc.text(String(qty), COL.qty.x, y, { width: COL.qty.w, align: 'right' });
    doc.text(money(price), COL.price.x, y, { width: COL.price.w, align: 'right' });
    doc.fillColor(C.ink).font('Helvetica');
    doc.text(money(amount), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += rowH;
    doc.moveTo(M, y - 4).lineTo(R, y - 4).strokeColor(C.line).lineWidth(0.35).stroke();
    i += 1;
  }
  return y + 8;
}

/**
 * Bloc totaux : boîte crème à droite, ligne TOTAL sur fond orange.
 * Retourne { y, total, gst, qst }.
 */
function totalsBlock(doc, subtotal, startY, co, label, ctx, { depositNote = false } = {}) {
  const { gst, qst, total } = calcTaxes(subtotal, co);
  const bw = 220;
  const bx = R - bw;
  const rowH = 17;
  const padX = 4;
  const boxH = rowH * 4 + 14;

  let y = ensureSpace(doc, startY, boxH + (depositNote ? 34 : 14), ctx);

  let ty = y;
  const row = (caption, value, { bold = false } = {}) => {
    doc.fillColor(C.muted).font('Helvetica').fontSize(9)
      .text(caption, bx + padX, ty, { width: bw - padX * 2 - 90 });
    doc.fillColor(bold ? C.ink : C.muted).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9)
      .text(money(value), bx + padX, ty, { width: bw - padX * 2, align: 'right' });
    ty += rowH;
  };
  row('Sous-total', subtotal);
  row(co.tax.labelGst || 'TPS 5 %', gst);
  row(co.tax.labelQst || 'TVQ 9,975 %', qst);

  ty += 4;
  doc.moveTo(bx, ty).lineTo(R, ty).strokeColor(C.lineStrong).lineWidth(0.75).stroke();
  ty += 10;
  doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8)
    .text(label.toUpperCase(), bx + padX, ty, { characterSpacing: 1 });
  doc.fillColor(C.accent).font('Helvetica-Bold').fontSize(13)
    .text(money(total), bx + padX, ty - 2, { width: bw - padX * 2, align: 'right' });

  y = ty + 22;

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
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9)
    .text(String(text).toUpperCase(), M, y, { characterSpacing: 1.2 });
  doc.moveTo(M, y + 14).lineTo(R, y + 14).strokeColor(C.line).lineWidth(0.5).stroke();
  return y + 22;
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
    doc.fillColor(C.faint).font('Helvetica').fontSize(7);
    doc.text(footerLeft, M, FOOTER_Y + 6, { width: W - 80, lineBreak: false });
    doc.text(`Page ${p - range.start + 1} / ${range.count}`, R - 76, FOOTER_Y + 6, {
      width: 76, align: 'right', lineBreak: false,
    });
    doc.fillColor(C.faint).fontSize(6.5)
      .text(`${co.legalName} · TPS ${co.gstNumber} · TVQ ${co.qstNumber}`, M, FOOTER_Y + 15, {
        width: W, lineBreak: false,
      });
    doc.page.margins.bottom = M;
  }
}

function paymentBlock(doc, y, co, ctx, { compact = false, intro } = {}) {
  y = ensureSpace(doc, y, 120, ctx);
  y = sectionTitle(doc, 'Instructions de paiement', y);
  const introText = intro
    || (ctx?.docType === 'Devis' ? (co.payment.introQuote || co.payment.intro) : co.payment.intro);
  y = paragraph(doc, introText, y, { size: compact ? 8 : 9 });

  const gap = 12;
  const cw = (W - gap) / 2;
  const pad = 10;
  const h = 74;
  y = ensureSpace(doc, y, h + 10, ctx);

  softPanel(doc, M, y, cw, h);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(8.5)
    .text(co.payment.interac.label, M + pad, y + pad);
  doc.fillColor(C.muted).font('Helvetica').fontSize(8);
  doc.text(`Envoyer à : ${co.payment.interac.email}`, M + pad, y + pad + 14, { width: cw - pad * 2 });
  doc.text(co.payment.interac.note, M + pad, y + pad + 27, { width: cw - pad * 2 });

  const rx = M + cw + gap;
  softPanel(doc, rx, y, cw, h);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(8.5)
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
  const subtitle = invoice.subtitle || '';
  const title = invoice.title || '';

  let y = docHeader(doc, COMPANY, ctx);

  if (title || subtitle) {
    const headline = [subtitle, title].filter(Boolean).join(subtitle && title ? ' · ' : '') || subtitle || title;
    doc.font('Helvetica').fontSize(11).fillColor(C.ink).text(headline, M, y, { width: W });
    y += doc.heightOfString(headline, { width: W }) + 10;
  }

  const clientLines = [
    { text: invoice.client_name || '—', strong: true },
    invoice.contact && { text: `Attn : ${invoice.contact}` },
    invoice.client_address && { text: invoice.client_address },
    invoice.client_city && { text: invoice.client_city },
    invoice.email && { text: invoice.email },
    invoice.client_phone && { text: invoice.client_phone },
  ].filter(Boolean);

  const detailRows = [
    ['Nº facture', invoice.invoice_number],
    ['Date', fmtDateShort(invoice.created_at)],
    ['Modalités', invoice.terms || COMPANY.defaultTerms],
    invoice.due_date && ['Échéance', fmtDateShort(invoice.due_date)],
    invoice.reference && ['Référence', invoice.reference],
  ].filter(Boolean);

  y = metaCards(doc, y, 'Facturé à', clientLines, 'Détails', detailRows);

  if (invoice.order_summary || invoice.notes) {
    y = sectionTitle(doc, 'Résumé', y);
    y = paragraph(doc, invoice.order_summary || invoice.notes, y);
  }

  const invDoc = normalizeQuoteDocument(invoice.lines);
  const hasNamedSections = (invDoc.sections || []).length > 1
    || (invDoc.sections || []).some(s => String(s.title || '').trim());
  if (hasNamedSections) {
    for (const section of invDoc.sections) {
      const sectionLines = (section.lines || []).filter((l) => String(l?.description || '').trim());
      if (!sectionLines.length) continue;
      y = ensureSpace(doc, y, 100, ctx);
      if (section.title) {
        doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8.5)
          .text(String(section.title).toUpperCase(), M, y, { characterSpacing: 1 });
        y += 15;
      }
      y = linesTable(doc, sectionLines, y, ctx) + 4;
    }
  } else {
    y = linesTable(doc, flattenQuoteLines(invDoc), y, ctx);
  }
  let totals = totalsBlock(doc, subtotal, y, COMPANY, 'Solde à payer', ctx);
  y = totals.y;

  if (Number(invoice.amount_paid) > 0) {
    const paid = Number(invoice.amount_paid) || 0;
    const due = Math.max(0, roundMoney(totals.total - paid));
    doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
      .text(`Déjà payé : ${money(paid)}`, M, y, { width: W, align: 'right' });
    y += 12;
    if (due > 0.009) {
      doc.font('Helvetica-Bold').fillColor(C.accent)
        .text(`Reste à payer : ${money(due)}`, M, y, { width: W, align: 'right' });
      y += 14;
    }
  }

  y += 6;
  y = paymentBlock(doc, y, COMPANY, ctx, { intro: COMPANY.payment.intro });
  y = ensureSpace(doc, y, 30, ctx);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(C.muted)
    .text(
      String(COMPANY.payment.referenceNote || '').replace(
        /numéro de facture|invoice number/gi,
        `nº ${invoice.invoice_number}`
      ),
      M, y, { width: W }
    );
  y += 20;
  doc.font('Helvetica').fontSize(10).fillColor(C.ink)
    .text('Merci.', M, y);

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

  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(12).text(title, M, y, { width: W });
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
    quote.quote_number && ['Nº devis', quote.quote_number],
    ['Date', fmtDateShort(quote.created_at)],
    ['Valide jusqu’au', fmtDateShort(validUntil)],
    quote.reference && ['Référence', quote.reference],
  ].filter(Boolean);

  y = metaCards(doc, y, 'Préparé pour', clientLines, 'Détails', detailRows);

  if (quote.notes) {
    y = sectionTitle(doc, 'Portée des travaux', y);
    y = paragraph(doc, quote.notes, y);
  }

  for (const section of document.sections) {
    const sectionLines = (section.lines || []).filter((l) => String(l?.description || '').trim());
    if (!sectionLines.length) continue;
    y = ensureSpace(doc, y, 100, ctx);
    if (section.title) {
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8.5)
        .text(section.title.toUpperCase(), M, y, { characterSpacing: 1 });
      y += 15;
    }
    y = linesTable(doc, sectionLines, y, ctx) + 4;
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
    y = paymentBlock(doc, y, COMPANY, ctx, {
      compact: true,
      intro: COMPANY.payment.introQuote || COMPANY.payment.intro,
    });
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
    doc.fillColor(C.ink).font('Helvetica').fontSize(9);
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
