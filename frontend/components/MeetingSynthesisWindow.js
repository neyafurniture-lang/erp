'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Mic,
  Square,
  Minimize2,
  X,
  Copy,
  Check,
  Save,
  Play,
  RotateCcw,
  FileText,
  Download,
} from 'lucide-react';
import {
  clearMeetingDraft,
  clearMeetingError,
  downloadMeetingAudio,
  getFullMeetingText,
  getMeetingState,
  getSavedMeeting,
  hydrateMeetingFromStorage,
  isMeetingSpeechSupported,
  isSafariMeetingBrowser,
  saveMeetingToHistory,
  setMeetingTitle,
  setMeetingTranscript,
  startMeetingRecording,
  stopMeetingRecording,
  subscribeMeeting,
} from '../lib/meeting-recorder';
import {
  closeMeetingWindow,
  expandMeetingWindow,
  minimizeMeetingWindow,
  openMeetingWindow,
  useMeetingWindowUi,
} from '../lib/meeting-window';
import { useAuth } from '../lib/auth-context';
import { canAccessPath } from '../lib/permissions';

function useMeetingRecorderState() {
  return useSyncExternalStore(subscribeMeeting, getMeetingState, getMeetingState);
}

function formatDuration(startedAt, listening) {
  if (!startedAt) return '00:00';
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return '00:00';
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return listening || sec > 0 ? `${m}:${s}` : '00:00';
}

