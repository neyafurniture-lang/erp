'use client';

/**
 * Enregistreur de réunion hors React — survit aux changements de page.
 * Speak-to-text navigateur (Web Speech API), transcript écrit au fil de l'eau
 * dans localStorage pour ne rien perdre si ça plante.
 */

const DRAFT_KEY = 'neya_meeting_draft';
const HISTORY_KEY = 'neya_meetings';
const MAX_HISTORY = 40;

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft) {
  if (typeof window === 'undefined') return;
  try {
    if (!draft) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}

function loadHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

/** @typedef {{ id: string, title: string, transcript: string, interim: string, startedAt: string, updatedAt: string, listening: boolean, error: string|null }} MeetingDraft */

/** @type {MeetingDraft} */
let state = {
  id: '',
  title: '',
  transcript: '',
  interim: '',
  startedAt: '',
  updatedAt: '',
  listening: false,
  error: null,
};

let recognition = null;
let wantListen = false;
/** @type {string[]} */
let finals = [];
let interimText = '';
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

function snapshot() {
  return state;
}

function syncState(patch = {}) {
  state = {
    ...state,
    ...patch,
    transcript: finals.join(' ').replace(/\s+/g, ' ').trim(),
    interim: interimText,
    updatedAt: new Date().toISOString(),
  };
  if (state.id) {
    saveDraft({
      id: state.id,
      title: state.title,
      transcript: state.transcript,
      interim: state.interim,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      listening: false, // jamais relancer auto après reload
    });
  }
  emit();
}

function startRecognitionInstance(lang = 'fr-CA') {
  const SpeechRecognition = getSpeechRecognition();
  if (!SpeechRecognition || !wantListen) return;

  const rec = new SpeechRecognition();
  rec.lang = lang;
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  rec.continuous = !isIOS;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    if (wantListen) syncState({ listening: true, error: null });
  };

  rec.onresult = (event) => {
    let nextInterim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = (event.results[i][0].transcript || '').trim();
      if (!piece) continue;
      if (event.results[i].isFinal) {
        finals.push(piece);
        nextInterim = '';
        interimText = '';
      } else {
        nextInterim += (nextInterim ? ' ' : '') + piece;
      }
    }
    if (nextInterim) interimText = nextInterim;
    syncState({ listening: true });
  };

  rec.onerror = (event) => {
    if (event.error === 'aborted') return;
    if (event.error === 'no-speech' && wantListen) return;
    const messages = {
      'not-allowed': 'Accès au micro refusé. Autorisez le micro dans le navigateur.',
      'no-speech': 'Aucune voix détectée.',
      network: 'Erreur réseau (reconnaissance vocale). Réessayez.',
    };
    if (event.error !== 'no-speech') {
      wantListen = false;
      syncState({
        listening: false,
        error: messages[event.error] || `Erreur micro : ${event.error}`,
      });
    }
  };

  rec.onend = () => {
    recognition = null;
    if (wantListen) {
      setTimeout(() => {
        if (!wantListen) return;
        try {
          startRecognitionInstance(lang);
        } catch {
          wantListen = false;
          syncState({ listening: false, error: 'La reconnaissance s’est arrêtée.' });
        }
      }, 120);
    } else {
      syncState({ listening: false });
    }
  };

  recognition = rec;
  try {
    rec.start();
  } catch (err) {
    console.warn('Meeting speech start:', err);
    syncState({ listening: false });
  }
}

export function isMeetingSpeechSupported() {
  return !!getSpeechRecognition();
}

export function getMeetingState() {
  return snapshot();
}

export function subscribeMeeting(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hydrateMeetingFromStorage() {
  const draft = loadDraft();
  if (!draft?.id) return;
  finals = draft.transcript ? [draft.transcript] : [];
  interimText = draft.interim || '';
  state = {
    id: draft.id,
    title: draft.title || '',
    transcript: draft.transcript || '',
    interim: interimText,
    startedAt: draft.startedAt || '',
    updatedAt: draft.updatedAt || '',
    listening: false,
    error: null,
  };
  emit();
}

/**
 * Démarre (ou reprend) l’écoute. Si clear=true, nouvelle session.
 */
export function startMeetingRecording({ title = '', clear = true, lang = 'fr-CA' } = {}) {
  const SpeechRecognition = getSpeechRecognition();
  if (!SpeechRecognition) {
    syncState({ error: 'Reconnaissance vocale non supportée (Chrome / Edge recommandé).' });
    return false;
  }

  if (clear || !state.id) {
    finals = [];
    interimText = '';
    const now = new Date().toISOString();
    state = {
      id: uid(),
      title: (title || state.title || '').trim() || defaultTitle(),
      transcript: '',
      interim: '',
      startedAt: now,
      updatedAt: now,
      listening: false,
      error: null,
    };
  } else {
    state = { ...state, error: null, title: (title || state.title || '').trim() || state.title };
  }

  wantListen = true;
  syncState({});
  startRecognitionInstance(lang);
  return true;
}

export function stopMeetingRecording() {
  wantListen = false;
  try {
    recognition?.stop();
  } catch {
    /* ignore */
  }
  recognition = null;

  const full = [finals.join(' '), interimText].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (interimText.trim()) {
    finals = full ? [full] : [];
    interimText = '';
  }
  syncState({ listening: false });
  return getFullMeetingText();
}

export function getFullMeetingText() {
  const finalsText = finals.join(' ').replace(/\s+/g, ' ').trim();
  const inter = (interimText || '').trim();
  if (finalsText && inter) return `${finalsText} ${inter}`.replace(/\s+/g, ' ').trim();
  return (finalsText || inter).replace(/\s+/g, ' ').trim();
}

export function setMeetingTranscript(text) {
  if (!state.id) {
    const now = new Date().toISOString();
    state = {
      ...state,
      id: uid(),
      title: state.title || defaultTitle(),
      startedAt: state.startedAt || now,
    };
  }
  finals = text ? [String(text)] : [];
  interimText = '';
  syncState({});
}

export function setMeetingTitle(title) {
  if (!state.id && String(title || '').trim()) {
    const now = new Date().toISOString();
    state = {
      ...state,
      id: uid(),
      startedAt: state.startedAt || now,
    };
  }
  syncState({ title: String(title || '') });
}

export function clearMeetingDraft() {
  wantListen = false;
  try {
    recognition?.abort();
  } catch {
    /* ignore */
  }
  recognition = null;
  finals = [];
  interimText = '';
  state = {
    id: '',
    title: '',
    transcript: '',
    interim: '',
    startedAt: '',
    updatedAt: '',
    listening: false,
    error: null,
  };
  saveDraft(null);
  emit();
}

export function saveMeetingToHistory() {
  const text = getFullMeetingText();
  if (!text && !state.id) return null;
  const entry = {
    id: state.id || uid(),
    title: state.title || defaultTitle(),
    transcript: text,
    startedAt: state.startedAt || new Date().toISOString(),
    savedAt: new Date().toISOString(),
  };
  const list = loadHistory().filter((m) => m.id !== entry.id);
  list.unshift(entry);
  saveHistory(list);
  return entry;
}

export function listSavedMeetings() {
  return loadHistory();
}

export function getSavedMeeting(id) {
  return loadHistory().find((m) => m.id === id) || null;
}

export function deleteSavedMeeting(id) {
  saveHistory(loadHistory().filter((m) => m.id !== id));
}

export function clearMeetingError() {
  syncState({ error: null });
}

function defaultTitle() {
  const d = new Date();
  const date = d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  return `Réunion ${date} · ${time}`;
}
