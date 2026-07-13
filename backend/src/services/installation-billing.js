import pool from '../db/pool.js';
import { calcDocTotals } from './invoice-helpers.js';

const FR_MONTHS = {
  janvier: 1, jan: 1,
  fevrier: 2, février: 2, fev: 2, fév: 2,
  mars: 3,
  avril: 4, avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7, juil: 7,
  aout: 8, août: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, décembre: 12, dec: 12, déc: 12,
};

const EN_MONTHS = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  if (year < 2020 || year > 2035) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function excerptAround(text, index, len = 90) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + len);
  let slice = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) slice = `…${slice}`;
  if (end < text.length) slice = `${slice}…`;
  return slice;
}

/** Extrait des dates ISO depuis un texte (courriels FR/EN). */
export function extractDatesFromText(text, subject = '') {
  if (!text || typeof text !== 'string') return [];
  const hay = `${subject} ${text}`.replace(/\u00a0/g, ' ');
  const found = new Map();

  function addMatch(iso, index, raw) {
    if (!iso || found.has(iso)) return;
    found.set(iso, {
      date: iso,
      label: new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-CA', {
        weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
      }),
      source: excerptAround(hay, index),
      raw: raw.trim(),
    });
  }

  const isoRe = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
  let m;
  while ((m = isoRe.exec(hay)) !== null) {
    addMatch(toIsoDate(m[1], m[2], m[3]), m.index, m[0]);
  }

  const dmyRe = /\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](20\d{2}|(\d{2}))\b/g;
  while ((m = dmyRe.exec(hay)) !== null) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    addMatch(toIsoDate(year, m[2], m[1]), m.index, m[0]);
  }

  const frRe = /\b(?:le\s+)?(\d{1,2})(?:er)?\s+(janvier|f[eé]vrier|fevrier|mars|avril|mai|juin|juillet|ao[uû]t|aout|septembre|octobre|novembre|d[eé]cembre|decembre)(?:\s+(\d{4}))?\b/gi;
  while ((m = frRe.exec(hay)) !== null) {
    const monthKey = m[2].toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const month = FR_MONTHS[monthKey] || FR_MONTHS[m[2].toLowerCase()];
    const year = m[3] || String(new Date().getFullYear());
    addMatch(toIsoDate(year, month, m[1]), m.index, m[0]);
  }

  const enRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/gi;
  while ((m = enRe.exec(hay)) !== null) {
    const month = EN_MONTHS[m[1].toLowerCase().replace('.', '')];
    addMatch(toIsoDate(m[3], month, m[2]), m.index, m[0]);
  }

  const enRe2 = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(20\d{2})\b/gi;
  while ((m = enRe2.exec(hay)) !== null) {
    const month = EN_MONTHS[m[2].toLowerCase().replace('.', '')];
    addMatch(toIsoDate(m[3], month, m[1]), m.index, m[0]);
  }

  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function defaultBillingBlock() {
  return {
    contact_name: '',
    contact_email: '',
    invoice_id: null,
    dates: [],
    scanned_at: null,
  };
}

export function getInstallationBillingFromMeta(meta) {
  const m = parseMeta(meta);
  const block = { ...defaultBillingBlock(), ...(m.installation_billing || {}) };
  block.dates = (block.dates || []).map(d => ({
    date: d.date,
    label: d.label || d.date,
    source: d.source || '',
    source_subject: d.source_subject || '',
    hours: Number(d.hours) || 0,
    fee: Number(d.fee) || 0,
    billed: Boolean(d.billed),
    note: d.note || '',
  }));
  return block;
}

