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
  black: '#2A2F27',
  muted: '#6B7264',
  light: '#9A9F96',
  line: '#E8DFD6',
};

const BRAND_DIR = path.join(__dirname, '../../brand');
const LOGO_PATH = path.join(BRAND_DIR, 'logo-orange.png');

const M = 50;
const PAGE_W = 612;
const W = PAGE_W - M * 2;
const R = M + W;
const LOGO_W = 72;

function money(n) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-CA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parseLines(lines) {
  return typeof lines === 'string' ? JSON.parse(lines) : (lines || []);
}

function calcTaxes(subtotal, co) {
  const gst = subtotal * co.tax.gstRate;
  const qst = subtotal * co.tax.qstRate;
  return { gst, qst, total: subtotal + gst + qst };
}

function addressLines(co) {
  return [
    co.address.line1,
    co.address.line2,
  ].filter(Boolean);
}

/** Logo + bande orange bien en dessous (pas de chevauchement). */
function brandHeader(doc) {
  let y = M;
  let logoBottom = y;

  if (existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, M, y, { width: LOGO_W });
    logoBottom = y + LOGO_W * (596 / 842) + 6;
  } else {
    doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(18).text('Neya', M, y);
    logoBottom = y + 24;
  }

  doc.fillColor(C.muted).font('Helvetica').fontSize(7)
    .text('FURNITURES & MORE', M, logoBottom, { characterSpacing: 1.2 });

  const bandY = logoBottom + 14;
  doc.moveTo(M, bandY).lineTo(R, bandY).strokeColor(C.orange).lineWidth(1.5).stroke();
  return bandY + 16;
}

/** En-tête société façon facture Martin / Sierra (Fabre + nº taxes). */
function companyBlock(doc, startY, co, { compact = false } = {}) {
  let y = startY;
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text(co.legalName, M, y);
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  y += 13;
  for (const line of addressLines(co)) {
    doc.text(line, M, y);
    y += 11;
  }
  if (!compact) {
    doc.text(co.phone, M, y); y += 11;
  }
  doc.text(co.email, M, y); y += 11;
  if (co.website && compact) {
    doc.text(String(co.website).replace(/^https?:\/\//, ''), M, y); y += 11;
  }
  if (!compact) {
    doc.text(`Nº TPS/TVH : ${co.gstNumber}`, M, y); y += 11;
    doc.text(`Nº TVQ : ${co.qstNumber}`, M, y);
    y += 4;
  }
  return y + 8;
}

function sectionLabel(doc, text, x, y) {
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8)
    .text(String(text).toUpperCase(), x, y, { characterSpacing: 0.6 });
  return y + 13;
}

function hline(doc, y, { color = C.line, width = 0.6 } = {}) {
  doc.moveTo(M, y).lineTo(R, y).strokeColor(color).lineWidth(width).stroke();
  return y + 10;
}

function thickRule(doc, y) {
  return hline(doc, y, { color: C.orange, width: 1 });
}

function ensureSpace(doc, y, need = 80) {
  if (y + need < 720) return y;
  doc.addPage();
  return brandHeader(doc);
}

function linesTable(doc, lines, startY) {
  let y = startY;
  doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8);
  doc.text('Description', M, y);
  doc.text('Qté', M + 300, y, { width: 50, align: 'right' });
  doc.text('Prix unit.', M + 360, y, { width: 70, align: 'right' });
  doc.text('Montant', M + 440, y, { width: 62, align: 'right' });
  y = hline(doc, y + 11);

  for (const line of parseLines(lines)) {
    const qty = Number(line.qty) || 0;
    const price = Number(line.price) || 0;
    const amount = qty * price;
    const desc = line.description || '';

    y = ensureSpace(doc, y, 40);
    doc.fillColor(C.black).font('Helvetica').fontSize(9);
    const descH = doc.heightOfString(desc, { width: 285 });
    doc.text(desc, M, y, { width: 285 });
    doc.text(String(line.qty ?? qty), M + 300, y, { width: 50, align: 'right' });
    doc.text(money(price), M + 360, y, { width: 70, align: 'right' });
    doc.text(money(amount), M + 440, y, { width: 62, align: 'right' });
    y += Math.max(descH, 12) + 8;
  }
  return y;
}

