import pool from '../db/pool.js';

export function calcDocTotals(lines) {
  const subtotal = (lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const gst = subtotal * 0.05;
  const qst = subtotal * 0.09975;
  return { subtotal, total: subtotal + gst + qst, tax_rate: 14.975 };
}

export async function nextQuoteNumber() {
  const { rows } = await pool.query('SELECT COUNT(*)::int as c FROM quotes');
  const year = new Date().getFullYear();
  return `Q-${year}-${String(rows[0].c + 1).padStart(3, '0')}`;
}

export async function nextInvoiceNumber() {
  const { rows } = await pool.query(`
    SELECT invoice_number FROM invoices
    WHERE invoice_number ~ '^[0-9]+$'
    ORDER BY CAST(invoice_number AS INTEGER) DESC LIMIT 1
  `);
  const base = rows[0] ? parseInt(rows[0].invoice_number, 10) : 1026;
  return String(base + 1);
}

export async function createQuoteRecord({ client_id, project_id, title, lines, notes }) {
  const quote_number = await nextQuoteNumber();
  const { subtotal, total } = calcDocTotals(lines);
  const { rows } = await pool.query(
    `INSERT INTO quotes (project_id, client_id, quote_number, status, lines, subtotal, tax_rate, total, notes, title)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9) RETURNING *`,
    [project_id || null, client_id, quote_number, JSON.stringify(lines || []), subtotal, 14.975, total, notes || null, title || 'Devis']
  );
  return rows[0];
}

export async function createInvoiceRecord({ client_id, project_id, title, lines, notes, due_date }) {
  const invoice_number = await nextInvoiceNumber();
  const { subtotal, total } = calcDocTotals(lines);
  const due = due_date || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
  const { rows } = await pool.query(
    `INSERT INTO invoices (project_id, client_id, invoice_number, status, lines, subtotal, tax_rate, total, due_date, notes, title, terms)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,'Net 30') RETURNING *`,
    [project_id || null, client_id, invoice_number, JSON.stringify(lines || []), subtotal, 14.975, total, due, notes || null, title || 'Facture']
  );
  return rows[0];
}

export async function convertQuoteToInvoice(quoteId, depositPercent = 100) {
  const { rows: quotes } = await pool.query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  if (!quotes[0]) throw new Error('Devis introuvable');
  const q = quotes[0];
  const pct = Math.min(100, Math.max(1, Number(depositPercent) || 100));
  const rawLines = typeof q.lines === 'string' ? JSON.parse(q.lines) : (q.lines || []);
  const lines = rawLines.map(l => ({
    ...l,
    price: Number(l.price) * (pct / 100),
    description: pct < 100 ? `${l.description} — ${pct}% acompte` : l.description,
  }));
  const inv = await createInvoiceRecord({
    client_id: q.client_id,
    project_id: q.project_id,
    title: q.title,
    lines,
    notes: q.notes,
  });
  await pool.query('UPDATE invoices SET quote_id=$1 WHERE id=$2', [q.id, inv.id]);
  await pool.query("UPDATE quotes SET status='accepted' WHERE id=$1", [q.id]);
  const { rows } = await pool.query('SELECT * FROM invoices WHERE id=$1', [inv.id]);
  return rows[0];
}