export default function MeetingSynthesisWindow() {
  const { user } = useAuth();
  const ui = useMeetingWindowUi();
  const session = useMeetingRecorderState();
  const [copied, setCopied] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [tick, setTick] = useState(0);
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  const hydrated = useRef(false);

  const allowed = canAccessPath(user, '/reunions');
  const viewing = ui.viewingId ? getSavedMeeting(ui.viewingId) : null;
  const readOnly = Boolean(viewing);
  const supported = typeof window !== 'undefined' && isMeetingSpeechSupported();
  const safari = typeof window !== 'undefined' && isSafariMeetingBrowser();

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    hydrateMeetingFromStorage();
  }, []);

  useEffect(() => {
    if (!session.listening) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [session.listening]);

  useEffect(() => {
    if (ui.open && !readOnly) setEditTitle(session.title || '');
  }, [ui.open, session.title, readOnly, session.id]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session.transcript, session.interim, viewing?.transcript]);

  if (!user || !allowed) return null;

  const liveText = readOnly
    ? viewing?.transcript || ''
    : [session.transcript, session.interim].filter(Boolean).join(' ').trim();

  const duration = formatDuration(session.startedAt, session.listening);
  void tick;

  const onLaunch = async () => {
    setBusy(true);
    try {
      await startMeetingRecording({
        title: editTitle.trim(),
        clear: !session.id || !session.transcript,
      });
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    setBusy(true);
    try {
      await stopMeetingRecording();
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    setBusy(true);
    try {
      await startMeetingRecording({ title: editTitle.trim(), clear: false });
    } finally {
      setBusy(false);
    }
  };

  const onSave = () => {
    if (readOnly) return;
    if (editTitle.trim()) setMeetingTitle(editTitle.trim());
    const entry = saveMeetingToHistory();
    if (entry) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    }
  };

  const onCopy = async () => {
    const text = readOnly ? (viewing?.transcript || '') : getFullMeetingText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const onNew = async () => {
    if (session.listening) await stopMeetingRecording();
    if (session.transcript && !window.confirm('Effacer la transcription en cours ?')) return;
    await clearMeetingDraft();
    setEditTitle('');
  };

  const onClose = async () => {
    if (session.listening) {
      if (!window.confirm('L’enregistrement continue en arrière-plan si vous réduisez. Fermer quand même (arrêt) ?')) {
        minimizeMeetingWindow();
        return;
      }
      await stopMeetingRecording();
    }
    closeMeetingWindow();
  };

  /* Pastille flottante quand réduit + enregistrement (ou fenêtre ouverte réduite) */
  if (ui.minimized || (!ui.open && session.listening)) {
    return (
      <button
        type="button"
        onClick={expandMeetingWindow}
        className="fixed z-[68] right-3 bottom-[calc(var(--dock-clearance)+5.5rem)] lg:right-8 lg:bottom-36 flex items-center gap-2 rounded-full border border-neya-border bg-white px-3.5 py-2.5 shadow-lg shadow-black/10"
        aria-label="Ouvrir synthèse réunion"
      >
        <span
          className={`grid h-8 w-8 place-items-center rounded-full ${
            session.listening ? 'bg-red-500 text-white animate-pulse' : 'bg-neya-orange text-white'
          }`}
        >
          <Mic className="h-4 w-4" />
        </span>
        <span className="text-left pr-1">
          <span className="block text-[12px] font-display font-semibold text-neya-ink">
            {session.listening ? 'Enregistrement…' : 'Réunion'}
          </span>
          <span className="block text-[11px] text-neya-muted tabular-nums">
            {session.listening ? duration : 'Toucher pour ouvrir'}
          </span>
        </span>
      </button>
    );
  }

  if (!ui.open) return null;

  return (
    <div
      className="fixed z-[68] inset-x-3 bottom-[calc(var(--dock-clearance)+1rem)] top-auto max-h-[min(72vh,640px)] lg:inset-x-auto lg:right-8 lg:bottom-28 lg:top-24 lg:w-[min(420px,calc(100vw-var(--sidebar-w)-3rem))] flex flex-col rounded-2xl border border-neya-border bg-white shadow-2xl shadow-black/15 overflow-hidden"
      role="dialog"
      aria-label="Synthèse de réunion"
    >
      <header className="shrink-0 flex items-center gap-2 border-b border-neya-border bg-[linear-gradient(180deg,#fff_0%,#faf9f7_100%)] px-3.5 py-2.5">
        <div
          className={`grid h-9 w-9 place-items-center rounded-xl ${
            session.listening && !readOnly ? 'bg-red-500 text-white' : 'bg-neya-orange/12 text-neya-orange'
          }`}
        >
          <Mic className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[14px] font-semibold text-neya-ink">
            {readOnly ? 'Réunion enregistrée' : 'Synthèse réunion'}
          </p>
          <p className="truncate text-[11px] text-neya-muted">
            {readOnly
              ? viewing?.title || 'Lecture'
              : session.listening
                ? `Live · ${duration}${safari ? ' · mode Safari' : ''} · sauvé au fil de l’eau`
                : supported
                  ? safari
                    ? 'Safari · dictée Apple + secours audio'
                    : 'Speak-to-text navigateur · sans IA'
                  : 'Navigateur non supporté'}
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg text-neya-muted hover:bg-neya-surface"
            onClick={minimizeMeetingWindow}
            aria-label="Réduire"
            title="Réduire (l’enregistrement continue)"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-lg text-neya-muted hover:bg-neya-surface"
          onClick={onClose}
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="shrink-0 px-3.5 pt-3 space-y-2">
        {readOnly ? (
          <p className="text-[13px] font-medium text-neya-ink">{viewing?.title}</p>
        ) : (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => {
              setEditTitle(e.target.value);
              setMeetingTitle(e.target.value);
            }}
            placeholder="Titre de la réunion"
            className="w-full h-9 rounded-lg border border-neya-border bg-neya-surface/60 px-3 text-[13px] outline-none focus:border-neya-orange/40 focus:bg-white focus:ring-2 focus:ring-neya-orange/15"
          />
        )}

        {session.error && !readOnly && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            <span>{session.error}</span>
            <button type="button" className="underline shrink-0" onClick={clearMeetingError}>
              OK
            </button>
          </div>
        )}

        {safari && !readOnly && !session.listening && (
          <p className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900/90 leading-snug">
            Safari : autorisez le micro, parlez clairement. Si la dictée saute, le texte déjà écrit
            reste + piste audio téléchargeable en secours. Désactivez « Écouter Siri » si rien
            n’apparaît.
          </p>
        )}

        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {!session.listening ? (
              <>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1.5 text-[13px] disabled:opacity-50"
                  onClick={session.transcript ? onResume : onLaunch}
                  disabled={!supported || busy}
                >
                  <Play className="h-3.5 w-3.5" />
                  {busy ? '…' : session.transcript ? 'Reprendre' : 'Lancer'}
                </button>
                {session.transcript ? (
                  <button
                    type="button"
                    className="btn-ghost inline-flex items-center gap-1.5 text-[13px]"
                    onClick={onNew}
                    disabled={busy}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Nouvelle
                  </button>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
                onClick={onStop}
                disabled={busy}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Arrêter
              </button>
            )}
            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-1.5 text-[13px]"
              onClick={onCopy}
              disabled={!liveText}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
            {!readOnly && (
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1.5 text-[13px]"
                onClick={onSave}
                disabled={!liveText}
              >
                <Save className="h-3.5 w-3.5" />
                {savedFlash ? 'Sauvé' : 'Sauver'}
              </button>
            )}
            {!readOnly && session.hasAudio && (
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1.5 text-[13px]"
                onClick={() => downloadMeetingAudio()}
                title="Télécharger l’audio de secours"
              >
                <Download className="h-3.5 w-3.5" />
                Audio
              </button>
            )}
          </div>
        )}

        {readOnly && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-[13px]" onClick={onCopy}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-1.5 text-[13px]"
              onClick={async () => {
                await clearMeetingDraft();
                setMeetingTranscript(viewing?.transcript || '');
                setMeetingTitle(viewing?.title || '');
                setEditTitle(viewing?.title || '');
                openMeetingWindow({ viewingId: null });
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Continuer ici
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-[160px] overflow-y-auto px-3.5 py-3 text-[13.5px] leading-relaxed text-neya-ink"
      >
        {liveText ? (
          <p className="whitespace-pre-wrap">
            {readOnly ? (
              liveText
            ) : (
              <>
                {session.transcript}
                {session.interim ? (
                  <span className="text-neya-muted">
                    {session.transcript ? ' ' : ''}
                    {session.interim}
                  </span>
                ) : null}
              </>
            )}
          </p>
        ) : (
          <p className="text-neya-muted text-[13px]">
            {readOnly
              ? 'Aucune transcription.'
              : safari
                ? 'Appuyez sur Lancer (autorisez le micro), puis parlez. Sur Safari le texte peut arriver par à-coups — il est quand même écrit au fur et à mesure, et une piste audio de secours est enregistrée.'
                : 'Appuyez sur Lancer, puis parlez. Le texte s’écrit au fur et à mesure — vous pouvez changer de page dans l’ERP sans couper l’enregistrement.'}
          </p>
        )}
      </div>

      <footer className="shrink-0 border-t border-neya-border px-3.5 py-2 text-[11px] text-neya-muted">
        {session.listening
          ? safari
            ? 'Safari · sessions dictée enchaînées · naviguez librement dans l’ERP.'
            : 'Fenêtre indépendante · l’écoute continue si vous naviguez ou réduisez.'
          : session.hasAudio
            ? 'Brouillon local + audio de secours prêt à télécharger.'
            : 'Brouillon conservé localement sur cet appareil.'}
      </footer>
    </div>
  );
}
