'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getApiUrl, getToken } from '../lib/api';
import { decodeHtmlEntities, readableMailBody } from '../lib/mail-text';
import { threadApi } from '../lib/mail-threads';
import { connectGoogle, getGoogleStatus } from '../lib/google';

/** Dossiers Gmail natifs (style boîte Gmail). */
const SYSTEM_FOLDERS = [
  { id: 'inbox', label: 'Boîte de réception', gmailLabel: 'INBOX' },
  { id: 'sent', label: 'Envoyés', gmailLabel: 'SENT' },
];

/** Tri ERP (labels NEYA/). */
const ERP_FOLDERS = [
  { id: 'a_repondre', label: 'À répondre', color: '#D86B30' },
  { id: 'clients', label: 'Clients', color: '#2563eb' },
  { id: 'fournisseurs', label: 'Fournisseurs', color: '#0F766E' },
  { id: 'projets', label: 'Projets liés', color: '#7c3aed' },
  { id: 'promotions', label: 'Promotions', color: '#64748b' },
  { id: 'autres', label: 'Non classés', color: '#a3a3a3' },
];

/** Chips filtre liste (Craft Flow). */
const LIST_FILTERS = [
  { id: 'tous', label: 'Tous' },
  { id: 'unread', label: 'Non-lus' },
  { id: 'a_repondre', label: 'À répondre' },
  { id: 'clients', label: 'Clients' },
  { id: 'fournisseurs', label: 'Fournisseurs' },
];

const ALL_FOLDER_LABELS = {
  inbox: 'Boîte de réception',
  sent: 'Envoyés',
  ...Object.fromEntries(ERP_FOLDERS.map(s => [s.id, s.label])),
};

const CATEGORY_BADGE = {
  a_repondre: { label: 'Répondre', className: 'mail-badge mail-badge--reply' },
  clients: { label: 'Client', className: 'mail-badge mail-badge--client' },
  fournisseurs: { label: 'Fournisseur', className: 'mail-badge mail-badge--supplier' },
  projets: { label: 'Projet', className: 'mail-badge mail-badge--project' },
  promotions: { label: 'Promo', className: 'mail-badge mail-badge--promo' },
  autres: { label: 'Autre', className: 'mail-badge mail-badge--other' },
};

const AVATAR_COLORS = [
  '#D86B30', '#B85A28', '#0F766E', '#1D4ED8', '#BE185D',
  '#C2410C', '#4338CA', '#047857', '#9A3412', '#334155',
];

const UNDO_MS = 8000;

function parseKeyPoints(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function parseSender(from = '') {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim() };
  if (from.includes('@')) return { name: from.split('@')[0], email: from };
  return { name: from || 'Inconnu', email: '' };
}

function getInitials(from = '') {
  const { name, email } = parseSender(from);
  const base = name || email;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (base.slice(0, 2) || '?').toUpperCase();
}

