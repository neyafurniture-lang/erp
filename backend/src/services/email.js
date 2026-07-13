import { getAllSettings } from './settings.js';

export async function getEmailConfig() {
  const s = await getAllSettings();
  return {
    enabled: Boolean(s.smtp_host && s.smtp_user),
    host: s.smtp_host || '',
    port: Number(s.smtp_port) || 587,
    user: s.smtp_user || '',
    pass: s.smtp_pass || '',
    from: s.smtp_from || s.company_email || 'neyafurniture@gmail.com',
  };
}

export async function sendEmail({ to, subject, text, html, attachments = [] }) {
  const cfg = await getEmailConfig();
  if (!cfg.enabled) {
    throw new Error('SMTP non configuré — Paramètres → Courriel');
  }
  if (!to) throw new Error('Destinataire requis');

  const nodemailer = await import('nodemailer');
  const transport = nodemailer.default.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  await transport.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
    html: html || text?.replace(/\n/g, '<br>'),
    attachments,
  });
  return { ok: true, to };
}