function totalsBlock(doc, subtotal, y, co, label = 'Total') {
  const { gst, qst, total } = calcTaxes(subtotal, co);
  y = hline(doc, y + 2);
  const tx = M + 320;
  const lw = 110;
  const vw = 72;

  const row = (caption, value, { bold = false, color = C.black, captionColor = C.muted } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9);
    doc.fillColor(captionColor).text(caption, tx, y, { width: lw, align: 'right' });
    doc.fillColor(color).text(money(value), tx + lw, y, { width: vw, align: 'right' });
    y += bold ? 18 : 15;
  };

  row('Sous-total', subtotal);
  row(co.tax.labelGst || 'TPS 5 %', gst);
  row(co.tax.labelQst || 'TVQ 9,975 %', qst);
  y += 2;
  doc.moveTo(tx, y).lineTo(R, y).strokeColor(C.line).lineWidth(0.6).stroke();
  y += 8;
  row(label, total, { bold: true, color: C.green, captionColor: C.orange });
  return { y: y + 8, total, gst, qst };
}

function paymentPage(doc, invoiceNumber, co) {
  doc.addPage();
  let y = brandHeader(doc);
  y = companyBlock(doc, y, co, { compact: true });
  y = thickRule(doc, y);

  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(12).text('Instructions de paiement', M, y);
  y += 18;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(co.payment.intro, M, y, { width: W });
  y += doc.heightOfString(co.payment.intro, { width: W }) + 16;

  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text(co.payment.interac.label, M, y);
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  doc.text(`Envoyer à : ${co.payment.interac.email}`, M, y); y += 13;
  doc.text(co.payment.interac.note, M, y); y += 22;

  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text(co.payment.bank.label, M, y);
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  doc.text(co.payment.bank.institution, M, y); y += 12;
  doc.text(co.payment.bank.address, M, y); y += 12;
  doc.text(`Transit : ${co.payment.bank.transit} · Institution : ${co.payment.bank.institutionNumber}`, M, y); y += 12;
  doc.text(`Compte : ${co.payment.bank.account}`, M, y); y += 12;
  doc.text(`Bénéficiaire : ${co.payment.bank.beneficiary}`, M, y); y += 18;

  doc.font('Helvetica-Oblique').fontSize(8).text(
    `${co.payment.referenceNote.replace('invoice number', `nº de facture ${invoiceNumber}`)}`,
    M, y, { width: W }
  );
  y += 28;
  doc.font('Helvetica').fontSize(10).fillColor(C.orange).text('Merci pour votre commande.', M, y);
}

