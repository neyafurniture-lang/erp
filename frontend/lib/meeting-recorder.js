'use client';

/**
 * Enregistreur de réunion hors React — survit aux changements de page.
 * Speak-to-text navigateur (Web Speech API), optimisé Safari/iOS :
 * - préchauffage micro (getUserMedia)
 * - sessions courtes enchaînées (continuous=false)
 * - interim promu en final à chaque fin de session
 * - piste audio MediaRecorder en secours (téléchargeable)
 */

const DRAFT_KEY = 'neya_meeting_draft';
const HISTORY_KEY = 'neya_meetings';
const MAX_HISTORY = 40;

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isAppleSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafariDesktop = /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/i.test(ua);
  return isIOS || isSafariDesktop;
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

/** @typedef {{ id: string, title: string, transcript: string, interim: string, startedAt: string, updatedAt: string, listening: boolean, error: string|null, safari: boolean, hasAudio: boolean }} MeetingDraft */

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
  safari: typeof navigator !== 'undefined' ? isAppleSafari() : false,
  hasAudio: false,
};

let recognition = null;
let wantListen = false;
let activeLang = 'fr-CA';
/** @type {string[]} */
let finals = [];
let interimText = '';
const listeners = new Set();

/** @type {MediaStream|null} */
let micStream = null;
/** @type {MediaRecorder|null} */
let mediaRecorder = null;
/** @type {Blob[]} */
let audioChunks = [];
/** @type {Blob|null} */
let audioBlob = null;
let restartTimer = null;
let watchdogTimer = null;
let lastResultAt = 0;

function emit() {
  listeners.forEach((fn) => fn());
}

function snapshot() {
  return state;
}

function commitInterim() {
  const inter = (interimText || '').trim();
  if (!inter) return;
  finals.push(inter);
  interimText = '';
}

function syncState(patch = {}) {
  state = {
    ...state,
    ...patch,
    transcript: finals.join(' ').replace(/\s+/g, ' ').trim(),
    interim: interimText,
    updatedAt: new Date().toISOString(),
    safari: isAppleSafari(),
    hasAudio: Boolean(audioBlob) || audioChunks.length > 0,
  };
  if (state.id) {
    saveDraft({
      id: state.id,
      title: state.title,
      transcript: state.transcript,
      interim: state.interim,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      listening: false,
    });
  }
  emit();
}

function clearTimers() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/mp4',
    'audio/aac',
    'audio/webm;codecs=opus',
    'audio/webm',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

async function ensureMicStream() {
  if (micStream?.active) return micStream;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Micro indisponible sur cet appareil.');
  }
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  return micStream;
}

function startAudioBackup() {
  audioChunks = [];
  audioBlob = null;
  if (typeof MediaRecorder === 'undefined' || !micStream) return;
  try {
    const mime = pickRecorderMime();
    mediaRecorder = mime
      ? new MediaRecorder(micStream, { mimeType: mime })
      : new MediaRecorder(micStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
        // Garder un blob cumulatif pour téléchargement mid-session
        audioBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
        syncState({ hasAudio: true });
      }
    };
    // chunks fréquents = moins de perte si crash
    mediaRecorder.start(4000);
  } catch (err) {
    console.warn('Audio backup:', err);
    mediaRecorder = null;
  }
}

function stopAudioBackup() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      if (audioChunks.length) {
        audioBlob = new Blob(audioChunks, { type: audioBlob?.type || 'audio/webm' });
      }
      resolve(audioBlob);
      return;
    }
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || audioBlob?.type || 'audio/webm' });
      mediaRecorder = null;
      syncState({ hasAudio: Boolean(audioBlob?.size) });
      resolve(audioBlob);
    };
    try {
      mediaRecorder.stop();
    } catch {
      mediaRecorder = null;
      resolve(audioBlob);
    }
  });
}

function releaseMic() {
  try {
    micStream?.getTracks()?.forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  micStream = null;
}

function scheduleRestart() {
  if (!wantListen) return;
  if (restartTimer) clearTimeout(restartTimer);
  // Safari : petit délai ; trop court = InvalidStateError
  const delay = isAppleSafari() ? 280 : 120;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (!wantListen) return;
    try {
      startRecognitionInstance();
    } catch {
      // retry once
      restartTimer = setTimeout(() => {
        if (!wantListen) return;
        try {
          startRecognitionInstance();
        } catch {
          wantListen = false;
          syncState({ listening: false, error: 'Safari a coupé la reconnaissance. Reprenez.' });
        }
      }, 500);
    }
  }, delay);
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  lastResultAt = Date.now();
  // Safari peut rester « listening » sans onend : forcer un cycle
  watchdogTimer = setInterval(() => {
    if (!wantListen) return;
    const idle = Date.now() - lastResultAt;
    if (isAppleSafari() && idle > 12000 && recognition) {
      commitInterim();
      syncState({ listening: true });
      try {
        recognition.stop();
      } catch {
        scheduleRestart();
      }
    }
  }, 4000);
}

