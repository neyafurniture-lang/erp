'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { threadApi } from '../lib/mail-threads';
import { connectGoogle, getGoogleStatus } from '../lib/google';

/** Dossiers Gmail natifs (style boîte Gmail). */
const SYSTEM_FOLDERS = [
  { id: 'inbox', label: 'Boîte de réception', gmailLabel: 'INBOX' },
  { id: 'sent', label: 'Envoyés', gmailLabel: 'SENT' },
];

/** Tri ERP (labels NEYA/). */
const ERP_FOLDERS = [
  { id: 'a_repondre', label: 'À répondre' },
  { id: 'clients', label: 'Clients' },
  { id: 'fournisseurs', label: 'Fournisseurs' },
  { id: 'projets', label: 'Projets liés' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'autres', label: 'Non classés' },
];

const ALL_FOLDER_LABELS = {
  inbox: 'Boîte de réception',
  sent: 'Envoyés',
  ...Object.fromEntries(ERP_FOLDERS.map(s => [s.id, s.label])),
};

const CATEGORY_BADGE = {
  a_repondre: { label: 'Répondre', className: 'bg-neya-surface text-neya-ink border border-neya-border' },
  clients: { label: 'Client', className: 'bg-neya-surface text-neya-muted border border-neya-border' },
  fournisseurs: { label: 'Fournisseur', className: 'bg-neya-surface text-neya-muted border border-neya-border' },
  projets: { label: 'Projet', className: 'bg-neya-surface text-neya-muted border border-neya-border' },
  promotions: { label: 'Promo', className: 'bg-neya-surface text-neya-muted border border-neya-border' },
  autres: { label: 'Autre', className: 'bg-neya-surface text-neya-muted border border-neya-border' },
};