export async function generateInvoicePdf(invoice, res) {
  const COMPANY = await getCompanyConfig();
  const doc = new PDFDocument({ margin: M, size: 'LETTER' });
  doc.pipe(res);

  const subtotal = Number(invoice.subtotal) || 0;
  const subtitle = invoice.subtitle || invoice.notes?.split('\n')[0] || '';

  let y = brandHeader(doc);
  y = companyBlock(doc, y, COMPANY);
  y = thickRule(doc, y);

  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(14).text('Facture', M, y);
  y += 18;
  if (subtitle) {
    doc.font('Helvetica').fontSize(10).fillColor(C.muted).text(subtitle, M, y, { width: W });
    y += doc.heightOfString(subtitle, { width: W }) + 12;
  } else {
    y += 4;
  }

  y = hline(doc, y);
  const col2 = M + 300;
  const topY = y;

  y = sectionLabel(doc, 'Facturé à', M, topY);
  doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text(invoice.client_name || '—', M, y);
  y += 13;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  if (invoice.contact) { doc.text(`Attn : ${invoice.contact}`, M, y); y += 12; }
  if (invoice.client_address) {
    const h = doc.heightOfString(invoice.client_address, { width: 260 });
    doc.text(invoice.client_address, M, y, { width: 260 });
    y += h + 4;
  }
  if (invoice.client_city) { doc.text(invoice.client_city, M, y); y += 12; }
  if (invoice.email) { doc.text(invoice.email, M, y); y += 12; }

  let yRight = sectionLabel(doc, 'Détails facture', col2, topY);
  doc.font('Helvetica').fontSize(9).fillColor(C.black);
  doc.text(`Nº : ${invoice.invoice_number}`, col2, yRight); yRight += 13;
  doc.text(`Date : ${fmtDate(invoice.created_at)}`, col2, yRight); yRight += 13;
  doc.text(`Modalités : ${invoice.terms || COMPANY.defaultTerms}`, col2, yRight); yRight += 13;
  if (invoice.due_date) { doc.text(`Échéance : ${fmtDate(invoice.due_date)}`, col2, yRight); yRight += 13; }
  if (invoice.reference) {
    doc.text(`Réf. : ${invoice.reference}`, col2, yRight, { width: 210 });
    yRight += doc.heightOfString(`Réf. : ${invoice.reference}`, { width: 210 }) + 4;
  }

  y = Math.max(y, yRight) + 8;
  y = hline(doc, y);

  if (invoice.order_summary || (invoice.notes && !subtitle)) {
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Résumé de commande', M, y);
    y += 13;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    const summary = invoice.order_summary || invoice.notes;
    doc.text(summary, M, y, { width: W });
    y += doc.heightOfString(summary, { width: W }) + 14;
    y = hline(doc, y);
  }

  y = linesTable(doc, invoice.lines, y);
  totalsBlock(doc, subtotal, y, COMPANY, 'Solde à payer');

  if (Number(invoice.amount_paid) > 0) {
    const paid = Number(invoice.amount_paid) || 0;
    const due = Math.max(0, (Number(invoice.total) || 0) - paid);
    const yPaid = doc.y + 6;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text(`Déjà payé : ${money(paid)}`, M + 320, yPaid, { align: 'right', width: 182 });
    if (due > 0.009) {
      doc.text(`Reste à payer : ${money(due)}`, M + 320, yPaid + 13, { align: 'right', width: 182 });
    }
  }

  paymentPage(doc, invoice.invoice_number, COMPANY);
  doc.end();
}