function startRecognitionInstance() {
  const SpeechRecognition = getSpeechRecognition();
  if (!SpeechRecognition || !wantListen) return;

  // Une seule instance à la fois
  if (recognition) {
    try {
      recognition.onend = null;
      recognition.abort();
    } catch {
      /* ignore */
    }
    recognition = null;
  }

  const rec = new SpeechRecognition();
  rec.lang = activeLang;
  const safari = isAppleSafari();
  // Safari : continuous=true est instable → sessions courtes + relance
  rec.continuous = !safari;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    if (wantListen) syncState({ listening: true, error: null });
  };

  rec.onresult = (event) => {
    lastResultAt = Date.now();
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
    // no-speech / audio-capture soft : relancer sur Safari
    if ((event.error === 'no-speech' || event.error === 'audio-capture') && wantListen) {
      if (safari) {
        commitInterim();
        syncState({});
      }
      return;
    }
    const messages = {
      'not-allowed': 'Accès au micro refusé. Réglages Safari → Site → Microphone.',
      'no-speech': 'Aucune voix détectée.',
      network: 'Erreur réseau (dictée Safari). Vérifiez la connexion / Siri.',
      'service-not-allowed': 'Dictée Safari bloquée. Activez Dictée dans Réglages système.',
    };
    if (event.error === 'network' && safari && wantListen) {
      // Souvent transitoire sur Safari — relancer plutôt que tuer
      commitInterim();
      syncState({ error: 'Dictée Safari instable — relance auto…' });
      return;
    }
    wantListen = false;
    clearTimers();
    syncState({
      listening: false,
      error: messages[event.error] || `Erreur micro : ${event.error}`,
    });
  };

  rec.onend = () => {
    recognition = null;
    // Safari finalise rarement : garder l’interim dans le texte
    commitInterim();
    syncState({ listening: wantListen });
    if (wantListen) scheduleRestart();
    else syncState({ listening: false });
  };

  recognition = rec;
  try {
    rec.start();
  } catch (err) {
    console.warn('Meeting speech start:', err);
    recognition = null;
    if (wantListen) scheduleRestart();
    else syncState({ listening: false });
  }
}

export function isMeetingSpeechSupported() {
  return !!getSpeechRecognition();
}

export function isSafariMeetingBrowser() {
  return isAppleSafari();
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
    safari: isAppleSafari(),
    hasAudio: false,
  };
  emit();
}

/**
 * Démarre (ou reprend) l’écoute. Si clear=true, nouvelle session.
 * Async : préchauffe le micro (obligatoire Safari).
 */
export async function startMeetingRecording({ title = '', clear = true, lang = 'fr-CA' } = {}) {
  const SpeechRecognition = getSpeechRecognition();
  if (!SpeechRecognition) {
    syncState({
      error: 'Reconnaissance vocale absente. Sur iPhone : Safari récent + Dictée activée.',
    });
    return false;
  }

  activeLang = lang || 'fr-CA';

  if (clear || !state.id) {
    finals = [];
    interimText = '';
    audioChunks = [];
    audioBlob = null;
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
      safari: isAppleSafari(),
      hasAudio: false,
    };
  } else {
    state = {
      ...state,
      error: null,
      title: (title || state.title || '').trim() || state.title,
      safari: isAppleSafari(),
    };
  }

  wantListen = true;
  syncState({});

  try {
    await ensureMicStream();
  } catch (err) {
    wantListen = false;
    syncState({
      listening: false,
      error: err?.message || 'Impossible d’ouvrir le micro Safari.',
    });
    return false;
  }

  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    startAudioBackup();
  }

  startWatchdog();
  startRecognitionInstance();
  return true;
}

export async function stopMeetingRecording() {
  wantListen = false;
  clearTimers();
  try {
    recognition?.stop();
  } catch {
    /* ignore */
  }
  recognition = null;

  commitInterim();
  await stopAudioBackup();
  // Garder le stream pendant une courte reprise possible ; liberer après stop explicite
  releaseMic();
  syncState({ listening: false });
  return getFullMeetingText();
}

export function getFullMeetingText() {
  const finalsText = finals.join(' ').replace(/\s+/g, ' ').trim();
  const inter = (interimText || '').trim();
  if (finalsText && inter) return `${finalsText} ${inter}`.replace(/\s+/g, ' ').trim();
  return (finalsText || inter).replace(/\s+/g, ' ').trim();
}

export function getMeetingAudioBlob() {
  if (audioBlob?.size) return audioBlob;
  if (audioChunks.length) {
    return new Blob(audioChunks, { type: 'audio/webm' });
  }
  return null;
}

export function downloadMeetingAudio(filename) {
  const blob = getMeetingAudioBlob();
  if (!blob) return false;
  const ext = blob.type.includes('mp4') || blob.type.includes('aac') ? 'm4a' : 'webm';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${(state.title || 'reunion').replace(/[^\w\-]+/g, '_').slice(0, 40)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
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

export async function clearMeetingDraft() {
  wantListen = false;
  clearTimers();
  try {
    recognition?.abort();
  } catch {
    /* ignore */
  }
  recognition = null;
  await stopAudioBackup();
  releaseMic();
  finals = [];
  interimText = '';
  audioChunks = [];
  audioBlob = null;
  state = {
    id: '',
    title: '',
    transcript: '',
    interim: '',
    startedAt: '',
    updatedAt: '',
    listening: false,
    error: null,
    safari: isAppleSafari(),
    hasAudio: false,
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
    hasAudio: Boolean(getMeetingAudioBlob()?.size),
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