function avatarColor(from = '') {
  let hash = 0;
  const s = from || 'x';
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatMailDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('fr-CA', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function formatAttSize(n) {
  const size = Number(n) || 0;
  if (!size) return '';
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function attIcon(mime = '', name = '') {
  const m = `${mime} ${name}`.toLowerCase();
  if (/pdf/.test(m)) return '📄';
  if (/image|png|jpe?g|gif|webp|heic/.test(m)) return '🖼️';
  if (/sheet|excel|xls|csv/.test(m)) return '📊';
  if (/word|doc/.test(m)) return '📝';
  if (/zip|rar|7z/.test(m)) return '📦';
  return '📎';
}

/** Nettoyage léger avant iframe (scripts / handlers). */
function sanitizeEmailHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/\son\w+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/data:text\/html/gi, 'data:text/plain');
}

function buildMailSrcDoc(html) {
  const safe = sanitizeEmailHtml(html);
  // Si le mail est déjà un document complet, injecter base + CSS sans double html
  const hasDoc = /<html[\s>]/i.test(safe);
  const baseCss = `html,body{margin:0!important;padding:20px 24px!important;background:#fff;color:#0d0b09;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;word-wrap:break-word;overflow-wrap:anywhere;-webkit-text-size-adjust:100%;box-sizing:border-box}
*,*:before,*:after{box-sizing:border-box}
img,video{max-width:100%!important;height:auto!important}
a{color:#D86B30}
table{max-width:100%!important}
blockquote{margin:0.75em 0;padding-left:1em;border-left:3px solid #e6e4e2;color:#666}
pre,code{white-space:pre-wrap;word-break:break-word}
p{margin:0 0 0.85em}
@media (min-width:640px){html,body{padding:24px 40px!important}}
@media (min-width:1024px){html,body{padding:28px 48px!important}}`;
  if (hasDoc) {
    let doc = safe;
    if (!/<base[\s>]/i.test(doc)) {
      doc = doc.replace(/<head([^>]*)>/i, '<head$1><base target="_blank" rel="noopener noreferrer">');
    }
    if (/<\/head>/i.test(doc)) {
      doc = doc.replace(/<\/head>/i, `<style>${baseCss}</style></head>`);
    } else {
      doc = `<style>${baseCss}</style>${doc}`;
    }
    return doc;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank" rel="noopener noreferrer"><style>${baseCss}</style></head><body>${safe}</body></html>`;
}

function MailHtmlBody({ html }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(280);
  const srcDoc = useMemo(() => buildMailSrcDoc(html), [html]);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return undefined;

    function resize() {
      try {
        const doc = iframe.contentDocument;
        if (!doc?.body) return;
        const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight || 0, 120);
        setHeight(Math.min(h + 12, 16000));
      } catch {
        /* ignore */
      }
    }

    iframe.addEventListener('load', resize);
    const t = setTimeout(resize, 80);
    return () => {
      iframe.removeEventListener('load', resize);
      clearTimeout(t);
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title="Contenu du courriel"
      className="mail-html-frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}

function sortMailItems(items = []) {
  return [...items].sort((a, b) => {
    const ur = Number(Boolean(b.isUnread || b.unread)) - Number(Boolean(a.isUnread || a.unread));
    if (ur) return ur;
    return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
  });
}

/** Sous-groupes fournisseurs (Home Depot, Rona…) puis messages triés. */
function groupBySupplier(items = []) {
  const sorted = sortMailItems(items);
  const map = new Map();
  for (const m of sorted) {
    const key = m.supplierLabel || 'Autre fournisseur';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([label, groupItems]) => ({ label, items: groupItems }));
}

function IconSearch() {
  return (
    <svg className="w-4 h-4 text-neya-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
    </svg>
  );
}

function IconRefresh({ spin }) {
  return (
    <svg className={`w-4 h-4 ${spin ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.36-6.36M20 15a9 9 0 01-15.36 6.36" />
    </svg>
  );
}

function IconArchive() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4" />
    </svg>
  );
}

function IconMailRead() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 12v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m22 7-8.97 5.7a2 2 0 01-2.06 0L2 7" />
    </svg>
  );
}

function IconMailUnread() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m22 6-10 7L2 6" />
    </svg>
  );
}

function IconBack() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  );
}

function IconInbox({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4m16 0H4" />
    </svg>
  );
}

function IconSent({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3 21l18-9L3 3l3 9zm0 0h7" />
    </svg>
  );
}

function IconFolder({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function EmptyState({ title, children }) {
  return (
    <div className="mail-empty">
      <div className="mail-empty__orb" aria-hidden />
      <p className="mail-empty__title">{title}</p>
      <div className="mail-empty__text">{children}</div>
    </div>
  );
}

function UndoToast({ toast, onUndo, onDismiss }) {
  if (!toast) return null;
  return (
    <div className="mail-undo-toast" role="status">
      <span className="text-sm text-white flex-1">{toast.message}</span>
      {toast.undo && (
        <button type="button" onClick={onUndo} className="text-sm font-semibold text-amber-300 hover:text-amber-200 px-2">
          Annuler
        </button>
      )}
      <button type="button" onClick={onDismiss} className="text-white/60 hover:text-white px-1 text-lg leading-none" aria-label="Fermer">
        ×
      </button>
    </div>
  );
}

function MailAttachments({
  messageId,
  attachments = [],
  projects = [],
  defaultProjectId = '',
  defaultProjectName = '',
  onFiled,
  onError,
}) {
  const [filingId, setFilingId] = useState(null);
  const [pickFor, setPickFor] = useState(null);
  const [pickProjectId, setPickProjectId] = useState(defaultProjectId || '');
  const [busyAll, setBusyAll] = useState(false);

  useEffect(() => {
    setPickProjectId(defaultProjectId || '');
  }, [defaultProjectId, messageId]);

  if (!attachments.length) return null;

  async function openAttachment(att, { download = false } = {}) {
    // Ouvrir la fenêtre tout de suite (sinon bloqué après le fetch async)
    const previewWin = !download ? window.open('about:blank', '_blank') : null;
    try {
      const token = getToken();
      const q = download ? '' : '?inline=1';
      const res = await fetch(
        `${getApiUrl()}/gmail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(att.id)}${q}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erreur ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (download || !previewWin || previewWin.closed) {
        if (previewWin && !previewWin.closed) previewWin.close();
        const a = document.createElement('a');
        a.href = url;
        a.download = att.filename || 'piece-jointe';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        try {
          previewWin.location.href = url;
          previewWin.document.title = att.filename || 'Pièce jointe';
        } catch {
          previewWin.close();
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }
      setTimeout(() => URL.revokeObjectURL(url), 180000);
    } catch (e) {
      if (previewWin && !previewWin.closed) {
        try { previewWin.close(); } catch { /* ignore */ }
      }
      onError?.(e.message);
    }
  }

  async function fileOne(att, projectId) {
    if (!projectId) {
      setPickFor(att.id);
      setPickProjectId(defaultProjectId || '');
      return;
    }
    setFilingId(att.id);
    try {
      const result = await api(
        `/gmail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(att.id)}/file-to-project`,
        {
          method: 'POST',
          body: JSON.stringify({ project_id: Number(projectId), upload_drive: true }),
        }
      );
      setPickFor(null);
      onFiled?.(result);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setFilingId(null);
    }
  }

  async function fileAll(projectId) {
    const pid = projectId || defaultProjectId;
    if (!pid) {
      setPickFor('__all__');
      setPickProjectId('');
      return;
    }
    setBusyAll(true);
    try {
      const result = await api(
        `/gmail/messages/${encodeURIComponent(messageId)}/file-attachments-to-project`,
        {
          method: 'POST',
          body: JSON.stringify({ project_id: Number(pid), upload_drive: true }),
        }
      );
      setPickFor(null);
      onFiled?.(result);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusyAll(false);
    }
  }

  const projectLabel = defaultProjectName
    || projects.find(p => String(p.id) === String(defaultProjectId))?.name
    || '';

  return (
    <div className="mail-attachments">
      <div className="mail-attachments__head">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neya-muted">
          Pièces jointes ({attachments.length})
        </p>
        <button
          type="button"
          disabled={busyAll}
          onClick={() => fileAll(defaultProjectId)}
          className="text-[11.5px] font-semibold text-neya-orange hover:underline disabled:opacity-40"
        >
          {busyAll
            ? 'Classement…'
            : projectLabel
              ? `Tout classer → ${projectLabel}`
              : 'Tout classer dans un projet'}
        </button>
      </div>

      <ul className="mail-attachments__list">
        {attachments.map(att => (
          <li key={att.id} className="mail-attachments__item">
            <button
              type="button"
              className="mail-attachments__open"
              onClick={() => openAttachment(att)}
              title="Ouvrir"
            >
              <span className="text-base leading-none" aria-hidden>{attIcon(att.mimeType, att.filename)}</span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-medium text-neya-ink">{att.filename}</span>
                <span className="block text-[11px] text-neya-muted">
                  {[att.mimeType?.split(';')[0], formatAttSize(att.size)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
            <div className="mail-attachments__actions">
              <button
                type="button"
                className="mail-icon-btn"
                title="Télécharger"
                aria-label="Télécharger"
                onClick={() => openAttachment(att, { download: true })}
              >
                ↓
              </button>
              <button
                type="button"
                className="mail-icon-btn"
                title={projectLabel ? `Classer dans ${projectLabel}` : 'Classer dans un projet'}
                aria-label="Classer dans un projet"
                disabled={filingId === att.id}
                onClick={() => fileOne(att, defaultProjectId)}
              >
                {filingId === att.id ? '…' : '↗'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pickFor && (
        <div className="mail-attachments__picker">
          <label className="label mb-1">
            {pickFor === '__all__' ? 'Classer toutes les PJ dans' : 'Classer dans le projet'}
          </label>
          <div className="flex gap-2">
            <select
              className="input text-sm min-h-[36px] flex-1"
              value={pickProjectId}
              onChange={e => setPickProjectId(e.target.value)}
            >
              <option value="">— Choisir un projet —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary text-xs min-h-[36px] shrink-0"
              disabled={!pickProjectId || busyAll || !!filingId}
              onClick={() => {
                if (pickFor === '__all__') fileAll(pickProjectId);
                else {
                  const att = attachments.find(a => a.id === pickFor);
                  if (att) fileOne(att, pickProjectId);
                }
              }}
            >
              Classer
            </button>
            <button
              type="button"
              className="btn-secondary text-xs min-h-[36px] shrink-0"
              onClick={() => setPickFor(null)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GmailInbox({
  projectId = null,
  linkProjectId = null,
  initialMessageId = null,
}) {
  const [connected, setConnected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const deepLinkOpened = useRef(null);
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [synthLoading, setSynthLoading] = useState(false);
  const [draftAiLoading, setDraftAiLoading] = useState(false);
  const [inboxProcessing, setInboxProcessing] = useState(false);
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [prevReply, setPrevReply] = useState(null);
  const [draftInstr, setDraftInstr] = useState('');
  const [showDraftInstr, setShowDraftInstr] = useState(false);
  const [err, setErr] = useState('');
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [linkClientId, setLinkClientId] = useState('');
  const [linkProjId, setLinkProjId] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  /** Mobile: fermé (sheet). Desktop lg: panneau latéral toujours visible via CSS. */
  const [erpOpen, setErpOpen] = useState(false);
  const [subjectExpanded, setSubjectExpanded] = useState(false);
  const [threadWarn, setThreadWarn] = useState('');
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [listFilter, setListFilter] = useState('tous');
  const [showComposeNew, setShowComposeNew] = useState(false);
  const [composeNew, setComposeNew] = useState({ to: '', subject: '', body: '' });
  const [composeSending, setComposeSending] = useState(false);
  const [sections, setSections] = useState(
    [{ id: 'inbox', count: 0 }, ...ERP_FOLDERS.map(s => ({ ...s, count: 0 }))]
  );
  const [undoToast, setUndoToast] = useState(null);
  const undoTimer = useRef(null);

  const clearUndoTimer = () => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  };

  const showUndo = useCallback((message, undoFn) => {
    clearUndoTimer();
    setUndoToast({ message, undo: undoFn || null });
    undoTimer.current = setTimeout(() => setUndoToast(null), UNDO_MS);
  }, []);

  const dismissUndo = () => {
    clearUndoTimer();
    setUndoToast(null);
  };

  const runUndo = async () => {
    const fn = undoToast?.undo;
    dismissUndo();
    if (!fn) return;
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => () => clearUndoTimer(), []);

  const load = useCallback(async (q = '', folder = activeFolder) => {
    setLoading(true);
    setErr('');
    try {
      if (q) {
        const data = await api(`/gmail/search?q=${encodeURIComponent(q)}`);
        setMessages(data.messages || []);
        setSections([{ id: 'inbox', count: 0 }, ...ERP_FOLDERS.map(s => ({ ...s, count: 0 }))]);
      } else if (projectId) {
        const data = await api(`/integrations/projects/${projectId}/emails`);
        setMessages(data);
        setSections([{ id: 'inbox', count: 0 }, ...ERP_FOLDERS.map(s => ({ ...s, count: 0 }))]);
        setSelected(null);
      } else if (folder === 'sent') {
        const data = await api('/gmail/messages?label=SENT&max=40');
        setMessages(data.messages || []);
      } else if (folder === 'inbox' || !folder) {
        const data = await api('/gmail/inbox-sorted?max=40');
        setMessages(data.messages || []);
        setSections(data.sections || [{ id: 'inbox', count: 0 }, ...ERP_FOLDERS.map(s => ({ ...s, count: 0 }))]);
      } else {
        // Dossier ERP : inbox triée puis filtre côté client
        const data = await api('/gmail/inbox-sorted?max=40');
        setMessages(data.messages || []);
        setSections(data.sections || [{ id: 'inbox', count: 0 }, ...ERP_FOLDERS.map(s => ({ ...s, count: 0 }))]);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeFolder, projectId]);

  useEffect(() => {
    getGoogleStatus().then(s => {
      setConnected(s.google?.connected);
      if (s.google?.connected) load('', activeFolder);
      else setLoading(false);
    }).catch(() => { setConnected(false); setLoading(false); });
    api('/clients').then(setClients).catch(() => {});
    api('/projects').then(setProjects).catch(() => {});
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectFolder(id) {
    setActiveFolder(id);
    setMobileDetail(false);
    setSelected(null);
    setThread(null);
    setReply('');
    setPrevReply(null);
    if (!search) load('', id);
  }

  async function loadThreadContext(msg) {
    const threadId = msg.threadId;
    if (!threadId) {
      setThread(null);
      return;
    }
    setThreadLoading(true);
    setThreadWarn('');
    try {
      const data = await threadApi(`/by-gmail/${threadId}`);
      setThread(data);
      setLinkClientId(data.client_id ? String(data.client_id) : '');
      setLinkProjId(data.project_id ? String(data.project_id) : '');
      if (data.latest_synthesis?.suggested_reply && !reply) {
        setReply(data.latest_synthesis.suggested_reply);
      }
    } catch (e) {
      setThread(null);
      if (isNotFoundError(e)) {
        setThreadWarn('Analyse ERP indisponible — redémarrez ou redéployez le backend.');
      } else {
        setThreadWarn(e.message);
      }
    } finally {
      setThreadLoading(false);
    }
  }

  function isNotFoundError(err) {
    return /404|introuvable|not found/i.test(String(err?.message || ''));
  }

  function patchReadState(messageId, threadId, isUnread) {
    setMessages(prev => prev.map(m => {
      const mid = m.id || m.gmail_message_id;
      const sameThread = threadId && m.threadId === threadId;
      if (mid === messageId || sameThread) {
        return { ...m, isUnread, unread: isUnread };
      }
      return m;
    }));
    setSelected(prev => {
      if (!prev) return prev;
      const pid = prev.id || prev.gmail_message_id;
      if (pid === messageId || (threadId && prev.threadId === threadId)) {
        return { ...prev, isUnread, unread: isUnread };
      }
      return prev;
    });
  }

  async function setMessageRead(messageId, threadId, { silent = false } = {}) {
    if (!messageId) return;
    patchReadState(messageId, threadId, false);
    try {
      await api(`/gmail/messages/${messageId}/read`, {
        method: 'POST',
        body: JSON.stringify({ threadId }),
      });
      if (!silent) showUndo('Marqué comme lu', null);
    } catch (e) {
      patchReadState(messageId, threadId, true);
      if (!silent) setErr(e.message);
    }
  }

  async function setMessageUnread(messageId, threadId) {
    if (!messageId) return;
    patchReadState(messageId, threadId, true);
    try {
      await api(`/gmail/messages/${messageId}/unread`, {
        method: 'POST',
        body: JSON.stringify({ threadId }),
      });
      showUndo('Marqué comme non lu', null);
    } catch (e) {
      patchReadState(messageId, threadId, false);
      setErr(e.message);
    }
  }

  async function toggleRead() {
    if (!selected?.id) return;
    const unread = selected.isUnread || selected.unread;
    if (unread) {
      await setMessageRead(selected.id, selected.threadId);
    } else {
      await setMessageUnread(selected.id, selected.threadId);
    }
  }

  async function openMessage(m) {
    const id = m.id || m.gmail_message_id;
    if (!id) return;
    setThreadLoading(true);
    setErr('');
    setThreadWarn('');
    setMobileDetail(true);
    setErpOpen(false);
    setPrevReply(null);
    setShowDraftInstr(false);

    let full = null;
    try {
      // Toujours recharger le message complet (corps + pièces jointes)
      full = await api(`/gmail/messages/${id}`);
      setSelected(full);

      // Comportement Gmail : ouvrir = marquer comme lu
      if (activeFolder !== 'sent' && (full.isUnread || m.isUnread || m.unread)) {
        setMessageRead(id, full.threadId || m.threadId, { silent: true });
      }
    } catch (e) {
      setErr(e.message);
      setSelected(null);
      setThreadLoading(false);
      return;
    }

    // Lecture d'abord (sync rapide) — l'IA ne doit pas bloquer l'ouverture
    try {
      const threadId = full?.threadId || m.threadId;
      if (threadId) await loadThreadContext({ ...m, ...full, threadId });
    } catch { /* ignore */ }

    if (activeFolder === 'sent') {
      setReply('');
      setThreadLoading(false);
      return;
    }

    setThreadLoading(false);
    try {
      const processed = await threadApi('/process-message', {
        method: 'POST',
        body: JSON.stringify({ message_id: id }),
      });
      setThread(prev => {
        // Ne jamais écraser une synthèse déjà en mémoire/DB par un échec IA
        if (processed?.synthesis_error && prev?.latest_synthesis && !processed.latest_synthesis) {
          return {
            ...processed,
            latest_synthesis: prev.latest_synthesis,
            syntheses: prev.syntheses || processed.syntheses,
            client_id: processed.client_id ?? prev.client_id,
            client_name: processed.client_name ?? prev.client_name,
          };
        }
        return processed;
      });
      setLinkClientId(processed.client_id ? String(processed.client_id) : '');
      setLinkProjId(processed.project_id ? String(processed.project_id) : (linkProjectId || projectId ? String(linkProjectId || projectId) : ''));
      if (processed.latest_synthesis?.suggested_reply || processed.synthesis?.suggested_reply) {
        setReply(processed.latest_synthesis?.suggested_reply || processed.synthesis.suggested_reply);
      }
      if (processed.synthesis_error && !processed.latest_synthesis) {
        setThreadWarn(`Synthèse : ${processed.synthesis_error}`);
      }
    } catch (e) {
      if (isNotFoundError(e)) {
        setThreadWarn('Lecture OK — analyse ERP indisponible pour ce message.');
      } else {
        setThreadWarn(e.message);
      }
    }
  }

  useEffect(() => {
    if (!initialMessageId || connected !== true) return;
    if (deepLinkOpened.current === initialMessageId) return;
    deepLinkOpened.current = initialMessageId;
    openMessage({ id: initialMessageId });
    // openMessage volontairement hors deps : ouvrir une seule fois par id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessageId, connected]);

  async function processInbox() {
    setInboxProcessing(true);
    setErr('');
    try {
      const result = await api('/gmail/sort-inbox', {
        method: 'POST',
        body: JSON.stringify({ max: 30 }),
      });
      setMessages(result.messages || []);
      setSections(result.sections || sections);
      const labeled = result.gmail_labels?.applied ?? 0;
      const msg = `${result.processed} fil(s) synchronisé(s) — boîte triée. ${labeled} label(s) Gmail NEYA appliqué(s).`;
      if (result.errors?.length || result.gmail_labels?.errors?.length) {
        const errText = result.errors?.[0]?.error || result.gmail_labels?.errors?.[0]?.error;
        setErr(`${msg} Erreur : ${errText}`);
      } else {
        showUndo(msg, null);
      }
    } catch (e) {
      try {
        const result = await threadApi('/process-inbox', {
          method: 'POST',
          body: JSON.stringify({ max: 20 }),
        });
        await load(search, activeFolder);
        showUndo(`${result.processed} conversation(s) synchronisée(s).`, null);
      } catch (fallbackErr) {
        setErr(e.message || fallbackErr.message);
      }
    } finally {
      setInboxProcessing(false);
    }
  }

  async function synthesize() {
    if (!thread?.id) return;
    setSynthLoading(true);
    setErr('');
    setThreadWarn('');
    try {
      const result = await threadApi(`/${thread.id}/synthesize`, { method: 'POST' });
      setThread(result.thread);
      setLinkClientId(result.thread?.client_id ? String(result.thread.client_id) : '');
      setLinkProjId(result.thread?.project_id ? String(result.thread.project_id) : '');
      if (result.synthesis?.suggested_reply) {
        const snapshot = reply;
        setPrevReply(snapshot);
        setReply(result.synthesis.suggested_reply);
        showUndo('Nouveau brouillon suggéré', async () => {
          setReply(snapshot);
          setPrevReply(null);
        });
      }
      if (result.thread?.client_name) {
        setThreadWarn('');
      }
    } catch (e) {
      setErr(e.message);
      setThreadWarn(`Synthèse : ${e.message}`);
    } finally {
      setSynthLoading(false);
    }
  }

  async function reviseDraftAi(mode = 'revise') {
    if (!reply.trim()) return;
    setDraftAiLoading(true);
    setErr('');
    const snapshot = reply;
    try {
      const path = thread?.id ? `/${thread.id}/revise-draft` : '/revise-draft';
      const result = await threadApi(path, {
        method: 'POST',
        body: JSON.stringify({
          draft: reply,
          instruction: mode === 'spellcheck' ? '' : (draftInstr.trim() || 'Améliore le ton et la clarté'),
          mode,
          thread_id: thread?.id || undefined,
        }),
      });
      if (result.draft) {
        setPrevReply(snapshot);
        setReply(result.draft);
        setShowDraftInstr(false);
        setDraftInstr('');
        showUndo(mode === 'spellcheck' ? 'Orthographe corrigée' : 'Brouillon modifié', async () => {
          setReply(snapshot);
          setPrevReply(null);
        });
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setDraftAiLoading(false);
    }
  }

  async function saveLinks() {
    if (!thread?.id) return;
    try {
      const updated = await threadApi(`/${thread.id}/link`, {
        method: 'POST',
        body: JSON.stringify({
          client_id: linkClientId ? Number(linkClientId) : null,
          project_id: linkProjId ? Number(linkProjId) : null,
        }),
      });
      setThread(updated);

      // Si le fil est lié à un projet et le message a des PJ → proposer le classement auto
      const atts = selected?.attachments || [];
      if (linkProjId && atts.length > 0 && selected?.id) {
        try {
          const result = await api(
            `/gmail/messages/${encodeURIComponent(selected.id)}/file-attachments-to-project`,
            {
              method: 'POST',
              body: JSON.stringify({ project_id: Number(linkProjId), upload_drive: true }),
            }
          );
          const n = result.count || result.filed?.length || 0;
          showUndo(
            n > 0
              ? `Liens enregistrés — ${n} pièce(s) classée(s) dans le projet`
              : 'Liens enregistrés',
            null
          );
        } catch {
          showUndo('Liens enregistrés (pièces jointes non classées)', null);
        }
      } else {
        showUndo('Liens enregistrés', null);
      }
    } catch (e) {
      setErr(e.message);
    }
  }

  async function sendReply() {
    if (!reply.trim() || !selected) return;
    const body = reply;
    const selectedId = selected.id;
    try {
      const sent = await api(`/gmail/messages/${selectedId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body, confirm: true }),
      });
      setReply('');
      setPrevReply(null);
      showUndo('Message envoyé', async () => {
        if (sent?.id) {
          await api(`/gmail/messages/${sent.id}?confirm=1`, { method: 'DELETE' });
          setReply(body);
          await load(search, activeFolder);
        }
      });
      load(search, activeFolder);
      if (selected.threadId) {
        const refreshed = await threadApi(`/by-gmail/${selected.threadId}`);
        setThread(refreshed);
      }
    } catch (e) {
      setErr(e.message);
    }
  }

  async function archive() {
    if (!selected?.id) return;
    const msg = selected;
    const archivedId = selected.id;
    await api(`/gmail/messages/${archivedId}/archive`, { method: 'POST' });
    setSelected(null);
    setThread(null);
    setMobileDetail(false);
    setMessages(prev => prev.filter(m => (m.id || m.gmail_message_id) !== archivedId));
    showUndo('Conversation archivée', async () => {
      await api(`/gmail/messages/${archivedId}/unarchive`, { method: 'POST' });
      await load(search, activeFolder);
      setSelected(msg);
      setMobileDetail(true);
    });
  }

  async function linkToProject(pid) {
    const id = selected?.id || selected?.gmail_message_id;
    if (!id || !pid) return;
    const result = await api('/gmail/link-project', {
      method: 'POST',
      body: JSON.stringify({ message_id: id, project_id: Number(pid) }),
    });
    if (result.thread) setThread(result.thread);
  }

  const synthesis = thread?.latest_synthesis || thread?.synthesis;
  const keyPoints = parseKeyPoints(synthesis?.key_points);
  const actionItems = parseKeyPoints(synthesis?.action_items);
  const projectsForClient = linkClientId
    ? projects.filter(p => !p.client_id || String(p.client_id) === String(linkClientId))
    : projects;

  const selectedSender = useMemo(
    () => parseSender(selected?.from || selected?.from_email || ''),
    [selected]
  );

  const filteredMessages = useMemo(() => {
    let list;
    if (activeFolder === 'inbox' || activeFolder === 'sent' || search) list = messages;
    else list = messages.filter(m => (m.mailCategory || 'autres') === activeFolder);

    if (activeFolder === 'inbox' && !search && listFilter !== 'tous') {
      if (listFilter === 'unread') {
        list = list.filter(m => m.isUnread || m.unread);
      } else {
        list = list.filter(m => (m.mailCategory || 'autres') === listFilter);
      }
    }
    return sortMailItems(list);
  }, [messages, activeFolder, search, listFilter]);

  const groupedMessages = useMemo(() => {
    if (activeFolder === 'fournisseurs' && !search) {
      return groupBySupplier(filteredMessages).map(g => ({
        id: `fournisseur:${g.label}`,
        label: g.label,
        items: g.items,
        supplierGroup: true,
      }));
    }
    // Craft Flow : liste plate (pas de sections sticky) quand filtre ou hors inbox
    if (activeFolder !== 'inbox' || search || listFilter !== 'tous') {
      return [{
        id: activeFolder,
        label: ALL_FOLDER_LABELS[activeFolder] || 'Messages',
        items: filteredMessages,
      }];
    }
    // Inbox « Tous » : groupes par catégorie NEYA (ops)
    const order = ERP_FOLDERS.map(f => f.id);
    return order
      .map(id => ({
        id,
        label: ALL_FOLDER_LABELS[id],
        items: sortMailItems(messages.filter(m => (m.mailCategory || 'autres') === id)),
      }))
      .filter(g => g.items.length > 0);
  }, [messages, filteredMessages, activeFolder, search, listFilter]);

  const sectionCounts = useMemo(
    () => Object.fromEntries(sections.map(s => [s.id, s.count])),
    [sections]
  );

  if (connected === null || (loading && !messages.length)) {
    return (
      <div className="mail-shell items-center justify-center">
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="w-6 h-6 border-2 border-neya-border border-t-neya-ink rounded-full animate-spin" />
          <p className="text-sm text-neya-muted">Chargement de la boîte de réception…</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="mail-shell">
        <EmptyState title="Gmail non connecté">
          <p className="mb-4">Configurez OAuth dans les paramètres, puis connectez votre compte Google.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/settings?tab=integrations" className="btn-primary text-sm min-h-[40px]">Paramètres</Link>
            <button type="button" onClick={connectGoogle} className="btn-secondary text-sm min-h-[40px]">Connecter Google</button>
          </div>
        </EmptyState>
      </div>
    );
  }

  const isSent = activeFolder === 'sent';

  async function sendComposeNew(e) {
    e?.preventDefault?.();
    const to = composeNew.to.trim();
    const subject = composeNew.subject.trim();
    const body = composeNew.body.trim();
    if (!to || !subject || !body) return;
    setComposeSending(true);
    setErr('');
    try {
      await api('/gmail/send', {
        method: 'POST',
        body: JSON.stringify({ to, subject, body, confirm: true }),
      });
      setShowComposeNew(false);
      setComposeNew({ to: '', subject: '', body: '' });
      showUndo('Message envoyé', null);
      if (activeFolder === 'sent') load('', 'sent');
    } catch (ex) {
      setErr(ex.message || 'Échec envoi');
    } finally {
      setComposeSending(false);
    }
  }

  return (
    <div className="mail-shell">
      {err && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100 flex items-center justify-between gap-2 shrink-0">
          <span>{err}</span>
          <button type="button" className="text-xs font-medium underline shrink-0" onClick={() => setErr('')}>Fermer</button>
        </div>
      )}

      {threadWarn && (
        <div className="px-4 py-2 text-sm text-amber-800 bg-amber-50 border-b border-amber-100 shrink-0">
          {threadWarn}
        </div>
      )}

      <div className="mail-layout min-h-0">
        <aside className="mail-sidebar">
          <div className="p-3">
            <button
              type="button"
              className="mail-compose-new"
              onClick={() => setShowComposeNew(true)}
            >
              <IconSent /> Nouveau message
            </button>
          </div>
          <div className="px-2 pb-2">
            {SYSTEM_FOLDERS.map(folder => {
              const count = folder.id === 'inbox'
                ? (sectionCounts.inbox ?? (activeFolder === 'inbox' ? messages.length : null))
                : (activeFolder === 'sent' ? messages.length : null);
              const active = activeFolder === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => { setListFilter('tous'); selectFolder(folder.id); }}
                  className={`mail-folder ${active ? 'mail-folder-active' : ''}`}
                >
                  {folder.id === 'sent' ? <IconSent /> : <IconInbox />}
                  <span className="flex-1 text-left truncate">{folder.label}</span>
                  {count > 0 && (
                    <span className={`text-[10.5px] font-semibold tabular-nums ${folder.id === 'inbox' ? 'text-neya-orange' : 'text-neya-muted'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t border-neya-border px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-neya-muted">Tri NEYA</p>
            <ul className="flex flex-col gap-0.5">
              {ERP_FOLDERS.map(folder => {
                const count = sectionCounts[folder.id] ?? 0;
                const active = activeFolder === folder.id;
                return (
                  <li key={folder.id}>
                    <button
                      type="button"
                      onClick={() => { setListFilter('tous'); selectFolder(folder.id); }}
                      className={`mail-folder ${active ? 'mail-folder-active' : ''}`}
                    >
                      <span className="mail-neya-dot" style={{ backgroundColor: folder.color }} />
                      <span className="flex-1 text-left truncate">{folder.label}</span>
                      {count > 0 && (
                        <span className={`text-[10.5px] font-semibold tabular-nums ${folder.id === 'a_repondre' ? 'text-neya-orange' : 'text-neya-muted'}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {projectId && (
            <div className="px-2 pt-1">
              <Link href={`/projects/${projectId}`} className="mail-folder">
                <IconFolder className="w-4 h-4" />
                <span>Projet lié</span>
              </Link>
            </div>
          )}
          {!isSent && (
            <div className="mt-auto p-3 border-t border-neya-border">
              <button
                type="button"
                onClick={processInbox}
                disabled={inboxProcessing}
                className="mail-btn-sort w-full justify-center"
              >
                {inboxProcessing ? 'Tri…' : 'Trier la boîte'}
              </button>
            </div>
          )}
        </aside>

        <div className={`mail-list ${mobileDetail ? 'hidden md:flex' : 'flex'}`}>
          <div className="border-b border-neya-border p-3 shrink-0">
            <div className="flex items-center gap-2">
              <div className="mail-search flex-1">
                <IconSearch />
                <input
                  placeholder="Rechercher dans les mails"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && load(search, activeFolder)}
                />
                {search && (
                  <button type="button" className="text-xs text-neya-muted hover:text-neya-ink px-1" onClick={() => { setSearch(''); load('', activeFolder); }}>
                    Effacer
                  </button>
                )}
              </div>
              <button type="button" onClick={() => load(search, activeFolder)} className="mail-icon-btn shrink-0" title="Actualiser">
                <IconRefresh spin={loading} />
              </button>
            </div>
            {activeFolder === 'inbox' && !search && (
              <div className="mail-filter-chips">
                {LIST_FILTERS.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setListFilter(f.id)}
                    className={`mail-filter-chip ${listFilter === f.id ? 'mail-filter-chip--active' : ''}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between gap-2 lg:hidden">
              <select
                className="mail-folder-select"
                value={activeFolder}
                onChange={e => selectFolder(e.target.value)}
              >
                {SYSTEM_FOLDERS.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
                {ERP_FOLDERS.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.label}{sectionCounts[f.id] ? ` (${sectionCounts[f.id]})` : ''}
                  </option>
                ))}
              </select>
              {!isSent && (
                <button
                  type="button"
                  onClick={processInbox}
                  disabled={inboxProcessing}
                  className="mail-btn-sort !min-h-[32px] !px-2.5 !text-[11px]"
                >
                  {inboxProcessing ? '…' : 'Trier'}
                </button>
              )}
            </div>
          </div>
          <div className="mail-list-scroll">
            {filteredMessages.length === 0 && !loading ? (
              <EmptyState title={activeFolder === 'inbox' ? 'Boîte vide' : 'Aucun message ici'}>
                {activeFolder === 'sent'
                  ? 'Aucun message envoyé pour le moment.'
                  : activeFolder === 'inbox'
                    ? 'Aucun message à afficher pour le moment.'
                    : `Aucun courriel dans « ${ALL_FOLDER_LABELS[activeFolder]} ». Lancez « Trier la boîte » pour classifier.`}
              </EmptyState>
            ) : (
              groupedMessages.map(group => (
                <div key={group.id}>
                  {((activeFolder === 'inbox' && !search && listFilter === 'tous') || group.supplierGroup) && group.items.length > 0 && (
                    <div className={group.supplierGroup ? 'mail-supplier-subheader' : 'mail-section-header'}>
                      <span>{group.label}</span>
                      <span className="text-neya-muted font-normal">{group.items.length}</span>
                    </div>
                  )}
                  {group.items.map(m => {
                    const id = m.id || m.gmail_message_id;
                    const from = m.from || m.from_email || '';
                    const to = m.to || '';
                    const peer = isSent ? (to || from) : from;
                    const { name } = parseSender(peer);
                    const active = (selected?.id || selected?.gmail_message_id) === id;
                    const unread = !isSent && (m.isUnread || m.unread);
                    const badge = CATEGORY_BADGE[m.mailCategory];
                    const preview = decodeHtmlEntities(m.snippet || m.bodyPreview || '');
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => openMessage(m)}
                        className={`mail-row ${active ? 'mail-row-active' : ''} ${unread ? 'mail-row-unread' : ''}`}
                      >
                        <span className={`mail-avatar ${unread ? 'mail-avatar--unread' : 'mail-avatar--read'}`}>
                          {getInitials(peer)}
                        </span>
                        <span className="mail-row-body">
                          <span className="mail-row-top">
                            <span className={`mail-row-from ${unread ? 'font-semibold text-neya-ink' : 'font-medium text-neya-ink-light'}`}>
                              {isSent ? `À : ${name}` : name}
                            </span>
                            <span className="mail-row-date">
                              {formatMailDate(m.date)}
                            </span>
                          </span>
                          <span className={`mail-row-subject ${unread ? 'font-medium text-neya-ink' : 'text-neya-ink-light'}`}>
                            {m.subject || '(sans objet)'}
                          </span>
                          {preview ? (
                            <span className="mail-row-preview">{preview}</span>
                          ) : null}
                          {badge ? (
                            <span className="mail-row-badges">
                              <span className="rounded-md bg-neya-surface px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-neya-ink-light">
                                {badge.label}
                              </span>
                            </span>
                          ) : null}
                        </span>
                        {unread ? <span className="mail-unread-dot mail-unread-dot--row" aria-hidden /> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        <div className={`mail-reading ${selected || mobileDetail ? 'is-open' : ''} ${!mobileDetail && !selected ? 'hidden md:flex' : 'flex'} ${mobileDetail ? 'flex' : ''}`}>
          {!selected ? (
            <EmptyState title="Sélectionnez un message">
              Choisissez un courriel dans la liste pour le lire{isSent ? '.' : ' et y répondre.'}
            </EmptyState>
          ) : (
            <div className="mail-reading-stack">
              <div className="mail-reading-main">
                <header className="mail-reading-header">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <button
                      type="button"
                      className="mail-icon-btn md:hidden -ml-1 shrink-0"
                      onClick={() => { setMobileDetail(false); setSelected(null); setErpOpen(false); setSubjectExpanded(false); }}
                      aria-label="Retour"
                    >
                      <IconBack />
                    </button>
                    <span
                      className="mail-avatar text-sm shrink-0 hidden sm:flex"
                      style={{ backgroundColor: avatarColor(selected.from || selected.from_email) }}
                    >
                      {getInitials(selected.from || selected.from_email)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h2
                        className={`mail-reading-subject ${subjectExpanded ? 'is-expanded' : ''}`}
                        title={selected.subject || '(sans objet)'}
                      >
                        {selected.subject || '(sans objet)'}
                      </h2>
                      {(selected.subject || '').length > 90 && (
                        <button
                          type="button"
                          className="text-[11px] font-medium text-neya-orange hover:underline mt-0.5"
                          onClick={() => setSubjectExpanded(v => !v)}
                        >
                          {subjectExpanded ? 'Réduire' : 'Voir le sujet entier'}
                        </button>
                      )}
                      <p className="text-sm text-neya-muted mt-1 truncate">
                        <span className="font-medium text-neya-ink">{selectedSender.name}</span>
                        {selectedSender.email && (
                          <span className="text-neya-muted hidden sm:inline"> &lt;{selectedSender.email}&gt;</span>
                        )}
                        {selected.date && (
                          <span className="text-neya-muted"> · {formatMailDate(selected.date)}</span>
                        )}
                      </p>
                      {isSent && selected.to && (
                        <p className="text-xs text-neya-muted mt-0.5 truncate">À : {selected.to}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 self-start">
                      {!isSent && (
                        <button
                          type="button"
                          onClick={toggleRead}
                          className="mail-icon-btn"
                          title={(selected.isUnread || selected.unread) ? 'Marquer comme lu' : 'Marquer comme non lu'}
                          aria-label={(selected.isUnread || selected.unread) ? 'Marquer comme lu' : 'Marquer comme non lu'}
                        >
                          {(selected.isUnread || selected.unread) ? <IconMailUnread /> : <IconMailRead />}
                        </button>
                      )}
                      {!isSent && (
                        <button type="button" onClick={archive} className="mail-icon-btn" title="Archiver">
                          <IconArchive />
                        </button>
                      )}
                      {(linkProjectId || projectId) && (
                        <button
                          type="button"
                          onClick={() => linkToProject(linkProjectId || projectId)}
                          className="btn-secondary text-xs min-h-[36px] py-1 px-2.5 hidden lg:inline-flex"
                        >
                          Lier projet
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setErpOpen(v => !v)}
                        className={`mail-icon-btn 2xl:hidden ${erpOpen ? 'text-neya-orange bg-orange-50' : ''}`}
                        title="Contexte ERP"
                        aria-label="Contexte ERP"
                      >
                        <IconSparkles />
                      </button>
                    </div>
                  </div>
                </header>

                <div className={`mail-body ${selected.bodyHtml ? 'mail-body--html' : ''}`}>
                  {threadLoading && !selected.body && !selected.bodyHtml ? (
                    <p className="text-neya-muted text-sm">Chargement du contenu…</p>
                  ) : selected.bodyHtml ? (
                    <MailHtmlBody html={selected.bodyHtml} />
                  ) : (
                    <div className="mail-body-text">
                      {readableMailBody(selected.body || selected.snippet)}
                    </div>
                  )}

                  {!!selected.attachments?.length && (
                    <MailAttachments
                      messageId={selected.id}
                      attachments={selected.attachments}
                      projects={projects}
                      defaultProjectId={
                        linkProjId
                        || (thread?.project_id ? String(thread.project_id) : '')
                        || (linkProjectId || projectId ? String(linkProjectId || projectId) : '')
                      }
                      defaultProjectName={thread?.project_name || ''}
                      onFiled={(result) => {
                        const n = result.count || (result.file ? 1 : result.filed?.length) || 0;
                        const name = result.project?.name || thread?.project_name || 'projet';
                        showUndo(
                          n > 1
                            ? `${n} pièces classées dans « ${name} »`
                            : `Pièce classée dans « ${name} »`,
                          null
                        );
                        if (result.project?.id) {
                          setLinkProjId(String(result.project.id));
                        }
                      }}
                      onError={(msg) => setErr(msg)}
                    />
                  )}
                </div>

                {!isSent && (
                  <div className="mail-compose">
                    <div className="mail-compose-card">
                      <div className="mail-compose-card__head">
                        <p className="text-[12px] font-medium text-neya-muted truncate">
                          Répondre{selectedSender.name ? ` à ${selectedSender.name}` : ''}
                        </p>
                        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
                          {prevReply != null && (
                            <button
                              type="button"
                              className="text-[11px] font-medium text-neya-muted hover:text-neya-ink"
                              onClick={() => { setReply(prevReply); setPrevReply(null); showUndo('Brouillon restauré', null); }}
                            >
                              Annuler
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!reply.trim() || draftAiLoading}
                            onClick={() => reviseDraftAi('spellcheck')}
                            className="text-[11.5px] font-medium text-neya-muted hover:text-neya-ink disabled:opacity-40"
                          >
                            Orthographe
                          </button>
                          <button
                            type="button"
                            disabled={!reply.trim() || draftAiLoading}
                            onClick={() => setShowDraftInstr(v => !v)}
                            className="inline-flex items-center gap-1 rounded-md bg-neya-orange-soft px-2 py-1 text-[11.5px] font-semibold text-neya-orange hover:bg-neya-orange-soft/70 disabled:opacity-40"
                          >
                            <IconSparkles /> Rédiger avec l&apos;IA
                          </button>
                        </div>
                      </div>

                      {showDraftInstr && (
                        <div className="flex flex-col sm:flex-row gap-2 px-4 py-2 border-b border-neya-border">
                          <input
                            className="input text-sm flex-1 min-h-[36px]"
                            placeholder="Ex. plus court, plus formel, ajoute un délai…"
                            value={draftInstr}
                            onChange={e => setDraftInstr(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && reviseDraftAi('revise')}
                          />
                          <button
                            type="button"
                            disabled={draftAiLoading}
                            onClick={() => reviseDraftAi('revise')}
                            className="btn-secondary text-xs min-h-[36px] shrink-0"
                          >
                            {draftAiLoading ? 'IA…' : 'Modifier'}
                          </button>
                        </div>
                      )}

                      <textarea
                        placeholder="Bonjour,&#10;Merci pour votre message…"
                        value={reply}
                        onChange={e => { setReply(e.target.value); setPrevReply(null); }}
                      />
                      <div className="mail-compose-card__foot">
                        {draftAiLoading && <span className="mr-auto text-xs text-neya-muted">L’IA travaille…</span>}
                        <button
                          type="button"
                          onClick={sendReply}
                          disabled={!reply.trim()}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neya-orange px-4 text-[12.5px] font-semibold text-white shadow-sm hover:bg-neya-orange/90 disabled:opacity-40"
                        >
                          <IconSent /> Envoyer
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {erpOpen && (
                <button
                  type="button"
                  className="mail-erp-backdrop"
                  aria-label="Fermer le contexte"
                  onClick={() => setErpOpen(false)}
                />
              )}
              <aside className={`mail-erp-panel ${erpOpen ? 'mail-erp-panel--open' : ''}`}>
                <div className="mail-erp-sheet__handle 2xl:hidden" />
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-neya-border px-5 py-4 shrink-0">
                  <div className="min-w-0">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-neya-muted">
                      Contexte ERP
                    </p>
                    <h3 className="truncate font-display text-[15px] font-semibold text-neya-ink">
                      {thread?.client_name || selectedSender.name || 'Message'}
                    </h3>
                  </div>
                  <button type="button" className="mail-icon-btn 2xl:hidden" onClick={() => setErpOpen(false)} aria-label="Fermer">
                    ✕
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {threadLoading && !thread ? (
                    <p className="text-xs text-neya-muted">Synchronisation du fil…</p>
                  ) : thread ? (
                    <>
                      <div className="space-y-2">
                        <label className="label mb-0">Client</label>
                        <select className="input text-sm min-h-[40px]" value={linkClientId} onChange={e => {
                          setLinkClientId(e.target.value);
                          if (e.target.value && linkProjId) {
                            const stillOk = projects.some(p => String(p.id) === String(linkProjId) && (!p.client_id || String(p.client_id) === e.target.value));
                            if (!stillOk) setLinkProjId('');
                          }
                        }}>
                          <option value="">— Non lié —</option>
                          {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ''}</option>)}
                        </select>
                        {thread.client_name && (
                          <p className="text-[11px] text-neya-orange font-medium">Lié : {thread.client_name}</p>
                        )}
                        {!thread.client_id && thread.suggested_client_name && (
                          <p className="text-[11px] text-neya-muted">
                            Suggestion IA : {thread.suggested_client_name}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="label mb-0">Projet</label>
                        <select className="input text-sm min-h-[40px]" value={linkProjId} onChange={e => setLinkProjId(e.target.value)}>
                          <option value="">— Non lié —</option>
                          {projectsForClient.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {thread.project_name && (
                          <p className="text-[11px] text-neya-muted">Projet : {thread.project_name}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={saveLinks} className="btn-secondary text-xs min-h-[36px] flex-1">
                          Enregistrer
                        </button>
                        <button type="button" onClick={synthesize} disabled={synthLoading} className="btn-secondary text-xs min-h-[36px] flex-1">
                          {synthLoading ? '…' : 'Synthèse'}
                        </button>
                      </div>

                      {thread.link_source && (
                        <p className="text-[11px] text-neya-muted bg-white border border-neya-border px-2.5 py-2">
                          Lien auto : <span className="font-medium">{thread.link_source}</span>
                          {thread.link_confidence ? ` (${Math.round(thread.link_confidence * 100)} %)` : ''}
                        </p>
                      )}

                      {synthesis ? (
                        <div className="bg-white border border-neya-border p-3 space-y-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-neya-muted mb-1">Résumé</p>
                            <p className="text-sm leading-relaxed">{synthesis.summary}</p>
                          </div>
                          {keyPoints.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-neya-muted mb-1.5">Points clés</p>
                              <ul className="space-y-1">
                                {keyPoints.map((kp, i) => (
                                  <li key={i} className="text-xs text-neya-ink/90 flex gap-1.5">
                                    <span className="text-neya-muted">—</span>
                                    <span>{kp.type ? `[${kp.type}] ` : ''}{kp.text}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {actionItems.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-neya-muted mb-1.5">À faire</p>
                              <ul className="space-y-1">
                                {actionItems.map((a, i) => (
                                  <li key={i} className="text-xs flex gap-1.5">
                                    <span className="text-neya-muted">□</span>
                                    <span>{a.text}{a.priority ? ` (${a.priority})` : ''}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-neya-muted text-center py-4">
                          {thread.synthesis_error
                            ? `Synthèse échouée : ${thread.synthesis_error}`
                            : 'Ouvrez un message pour générer la synthèse, ou cliquez Synthèse.'}
                        </p>
                      )}

                      {thread.messages?.length > 1 && (
                        <details className="text-xs group">
                          <summary className="cursor-pointer text-neya-muted font-medium py-1">
                            Fil ({thread.messages.length} messages)
                          </summary>
                          <ul className="mt-2 space-y-2 max-h-36 overflow-y-auto">
                            {thread.messages.map(m => (
                              <li key={m.id} className="p-2 rounded-lg bg-white border border-neya-border/80">
                                <p className="font-medium text-neya-ink truncate">{m.from_email}</p>
                                <p className="text-neya-muted line-clamp-2 mt-0.5">{decodeHtmlEntities(m.snippet)}</p>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-neya-muted text-center py-4 space-y-2">
                      <p>{threadLoading ? 'Synchronisation du fil…' : 'Fil ERP non synchronisé.'}</p>
                      {!threadLoading && selected?.threadId && (
                        <button
                          type="button"
                          onClick={() => loadThreadContext(selected)}
                          className="btn-secondary text-xs min-h-[32px]"
                        >
                          Réessayer la synchronisation
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>

      <UndoToast toast={undoToast} onUndo={runUndo} onDismiss={dismissUndo} />

      {showComposeNew && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
            aria-label="Fermer"
            onClick={() => setShowComposeNew(false)}
          />
          <form
            onSubmit={sendComposeNew}
            className="relative z-[1] w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-neya-border bg-white shadow-xl p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-[17px] font-semibold text-neya-ink">Nouveau message</h2>
              <button type="button" className="mail-icon-btn" onClick={() => setShowComposeNew(false)} aria-label="Fermer">✕</button>
            </div>
            <div>
              <label className="label">À</label>
              <input
                className="input"
                type="email"
                required
                value={composeNew.to}
                onChange={e => setComposeNew({ ...composeNew, to: e.target.value })}
                placeholder="destinataire@exemple.ca"
              />
            </div>
            <div>
              <label className="label">Objet</label>
              <input
                className="input"
                required
                value={composeNew.subject}
                onChange={e => setComposeNew({ ...composeNew, subject: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Message</label>
              <textarea
                className="input min-h-[140px]"
                required
                value={composeNew.body}
                onChange={e => setComposeNew({ ...composeNew, body: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary text-sm" onClick={() => setShowComposeNew(false)}>Annuler</button>
              <button type="submit" disabled={composeSending} className="btn-primary text-sm gap-1.5">
                <IconSent /> {composeSending ? 'Envoi…' : 'Envoyer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
