import pool from '../db/pool.js';
import { sendEmail } from './email.js';
import { generateInvoicePdf, generateQuotePdf } from './pdf.js';
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

export async function sendDocumentEmail(type, docId) {
  const isQuote = type === 'quote';
  const { rows } = await pool.query(isQuote ? `
    SELECT q.*, c.name as client_name, c.email, c.contact, c.address as client_address, c.city as client_city, p.name as project_name
    FROM quotes q LEFT JOIN clients c ON c.id=q.client_id LEFT JOIN projects p ON p.id=q.project_id WHERE q.id=$1
  ` : `
    SELECT i.*, c.name as client_name, c.email, c.contact, c.address as client_address, c.city as client_city, p.name as project_name
    FROM invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=$1
  `, [docId]);

  const doc = rows[0];
  if (!doc) throw new Error('Document introuvable');
  if (!doc.email) throw new Error('Le client n\'a pas de courriel');

  const pdfBuffer = await bufferFromPdf(
    isQuote ? generateQuotePdf : generateInvoicePdf,
    doc
  );

  const filename = isQuote ? `devis-${doc.quote_number}.pdf` : `facture-${doc.invoice_number}.pdf`;
  const subject = isQuote
    ? `Devis ${doc.quote_number} — Neya Furniture`
    : `Facture #${doc.invoice_number} — Neya Furniture`;

  await sendEmail({
    to: doc.email,
    subject,
    text: `Bonjour${doc.client_name ? ` ${doc.client_name}` : ''},\n\nVeuillez trouver ci-joint votre ${isQuote ? 'devis' : 'facture'}.\n\nNeya Furniture\nneyafurniture.ca`,
    attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
  });

  if (isQuote) {
    await pool.query("UPDATE quotes SET status='sent' WHERE id=$1 AND status='draft'", [docId]);
  } else {
    await pool.query("UPDATE invoices SET status='sent' WHERE id=$1 AND status='draft'", [docId]);
  }

  return { ok: true, to: doc.email };
}