async function fetchProjectMailTexts(projectId) {
  const { rows: fromProjectEmails } = await pool.query(`
    SELECT
      COALESCE(em.subject, pe.subject) AS subject,
      TRIM(COALESCE(em.snippet, pe.snippet, '') || ' ' || COALESCE(em.body_text, '')) AS text,
      COALESCE(em.sent_at, pe.linked_at) AS sent_at,
      pe.gmail_message_id
    FROM project_emails pe
    LEFT JOIN email_messages em ON em.gmail_message_id = pe.gmail_message_id
    WHERE pe.project_id = $1
  `, [projectId]);

  const { rows: fromThreads } = await pool.query(`
    SELECT em.subject, TRIM(COALESCE(em.snippet, '') || ' ' || COALESCE(em.body_text, '')) AS text,
           em.sent_at, em.gmail_message_id
    FROM email_messages em
    JOIN email_threads et ON et.id = em.thread_id
    WHERE et.project_id = $1
  `, [projectId]);

  const seen = new Set();
  const merged = [];
  for (const row of [...fromProjectEmails, ...fromThreads]) {
    const key = row.gmail_message_id || `${row.subject}:${row.text?.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      subject: row.subject || '',
      text: [row.subject, row.text].filter(Boolean).join('\n'),
      sent_at: row.sent_at,
    });
  }
  merged.sort((a, b) => new Date(b.sent_at || 0) - new Date(a.sent_at || 0));
  return merged;
}

export async function scanProjectInstallationDates(projectId) {
  const { rows: projects } = await pool.query(
    'SELECT id, name, meta, client_id FROM projects WHERE id = $1',
    [projectId]
  );
  if (!projects[0]) throw new Error('Projet introuvable');

  const project = projects[0];
  const meta = parseMeta(project.meta);
  const current = getInstallationBillingFromMeta(meta);
  const byDate = new Map(current.dates.map(d => [d.date, d]));

  const mails = await fetchProjectMailTexts(projectId);
  const discovered = [];

  for (const mail of mails) {
    for (const hit of extractDatesFromText(mail.text, mail.subject)) {
      discovered.push({ ...hit, source_subject: mail.subject });
      if (!byDate.has(hit.date)) {
        byDate.set(hit.date, {
          date: hit.date,
          label: hit.label,
          source: hit.source,
          source_subject: mail.subject,
          hours: 0,
          fee: 0,
          billed: false,
          note: '',
        });
      } else {
        const existing = byDate.get(hit.date);
        if (!existing.source && hit.source) existing.source = hit.source;
        if (!existing.source_subject && mail.subject) existing.source_subject = mail.subject;
        if (!existing.label) existing.label = hit.label;
      }
    }
  }

  const dates = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const nextBlock = {
    ...current,
    dates,
    scanned_at: new Date().toISOString(),
    mail_count: mails.length,
    discovered_count: discovered.length,
  };

  meta.installation_billing = nextBlock;
  await pool.query('UPDATE projects SET meta = $1::jsonb WHERE id = $2', [JSON.stringify(meta), projectId]);

  return {
    project_id: projectId,
    project_name: project.name,
    ...nextBlock,
    new_dates: discovered.filter(d => !current.dates.some(x => x.date === d.date)).map(d => d.date),
  };
}

export async function saveInstallationBilling(projectId, payload = {}) {
  const { rows: projects } = await pool.query(
    'SELECT id, meta, client_id, name FROM projects WHERE id = $1',
    [projectId]
  );
  if (!projects[0]) throw new Error('Projet introuvable');

  const project = projects[0];
  const meta = parseMeta(project.meta);
  const current = getInstallationBillingFromMeta(meta);

  const dates = Array.isArray(payload.dates)
    ? payload.dates.map(d => ({
      date: d.date,
      label: d.label || d.date,
      source: d.source || '',
      source_subject: d.source_subject || '',
      hours: Math.max(0, Number(d.hours) || 0),
      fee: Math.max(0, Number(d.fee) || 0),
      billed: Boolean(d.billed),
      note: d.note || '',
    }))
    : current.dates;

  const nextBlock = {
    ...current,
    contact_name: payload.contact_name != null ? String(payload.contact_name).trim() : current.contact_name,
    contact_email: payload.contact_email != null ? String(payload.contact_email).trim() : current.contact_email,
    invoice_id: payload.invoice_id != null ? payload.invoice_id : current.invoice_id,
    dates: dates.sort((a, b) => a.date.localeCompare(b.date)),
  };

  meta.installation_billing = nextBlock;
  await pool.query('UPDATE projects SET meta = $1::jsonb WHERE id = $2', [JSON.stringify(meta), projectId]);

  if (project.client_id && nextBlock.contact_name) {
    await pool.query(
      `UPDATE clients SET contact = COALESCE(NULLIF(TRIM(contact), ''), $1)
       WHERE id = $2 AND (contact IS NULL OR TRIM(contact) = '')`,
      [nextBlock.contact_name, project.client_id]
    );
  }
  if (project.client_id && nextBlock.contact_email) {
    await pool.query(
      `UPDATE clients SET email = COALESCE(NULLIF(TRIM(email), ''), $1)
       WHERE id = $2 AND (email IS NULL OR TRIM(email) = '')`,
      [nextBlock.contact_email, project.client_id]
    );
  }

  return { project_id: projectId, project_name: project.name, ...nextBlock };
}

async function nextInvoiceNumber() {
  const { rows } = await pool.query(`
    SELECT invoice_number FROM invoices WHERE invoice_number ~ '^[0-9]+$'
    ORDER BY CAST(invoice_number AS INTEGER) DESC LIMIT 1
  `);
  const base = rows[0] ? parseInt(rows[0].invoice_number, 10) : 1026;
  return String(base + 1);
}

/** Synchronise les forfaits d'installation vers une facture (lignes forfaitaires, jamais $/h). */
export async function syncInstallationInvoice(projectId) {
  const { rows: projects } = await pool.query(
    'SELECT id, name, client_id, meta FROM projects WHERE id = $1',
    [projectId]
  );
  if (!projects[0]) throw new Error('Projet introuvable');

  const project = projects[0];
  const billing = getInstallationBillingFromMeta(project.meta);
  const billable = billing.dates.filter(d => Number(d.fee) > 0);

  if (!billable.length) {
    throw new Error('Aucun forfait renseigné — indiquez un montant forfaitaire par date');
  }

  let invoiceId = billing.invoice_id;
  const installLines = billable.map(d => ({
    description: `Installation sur place — ${d.label || d.date}${d.note ? ` (${d.note})` : ''}`,
    qty: 1,
    price: Number(d.fee),
  }));

  if (invoiceId) {
    const { rows: invRows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    if (!invRows[0]) invoiceId = null;
    else {
      const rawLines = typeof invRows[0].lines === 'string'
        ? JSON.parse(invRows[0].lines)
        : (invRows[0].lines || []);
      const prefix = 'Installation sur place —';
      const kept = rawLines.filter(l => !String(l.description || '').startsWith(prefix));
      const lines = [...kept, ...installLines];
      const { subtotal, total } = calcDocTotals(lines);
      await pool.query(
        `UPDATE invoices SET lines = $1, subtotal = $2, total = $3 WHERE id = $4`,
        [JSON.stringify(lines), subtotal, total, invoiceId]
      );
    }
  }

  if (!invoiceId) {
    const { rows: existing } = await pool.query(
      `SELECT id FROM invoices WHERE project_id = $1 AND status IN ('draft', 'sent', 'partial')
       ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    if (existing[0]) {
      invoiceId = existing[0].id;
      const { rows: invRows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
      const rawLines = typeof invRows[0].lines === 'string'
        ? JSON.parse(invRows[0].lines)
        : (invRows[0].lines || []);
      const prefix = 'Installation sur place —';
      const kept = rawLines.filter(l => !String(l.description || '').startsWith(prefix));
      const lines = [...kept, ...installLines];
      const { subtotal, total } = calcDocTotals(lines);
      await pool.query(
        `UPDATE invoices SET lines = $1, subtotal = $2, total = $3 WHERE id = $4`,
        [JSON.stringify(lines), subtotal, total, invoiceId]
      );
    } else {
      const invoice_number = await nextInvoiceNumber();
      const { subtotal, total } = calcDocTotals(installLines);
      const title = project.name;
      const { rows: created } = await pool.query(
        `INSERT INTO invoices (project_id, client_id, invoice_number, status, lines, subtotal, tax_rate, total, title, notes)
         VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          projectId,
          project.client_id,
          invoice_number,
          JSON.stringify(installLines),
          subtotal,
          14.975,
          total,
          title,
          billing.contact_name ? `Contact : ${billing.contact_name}` : null,
        ]
      );
      invoiceId = created[0].id;
    }
  }

  const meta = parseMeta(project.meta);
  meta.installation_billing = {
    ...billing,
    invoice_id: invoiceId,
    dates: billing.dates.map(d => ({
      ...d,
      billed: Number(d.fee) > 0 ? true : d.billed,
    })),
  };
  await pool.query('UPDATE projects SET meta = $1::jsonb WHERE id = $2', [JSON.stringify(meta), projectId]);

  const { rows: invoice } = await pool.query(
    'SELECT id, invoice_number, total, status FROM invoices WHERE id = $1',
    [invoiceId]
  );

  return {
    invoice: invoice[0],
    lines_added: installLines.length,
    billing: meta.installation_billing,
  };
}

export async function getInstallationBilling(projectId) {
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.meta, p.client_id, c.name AS client_name, c.contact, c.email AS client_email
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.id = $1
  `, [projectId]);
  if (!rows[0]) throw new Error('Projet introuvable');

  const billing = getInstallationBillingFromMeta(rows[0].meta);
  if (!billing.contact_name && rows[0].contact) billing.contact_name = rows[0].contact;
  if (!billing.contact_email && rows[0].client_email) billing.contact_email = rows[0].client_email;

  const { rows: invoices } = await pool.query(
    `SELECT id, invoice_number, status, total FROM invoices WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );

  return {
    project_id: rows[0].id,
    project_name: rows[0].name,
    client_id: rows[0].client_id,
    client_name: rows[0].client_name,
    billing,
    invoices,
  };
}
