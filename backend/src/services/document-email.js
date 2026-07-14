import pool from '../db/pool.js';
import { sendEmail } from './email.js';
import { generateInvoicePdf, generateQuotePdf } from './pdf.js';
import { getCompanyConfig, getEmailSignatureText } from './company-config.js';
import { Writable } from 'stream';

function bufferFromPdf(generator, doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({
      write(chunk, _, cb) { chunks.push(chunk); cb(); },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    generator(doc, sink).catch(reject);
  });
}

async function loadDocument(type, docId) {
  const isQuote = type === 'quote';
  const { rows } = await pool.query(isQuote ? `
    SELECT q.*, c.name as client_name, c.email, c.contact, c.address as client_address, c.city as client_city, p.name as project_name
    FROM quotes q LEFT JOIN clients c ON c.id=q.client_id LEFT JOIN projects p ON p.id=q.project_id WHERE q.id=$1
  ` : `
    SELECT i.*, c.name as client_name, c.email, c.contact, c.address as client_address, c.city as client_city, p.name as project_name
    FROM invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=$1
  `, [docId]);
  return rows[0] || null;
}

function greetingName(doc) {
  const raw = String(doc.contact || doc.client_name || '').trim();
  if (!raw) return '';
  // Prénom si "Prénom Nom"
  const first = raw.split(/\s+/)[0];
  return first || raw;
}

export async function buildDocumentEmailDraft(type, docId) {
  const isQuote = type === 'quote';
  const doc = await loadDocument(type, docId);
  if (!doc) throw new Error('Document introuvable');

  const company = await getCompanyConfig();
  const signature = getEmailSignatureText(company);
  const number = isQuote ? doc.quote_number : doc.invoice_number;
  const kind = isQuote ? 'devis' : 'facture';
  const filename = isQuote ? `devis-${number}.pdf` : `facture-${number}.pdf`;
  const hello = greetingName(doc);
  const subject = isQuote
    ? `Devis ${number} — Neya Furniture`
    : `Facture ${number} — Neya Furniture`;

  const text = [
    `Bonjour${hello ? ` ${hello}` : ''},`,
    '',
    `Veuillez trouver ci-joint votre ${kind}${number ? ` ${number}` : ''}${doc.title ? ` (${doc.title})` : ''}.`,
    '',
    isQuote
      ? 'N’hésitez pas à me revenir si vous avez des questions ou des ajustements.'
      : 'Vous trouverez les modalités de paiement dans le document. Merci !',
    '',
    signature || '—\nNeya Furniture',
  ].join('\n');

  return {
    type,
    doc_id: Number(docId),
    kind_label: isQuote ? 'Devis' : 'Facture',
    number,
    title: doc.title || null,
    client_name: doc.client_name || null,
    to: doc.email || '',
    subject,
    text,
    filename,
    has_client_email: Boolean(doc.email),
    warning: doc.email ? null : 'Ce client n’a pas de courriel. Indiquez une adresse avant l’envoi.',
  };
}

export async function sendDocumentEmail(type, docId, opts = {}) {
  const isQuote = type === 'quote';
  const doc = await loadDocument(type, docId);
  if (!doc) throw new Error('Document introuvable');

  const draft = await buildDocumentEmailDraft(type, docId);
  const to = String(opts.to || draft.to || '').trim();
  const subject = String(opts.subject || draft.subject || '').trim();
  const text = String(opts.text || draft.text || '').trim();

  if (!to) throw new Error('Courriel destinataire requis');
  if (!subject) throw new Error('Objet du message requis');
  if (!text) throw new Error('Corps du message requis');
  if (opts.requireConfirm && opts.confirmed !== true) {
    throw new Error('Confirmation requise avant envoi');
  }

  const pdfBuffer = await bufferFromPdf(
    isQuote ? generateQuotePdf : generateInvoicePdf,
    doc
  );

  await sendEmail({
    to,
    subject,
    text,
    attachments: [{
      filename: draft.filename,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });

  if (isQuote) {
    await pool.query("UPDATE quotes SET status='sent' WHERE id=$1 AND status='draft'", [docId]);
  } else {
    await pool.query("UPDATE invoices SET status='sent' WHERE id=$1 AND status='draft'", [docId]);
  }

  return {
    ok: true,
    to,
    subject,
    message: `${draft.kind_label} envoyé(e) à ${to}`,
  };
}
