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
const W = 612 - M * 2;
const R = M + W;

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

function brandHeader(doc) {
  let y = M;
  if (existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, M, y, { width: 90 });
    y += 38;
  } else {
    doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(22).text('Neya', M, y);
    y += 28;
  }
  doc.fillColor(C.muted).font('Helvetica').fontSize(7).text('FURNITURES & MORE', M, y);
  y += 10;
  doc.moveTo(M, y).lineTo(R, y).strokeColor(C.orange).lineWidth(2).stroke();
  return y + 14;
}

function companyBlock(doc, startY, co) {
  let y = startY;
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text(co.legalName, M, y);
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  y += 13;
  doc.text(co.address.line1, M, y); y += 11;
  doc.text(co.address.line2, M, y); y += 11;
  doc.text(co.phone, M, y); y += 11;
  doc.text(co.email, M, y); y += 11;
  doc.text(`GST/HST # ${co.gstNumber}`, M, y); y += 11;
  doc.text(`QST # ${co.qstNumber}`, M, y);
  return y + 10;
}

function sectionLabel(doc, text, x, y) {
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(8).text(text.toUpperCase(), x, y);
  return y + 14;
}

function hline(doc, y) {
  doc.moveTo(M, y).lineTo(R, y).strokeColor(C.line).lineWidth(0.5).stroke();
  return y + 8;
}

function linesTable(doc, lines, startY) {
  let y = startY;
  doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8);
  doc.text('Description', M, y);
  doc.text('Qty', M + 300, y, { width: 50, align: 'right' });
  doc.text('Unit price', M + 360, y, { width: 70, align: 'right' });
  doc.text('Amount', M + 440, y, { width: 62, align: 'right' });
  y = hline(doc, y + 12);

  const parsed = parseLines(lines);
  for (const line of parsed) {
    const qty = Number(line.qty) || 0;
    const price = Number(line.price) || 0;
    const amount = qty * price;
    const desc = line.description || '';

    doc.fillColor(C.black).font('Helvetica').fontSize(9);
    const descH = doc.heightOfString(desc, { width: 285 });
    doc.text(desc, M, y, { width: 285 });
    doc.text(String(line.qty ?? qty), M + 300, y, { width: 50, align: 'right' });
    doc.text(money(price), M + 360, y, { width: 70, align: 'right' });
    doc.text(money(amount), M + 440, y, { width: 62, align: 'right' });
    y += Math.max(descH, 14) + 8;
  }
  return y;
}

function totalsBlock(doc, subtotal, y, co, label = 'Amount due') {
  const { gst, qst, total } = calcTaxes(subtotal, co);
  y = hline(doc, y + 4);
  const tx = M + 340;

  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  doc.text('Subtotal', tx, y, { width: 100, align: 'right' });
  doc.fillColor(C.black).text(money(subtotal), tx + 110, y, { width: 62, align: 'right' });
  y += 16;
  doc.fillColor(C.muted).text(co.tax.labelGst, tx, y, { width: 100, align: 'right' });
  doc.fillColor(C.black).text(money(gst), tx + 110, y, { width: 62, align: 'right' });
  y += 16;
  doc.fillColor(C.muted).text(co.tax.labelQst, tx, y, { width: 100, align: 'right' });
  doc.fillColor(C.black).text(money(qst), tx + 110, y, { width: 62, align: 'right' });
  y += 20;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.orange);
  doc.text(label, tx, y, { width: 100, align: 'right' });
  doc.fillColor(C.green).text(money(total), tx + 110, y, { width: 62, align: 'right' });
  return { y: y + 24, total, gst, qst };
}

function paymentPage(doc, invoiceNumber, co) {
  doc.addPage();
  brandHeader(doc);
  let y = M + 70;
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(14).text('Payment instructions', M, y);
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(co.payment.intro, M, y + 22, { width: W });

  y += 50;
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text(co.payment.interac.label, M, y);
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  doc.text(`Send to: ${co.payment.interac.email}`, M, y); y += 14;
  doc.text(co.payment.interac.note, M, y); y += 28;

  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text(co.payment.bank.label, M, y);
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  doc.text(co.payment.bank.institution, M, y); y += 12;
  doc.text(co.payment.bank.address, M, y); y += 12;
  doc.text(`Transit: ${co.payment.bank.transit} · Institution: ${co.payment.bank.institutionNumber}`, M, y); y += 12;
  doc.text(`Account: ${co.payment.bank.account}`, M, y); y += 12;
  doc.text(`Beneficiary: ${co.payment.bank.beneficiary}`, M, y); y += 20;

  doc.font('Helvetica-Oblique').fontSize(8).text(
    `${co.payment.referenceNote.replace('invoice number', `invoice number ${invoiceNumber}`)}`,
    M, y, { width: W }
  );
  y += 30;
  doc.font('Helvetica').fontSize(10).fillColor(C.orange).text('Thank you for your order.', M, y);
}