const AVATAR_COLORS = [
  '#525252', '#6B7280', '#64748B', '#78716C', '#71717A', '#55606A', '#5C6B73', '#4B5563',
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
    <div className="flex flex-col items-center justify-center h-full min-h-[240px] px-6 text-center">
      <p className="text-sm font-medium text-neya-ink mb-1">{title}</p>
      <div className="text-sm text-neya-muted max-w-xs">{children}</div>
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

export default function GmailInbox({ projectId = null, linkProjectId = null }) {
  const [connected, setConnected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
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
  const [erpOpen, setErpOpen] = useState(true);
  const [threadWarn, setThreadWarn] = useState('');
  const [activeFolder, setActiveFolder] = useState('inbox');
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

  async function openMessage(m) {
    const id = m.id || m.gmail_message_id;
    if (!id) return;
    setThreadLoading(true);
    setErr('');
    setThreadWarn('');
    setMobileDetail(true);
    setErpOpen(true);
    setPrevReply(null);
    setShowDraftInstr(false);

    try {
      const full = m.body ? m : await api(`/gmail/messages/${id}`);
      setSelected(full);
    } catch (e) {
      setErr(e.message);
      setSelected(null);
      setThreadLoading(false);
      return;
    }

    // Dans Envoyés : lecture seule, pas de réponse auto
    if (activeFolder === 'sent') {
      setReply('');
      setThreadLoading(false);
      try {
        if (m.threadId) await loadThreadContext(m);
      } catch { /* ignore */ }
      return;
    }

    try {
      const processed = await threadApi('/process-message', {
        method: 'POST',
        body: JSON.stringify({ message_id: id }),
      });
      setThread(processed);
      setLinkClientId(processed.client_id ? String(processed.client_id) : '');
      setLinkProjId(processed.project_id ? String(processed.project_id) : '');
      if (processed.latest_synthesis?.suggested_reply || processed.synthesis?.suggested_reply) {
        setReply(processed.latest_synthesis?.suggested_reply || processed.synthesis.suggested_reply);
      }
      if (processed.synthesis_error) {
        setThreadWarn(`Synthèse : ${processed.synthesis_error}`);
      }
    } catch (e) {
      setThread(null);
      if (isNotFoundError(e)) {
        setThreadWarn('Lecture OK — analyse ERP indisponible (backend à redéployer).');
      } else {
        setThreadWarn(e.message);
      }
      await loadThreadContext(m);
    } finally {
      setThreadLoading(false);
    }
  }

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
      showUndo('Liens enregistrés', null);
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
    if (activeFolder === 'inbox' || activeFolder === 'sent' || search) return messages;
    return messages.filter(m => m.mailCategory === activeFolder);
  }, [messages, activeFolder, search]);

  const groupedMessages = useMemo(() => {
    if (activeFolder !== 'inbox' || search) {
      return [{ id: activeFolder, label: ALL_FOLDER_LABELS[activeFolder] || 'Messages', items: filteredMessages }];
    }
    const order = ERP_FOLDERS.map(f => f.id);
    return order
      .map(id => ({
        id,
        label: ALL_FOLDER_LABELS[id],
        items: messages.filter(m => m.mailCategory === id),
      }))
      .filter(g => g.items.length > 0);
  }, [messages, filteredMessages, activeFolder, search]);

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

  return (
    <div className="mail-shell">
      <div className="mail-toolbar">
        <div className="mail-search">
          <IconSearch />
          <input
            placeholder="Rechercher dans Gmail…"
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
        <button type="button" onClick={() => load(search, activeFolder)} className="mail-icon-btn" title="Actualiser">
          <IconRefresh spin={loading} />
        </button>
        {!isSent && (
          <button
            type="button"
            onClick={processInbox}
            disabled={inboxProcessing}
            className="btn-secondary text-xs min-h-[36px] py-1.5 px-3 hidden sm:inline-flex"
          >
            {inboxProcessing ? 'Tri…' : 'Trier la boîte'}
          </button>
        )}
      </div>

      {err && (
        <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100 flex items-center justify-between gap-2">
          <span>{err}</span>
          <button type="button" className="text-xs font-medium underline shrink-0" onClick={() => setErr('')}>Fermer</button>
        </div>
      )}

      {threadWarn && (
        <div className="px-4 py-2 text-sm text-amber-800 bg-amber-50 border-b border-amber-100">
          {threadWarn}
        </div>
      )}

      <div className="mail-layout min-h-[480px]">
        <aside className="mail-sidebar">
          <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest text-neya-muted">Gmail</p>
          {SYSTEM_FOLDERS.map(folder => {
            const count = folder.id === 'inbox'
              ? (sectionCounts.inbox ?? (activeFolder === 'inbox' ? messages.length : null))
              : (activeFolder === 'sent' ? messages.length : null);
            const active = activeFolder === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => selectFolder(folder.id)}
                className={`mail-folder ${active ? 'mail-folder-active' : ''}`}
              >
                {folder.id === 'sent' ? <IconSent /> : <IconInbox />}
                <span className="flex-1 text-left truncate">{folder.label}</span>
                {count > 0 && (
                  <span className="text-[10px] font-medium tabular-nums text-neya-muted">{count}</span>
                )}
              </button>
            );
          })}

          <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-neya-muted">Tri NEYA</p>
          {ERP_FOLDERS.map(folder => {
            const count = sectionCounts[folder.id] ?? 0;
            const active = activeFolder === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => selectFolder(folder.id)}
                className={`mail-folder ${active ? 'mail-folder-active' : ''}`}
              >
                <IconFolder className="w-4 h-4 opacity-70" />
                <span className="flex-1 text-left truncate">{folder.label}</span>
                {count > 0 && (
                  <span className={`text-[10px] font-medium tabular-nums ${folder.id === 'a_repondre' ? 'text-amber-700' : 'text-neya-muted'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {projectId && (
            <button type="button" className="mail-folder">
              <IconFolder className="w-4 h-4" />
              <span>Projet lié</span>
            </button>
          )}
        </aside>

        <div className={`mail-list ${mobileDetail ? 'hidden md:flex' : 'flex'}`}>
          <div className="px-3 py-1.5 border-b border-neya-border flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-neya-muted truncate">
              {loading ? 'Chargement…' : `${filteredMessages.length} message${filteredMessages.length !== 1 ? 's' : ''}`}
              {activeFolder !== 'inbox' && !search && (
                <span className="text-neya-ink"> · {ALL_FOLDER_LABELS[activeFolder]}</span>
              )}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <select
                className="md:hidden text-xs border border-neya-border rounded px-2 py-1 bg-white"
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
                  className="text-xs text-neya-muted font-medium sm:hidden"
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
                  {activeFolder === 'inbox' && !search && group.items.length > 0 && (
                    <div className="mail-section-header">
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
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => openMessage(m)}
                        className={`mail-row ${active ? 'mail-row-active' : ''} ${unread && !active ? 'border-l-2 border-l-neya-ink pl-[10px]' : ''} ${unread ? 'mail-row-unread' : ''}`}
                      >
                        <span className="mail-avatar" style={{ backgroundColor: avatarColor(peer) }}>
                          {getInitials(peer)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={`text-[13px] truncate ${unread ? 'font-semibold' : 'font-medium text-neya-ink/90'}`}>
                              {isSent ? `À : ${name}` : name}
                            </span>
                            <span className="text-[10px] text-neya-muted shrink-0 tabular-nums">
                              {formatMailDate(m.date)}
                            </span>
                          </span>
                          <span className="mail-row-subject block text-[13px] truncate text-neya-ink/80">
                            {m.subject || '(sans objet)'}
                          </span>
                          {badge && activeFolder === 'inbox' && (
                            <span className={`inline-block mt-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded ${badge.className}`}>
                              {badge.label}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        <div className={`mail-reading ${!mobileDetail && !selected ? 'hidden md:flex' : 'flex'} ${mobileDetail ? 'flex' : ''}`}>
          {!selected ? (
            <EmptyState title="Sélectionnez un message">
              Choisissez un courriel dans la liste pour le lire{isSent ? '.' : ' et y répondre.'}
            </EmptyState>
          ) : (
            <div className="flex flex-1 min-h-0">
              <div className="flex-1 flex flex-col min-w-0">
                <header className="mail-reading-header">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      className="mail-icon-btn md:hidden -ml-1 shrink-0"
                      onClick={() => { setMobileDetail(false); setSelected(null); }}
                      aria-label="Retour"
                    >
                      <IconBack />
                    </button>
                    <span
                      className="mail-avatar w-10 h-10 text-sm shrink-0 hidden sm:flex"
                      style={{ backgroundColor: avatarColor(selected.from || selected.from_email) }}
                    >
                      {getInitials(selected.from || selected.from_email)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold text-neya-ink leading-snug pr-2">
                        {selected.subject}
                      </h2>
                      <p className="text-sm text-neya-muted mt-1">
                        <span className="font-medium text-neya-ink">{selectedSender.name}</span>
                        {selectedSender.email && (
                          <span className="text-neya-muted"> &lt;{selectedSender.email}&gt;</span>
                        )}
                      </p>
                      {isSent && selected.to && (
                        <p className="text-xs text-neya-muted mt-0.5">À : {selected.to}</p>
                      )}
                      {selected.date && (
                        <p className="text-xs text-neya-muted mt-0.5">{selected.date}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
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
                        className="mail-icon-btn lg:hidden"
                        title="Panneau ERP"
                      >
                        <IconSparkles />
                      </button>
                    </div>
                  </div>
                </header>

                <div className="mail-body">
                  {threadLoading && !selected.body ? (
                    <p className="text-neya-muted text-sm">Chargement du contenu…</p>
                  ) : (
                    selected.body || selected.snippet
                  )}
                </div>

                {!isSent && (
                  <div className="mail-compose">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <label className="text-xs font-medium text-neya-muted">Répondre</label>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {prevReply != null && (
                          <button
                            type="button"
                            className="text-[11px] font-medium text-neya-muted hover:text-neya-ink"
                            onClick={() => { setReply(prevReply); setPrevReply(null); showUndo('Brouillon restauré', null); }}
                          >
                            Annuler la modif
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!reply.trim() || draftAiLoading}
                          onClick={() => reviseDraftAi('spellcheck')}
                          className="text-[11px] font-medium text-neya-muted hover:text-neya-ink disabled:opacity-40"
                          title="Corriger l’orthographe"
                        >
                          Orthographe
                        </button>
                        <button
                          type="button"
                          disabled={!reply.trim() || draftAiLoading}
                          onClick={() => setShowDraftInstr(v => !v)}
                          className="text-[11px] font-medium text-neya-ink hover:underline disabled:opacity-40"
                        >
                          Demander à l’IA…
                        </button>
                      </div>
                    </div>

                    {showDraftInstr && (
                      <div className="mb-2 flex flex-col sm:flex-row gap-2">
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
                          {draftAiLoading ? 'IA…' : 'Modifier le brouillon'}
                        </button>
                      </div>
                    )}

                    <textarea
                      className="input mb-3 min-h-[88px] text-sm resize-y"
                      placeholder="Rédigez votre réponse…"
                      value={reply}
                      onChange={e => { setReply(e.target.value); setPrevReply(null); }}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={sendReply}
                        disabled={!reply.trim()}
                        className="btn-primary text-sm min-h-[40px]"
                      >
                        Envoyer
                      </button>
                      {draftAiLoading && <span className="text-xs text-neya-muted">L’IA travaille…</span>}
                      {!draftAiLoading && synthesis?.needs_response && (
                        <span className="text-xs text-neya-muted">Brouillon suggéré</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <aside className={`mail-erp-panel ${erpOpen ? 'flex' : 'hidden lg:flex'}`}>
                <div className="px-4 py-3 border-b border-neya-border flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-neya-ink">Contexte ERP</p>
                    <p className="text-[11px] text-neya-muted">Liens, synthèse et actions</p>
                  </div>
                  <button type="button" className="mail-icon-btn lg:hidden" onClick={() => setErpOpen(false)} aria-label="Fermer">
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
                                <p className="text-neya-muted line-clamp-2 mt-0.5">{m.snippet}</p>
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
    </div>
  );
}