export async function generateQuotePdf(quote, res) {
  const COMPANY = await getCompanyConfig();
  const doc = new PDFDocument({ margin: M, size: 'LETTER' });
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

  let y = brandHeader(doc);
  // Adresse légale (Fabre) — plus Masson / ancien atelier
  y = companyBlock(doc, y, COMPANY);
  y = thickRule(doc, y);

  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(13).text(`Devis — ${title}`, M, y, { width: W });
  y += 18;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  doc.text(`Émis le ${fmtDate(quote.created_at)} · Valide jusqu’au ${fmtDate(validUntil)}`, M, y);
  if (quote.quote_number) {
    y += 12;
    doc.text(`Nº ${quote.quote_number}`, M, y);
  }
  if (quote.reference) {
    y += 12;
    doc.text(`Référence : ${quote.reference}`, M, y);
  }
  y += 14;
  y = hline(doc, y);

  if (quote.client_name) {
    y = sectionLabel(doc, 'Préparé pour', M, y);
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text(quote.client_name, M, y);
    y += 13;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    if (quote.contact) { doc.text(`Attn : ${quote.contact}`, M, y); y += 12; }
    if (quote.client_address) {
      const h = doc.heightOfString(quote.client_address, { width: W });
      doc.text(quote.client_address, M, y, { width: W });
      y += h + 4;
    }
    if (quote.client_city) { doc.text(quote.client_city, M, y); y += 12; }
    if (quote.email) { doc.text(quote.email, M, y); y += 12; }
    if (quote.client_phone) { doc.text(quote.client_phone, M, y); y += 12; }
    y += 6;
    y = hline(doc, y);
  }

  if (quote.notes) {
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Portée des travaux', M, y);
    y += 13;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    doc.text(quote.notes, M, y, { width: W });
    y += doc.heightOfString(quote.notes, { width: W }) + 12;
    y = hline(doc, y);
  }

  for (const section of document.sections) {
    y = ensureSpace(doc, y, 100);
    if (section.title) {
      doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text(section.title, M, y);
      y += 14;
    }
    y = linesTable(doc, section.lines, y) + 6;
  }

  const { y: y2 } = totalsBlock(doc, subtotal, y, COMPANY, 'Total TTC');
  y = y2 + 4;
  doc.font('Helvetica').fontSize(8).fillColor(C.light)
    .text('Montants en dollars canadiens. Taxes : TPS 5 % + TVQ 9,975 %.', M, y);
  y += 16;

  const addNotes = quote.additional_notes || document.additional_notes;
  if (addNotes) {
    y = ensureSpace(doc, y, 80);
    y = hline(doc, y);
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Notes additionnelles', M, y);
    y += 13;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    doc.text(addNotes, M, y, { width: W });
    y += doc.heightOfString(addNotes, { width: W }) + 14;
  }

  if ((document.photos || []).length) {
    y = ensureSpace(doc, y, 200);
    y = hline(doc, y);
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Photos', M, y);
    y += 13;
    for (const photo of document.photos.slice(0, 6)) {
      const abs = path.isAbsolute(photo.url)
        ? photo.url
        : path.join(__dirname, '../..', String(photo.url).replace(/^\//, ''));
      if (existsSync(abs)) {
        y = ensureSpace(doc, y, 180);
        try {
          doc.image(abs, M, y, { fit: [240, 160] });
          y += 170;
          if (photo.caption) {
            doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(photo.caption, M, y, { width: W });
            y += 14;
          }
        } catch { /* skip bad image */ }
      }
    }
  }

  y = ensureSpace(doc, y, 140);
  y = hline(doc, y);
  doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Conditions', M, y);
  y += 14;
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  for (const term of COMPANY.quoteTerms) {
    y = ensureSpace(doc, y, 36);
    doc.text(`• ${term}`, M, y, { width: W });
    y += doc.heightOfString(`• ${term}`, { width: W }) + 4;
  }
  y += 10;

  if (document.options?.show_payment !== false) {
    y = ensureSpace(doc, y, 120);
    y = hline(doc, y);
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Paiement', M, y);
    y += 13;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted);
    doc.text(COMPANY.payment.intro, M, y, { width: W });
    y += doc.heightOfString(COMPANY.payment.intro, { width: W }) + 10;
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(9).text(COMPANY.payment.interac.label, M, y);
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted);
    doc.text(`Envoyer à : ${COMPANY.payment.interac.email}`, M, y); y += 11;
    doc.text(COMPANY.payment.interac.note, M, y); y += 12;
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(9).text(COMPANY.payment.bank.label, M, y);
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted);
    doc.text(
      `${COMPANY.payment.bank.institution} · Transit ${COMPANY.payment.bank.transit} · Inst. ${COMPANY.payment.bank.institutionNumber} · Compte ${COMPANY.payment.bank.account}`,
      M, y, { width: W }
    );
    y += 18;
  }

  if (document.options?.show_signature !== false) {
    y = ensureSpace(doc, y, 100);
    y = hline(doc, y);
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Pour confirmer la commande', M, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    doc.text(
      `Veuillez retourner ce devis signé à ${COMPANY.email}. Nous confirmerons ensuite le calendrier de production.`,
      M, y, { width: W }
    );
    y += 28;
    doc.fillColor(C.black).font('Helvetica').fontSize(9);
    doc.text('Signature client : ______________________________________', M, y);
    y += 22;
    const acceptLabel = quote.acceptance_date
      ? `Date d’acceptation : ${fmtDate(quote.acceptance_date)}`
      : 'Date : ______________________________________';
    doc.text(acceptLabel, M, y);
  }

  if (quote.quote_number) {
    const footer = `${title} · ${COMPANY.tradeName} · ${quote.quote_number}`;
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 24;
    doc.fontSize(7).fillColor(C.light)
      .text(footer, M, doc.page.height - 36, {
        align: 'center',
        width: W,
        lineBreak: false,
        height: 12,
      });
    doc.page.margins.bottom = prevBottom;
  }

  doc.end();
}

export { calcTaxes, money as formatMoney };