export async function generateInvoicePdf(invoice, res) {
  const COMPANY = await getCompanyConfig();
  const doc = new PDFDocument({ margin: M, size: 'LETTER' });
  doc.pipe(res);

  const subtotal = Number(invoice.subtotal) || 0;
  const title = invoice.title || invoice.project_name || 'Invoice';
  const subtitle = invoice.subtitle || invoice.notes?.split('\n')[0] || '';

  let y = brandHeader(doc);
  y = companyBlock(doc, y, COMPANY);
  y += 8;

  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(22).text('Invoice', M, y);
  if (subtitle) {
    doc.font('Helvetica').fontSize(11).fillColor(C.muted).text(subtitle, M, y + 28);
    y += 20;
  }
  y += 36;

  const col2 = M + 300;
  y = sectionLabel(doc, 'Bill to', M, y);
  doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text(invoice.client_name || '—', M, y);
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  if (invoice.contact) { doc.text(`Attn: ${invoice.contact}`, M, y); y += 12; }
  if (invoice.client_address) { doc.text(invoice.client_address, M, y, { width: 260 }); y += 12; }
  if (invoice.client_city) { doc.text(invoice.client_city, M, y); y += 12; }
  if (invoice.email) { doc.text(invoice.email, M, y); y += 12; }

  let yRight = y - (invoice.contact ? 14 : 0) - (invoice.client_address ? 12 : 0) - (invoice.client_city ? 12 : 0) - (invoice.email ? 12 : 0) - 14;
  yRight = sectionLabel(doc, 'Invoice details', col2, yRight);
  doc.font('Helvetica').fontSize(9).fillColor(C.black);
  doc.text(`Invoice #: ${invoice.invoice_number}`, col2, yRight); yRight += 14;
  doc.text(`Date: ${fmtDate(invoice.created_at)}`, col2, yRight); yRight += 14;
  doc.text(`Terms: ${invoice.terms || COMPANY.defaultTerms}`, col2, yRight); yRight += 14;
  if (invoice.due_date) { doc.text(`Due date: ${fmtDate(invoice.due_date)}`, col2, yRight); yRight += 14; }
  if (invoice.reference) { doc.text(`Reference: ${invoice.reference}`, col2, yRight, { width: 240 }); yRight += 14; }

  y = Math.max(y, yRight) + 20;

  if (invoice.order_summary || (invoice.notes && !subtitle)) {
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Order summary', M, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    const summary = invoice.order_summary || invoice.notes;
    doc.text(summary, M, y, { width: W });
    y += doc.heightOfString(summary, { width: W }) + 16;
  }

  y = linesTable(doc, invoice.lines, y);
  totalsBlock(doc, subtotal, y, COMPANY);

  if (Number(invoice.amount_paid) > 0) {
    const paid = Number(invoice.amount_paid) || 0;
    const due = Math.max(0, (Number(invoice.total) || 0) - paid);
    const yPaid = doc.y + 8;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text(`Déjà payé : ${money(paid)}`, M + 340, yPaid, { align: 'right', width: 172 });
    if (due > 0.009) {
      doc.text(`Reste à payer : ${money(due)}`, M + 340, yPaid + 14, { align: 'right', width: 172 });
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
  const title = quote.title || quote.project_name || 'Quote';
  const validUntil = quote.valid_until || (() => {
    const d = new Date(quote.created_at || Date.now());
    d.setDate(d.getDate() + COMPANY.quoteValidityDays);
    return d;
  })();

  let y = brandHeader(doc);
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  doc.text(COMPANY.address.altLine1 || COMPANY.address.line1, M, y); y += 11;
  doc.text(COMPANY.address.altLine2 || COMPANY.address.line2, M, y); y += 11;
  doc.text(COMPANY.email, M, y); y += 11;
  doc.text(COMPANY.website?.replace(/^https?:\/\//, '') || 'neyafurniture.ca', M, y);

  y += 24;
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(20).text(`Quote — ${title}`, M, y);
  y += 28;
  doc.font('Helvetica').fontSize(10).fillColor(C.muted);
  doc.text(`Issued ${fmtDate(quote.created_at)} · Valid until ${fmtDate(validUntil)}`, M, y);
  if (quote.reference) {
    y += 14;
    doc.text(`Reference: ${quote.reference}`, M, y);
  }
  y += 30;

  if (quote.client_name) {
    y = sectionLabel(doc, 'Prepared for', M, y);
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text(quote.client_name, M, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    if (quote.contact) { doc.text(`Attn: ${quote.contact}`, M, y); y += 12; }
    if (quote.client_address) { doc.text(quote.client_address, M, y, { width: W }); y += 12; }
    if (quote.client_city) { doc.text(quote.client_city, M, y); y += 12; }
    if (quote.email) { doc.text(quote.email, M, y); y += 12; }
    if (quote.client_phone) { doc.text(quote.client_phone, M, y); y += 12; }
    y += 10;
  }

  if (quote.notes) {
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Scope of work', M, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    doc.text(quote.notes, M, y, { width: W });
    y += doc.heightOfString(quote.notes, { width: W }) + 20;
  }

  for (const section of document.sections) {
    if (y > 680) { doc.addPage(); y = brandHeader(doc) + 20; }
    if (section.title) {
      doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10).text(section.title, M, y);
      y += 16;
    }
    y = linesTable(doc, section.lines, y) + 12;
  }

  const { y: y2 } = totalsBlock(doc, subtotal, y, COMPANY, 'Total (before taxes)');
  y = y2 + 10;

  doc.font('Helvetica').fontSize(8).fillColor(C.light)
    .text('All amounts in Canadian dollars, before taxes (GST 5% + QST 9.975%).', M, y);
  y += 20;

  const addNotes = quote.additional_notes || document.additional_notes;
  if (addNotes) {
    if (y > 640) { doc.addPage(); y = brandHeader(doc) + 20; }
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Additional notes', M, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    doc.text(addNotes, M, y, { width: W });
    y += doc.heightOfString(addNotes, { width: W }) + 16;
  }

  if ((document.photos || []).length) {
    if (y > 520) { doc.addPage(); y = brandHeader(doc) + 20; }
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Photos', M, y);
    y += 14;
    for (const photo of document.photos.slice(0, 6)) {
      const abs = path.isAbsolute(photo.url)
        ? photo.url
        : path.join(__dirname, '../..', String(photo.url).replace(/^\//, ''));
      if (existsSync(abs)) {
        if (y > 620) { doc.addPage(); y = brandHeader(doc) + 20; }
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

  if (y > 600) { doc.addPage(); y = brandHeader(doc) + 20; }
  doc.fillColor(C.black).font('Helvetica-Bold').fontSize(11).text('Terms and conditions', M, y);
  y += 16;
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  for (const term of COMPANY.quoteTerms) {
    doc.text(`• ${term}`, M, y, { width: W });
    y += doc.heightOfString(`• ${term}`, { width: W }) + 4;
  }
  y += 12;

  if (document.options?.show_payment !== false) {
    if (y > 560) { doc.addPage(); y = brandHeader(doc) + 20; }
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('Payment information', M, y);
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted);
    doc.text(COMPANY.payment.intro, M, y, { width: W });
    y += doc.heightOfString(COMPANY.payment.intro, { width: W }) + 10;
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(9).text(COMPANY.payment.interac.label, M, y);
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted);
    doc.text(`Send to: ${COMPANY.payment.interac.email}`, M, y); y += 11;
    doc.text(COMPANY.payment.interac.note, M, y); y += 14;
    doc.fillColor(C.green).font('Helvetica-Bold').fontSize(9).text(COMPANY.payment.bank.label, M, y);
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted);
    doc.text(`${COMPANY.payment.bank.institution} · Transit ${COMPANY.payment.bank.transit} · Inst. ${COMPANY.payment.bank.institutionNumber} · Compte ${COMPANY.payment.bank.account}`, M, y, { width: W });
    y += 20;
  }

  if (document.options?.show_signature !== false) {
    if (y > 620) { doc.addPage(); y = brandHeader(doc) + 20; }
    doc.fillColor(C.black).font('Helvetica-Bold').fontSize(10).text('To confirm the order', M, y);
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor(C.muted);
    doc.text(
      `Please return this signed quote to ${COMPANY.email}. We will follow up with a production schedule.`,
      M, y, { width: W }
    );
    y += 36;
    doc.fillColor(C.black).font('Helvetica').fontSize(9);
    doc.text('Client signature: ______________________________________', M, y);
    y += 24;
    const acceptLabel = quote.acceptance_date
      ? `Acceptance date: ${fmtDate(quote.acceptance_date)}`
      : 'Date: ______________________________________';
    doc.text(acceptLabel, M, y);
  }

  if (quote.quote_number) {
    doc.fontSize(7).fillColor(C.light)
      .text(`${title} · ${COMPANY.tradeName} · ${quote.quote_number}`, M, 750, { align: 'center', width: W });
  }

  doc.end();
}

export { calcTaxes, money as formatMoney };
