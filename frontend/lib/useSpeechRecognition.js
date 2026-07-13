'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/**
 * Enregistrement vocal avec accumulation fiable.
 * Le texte interim (affiché en direct) est conservé à l'arrêt — plus de perte.
 */
export function useSpeechRecognition({ lang = 'fr-CA' } = {}) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const wantListenRef = useRef(false);
  const finalsRef = useRef([]); // morceaux finalisés
  const interimRef = useRef(''); // dernier interim (refs = synchrone au stop)
  const supported = typeof window !== 'undefined' && !!getSpeechRecognition();

  const getFullText = useCallback(() => {
    const finals = finalsRef.current.join(' ').trim();
    const inter = (interimRef.current || '').trim();
    if (finals && inter) return `${finals} ${inter}`.replace(/\s+/g, ' ').trim();
    return (finals || inter).replace(/\s+/g, ' ').trim();
  }, []);

  const syncUi = useCallback(() => {
    setTranscript(finalsRef.current.join(' ').replace(/\s+/g, ' ').trim());
    setInterim(interimRef.current);
  }, []);

  const stop = useCallback(() => {
    wantListenRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch { /* ignore */ }
    recognitionRef.current = null;
    setListening(false);

    // Important : garder l'interim dans le texte final
    const full = getFullText();
    if (interimRef.current.trim()) {
      finalsRef.current = full ? [full] : [];
      interimRef.current = '';
    }
    const result = finalsRef.current.join(' ').replace(/\s+/g, ' ').trim();
    setTranscript(result);
    setInterim('');
    return result;
  }, [getFullText]);

  const startRecognitionInstance = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition || !wantListenRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    // continuous=true marche mal sur iOS → on enchaîne des sessions courtes
    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
    recognition.continuous = !isIOS;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (wantListenRef.current) setListening(true);
    };

    recognition.onresult = (event) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = (event.results[i][0].transcript || '').trim();
        if (!piece) continue;
        if (event.results[i].isFinal) {
          finalsRef.current.push(piece);
          interimText = '';
          interimRef.current = '';
        } else {
          interimText += (interimText ? ' ' : '') + piece;
        }
      }
      if (interimText) interimRef.current = interimText;
      syncUi();
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      // no-speech : normal entre deux phrases en mode continu
      if (event.error === 'no-speech' && wantListenRef.current) return;
      const messages = {
        'not-allowed': 'Accès au micro refusé. Autorisez le micro dans les paramètres.',
        'no-speech': 'Aucune voix détectée. Réessayez.',
        network: 'Erreur réseau pour la reconnaissance vocale.',
      };
      if (event.error !== 'no-speech') {
        setError(messages[event.error] || `Erreur micro : ${event.error}`);
        wantListenRef.current = false;
        setListening(false);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      // Relancer tant que l'utilisateur n'a pas appuyé sur Stop
      if (wantListenRef.current) {
        // Petit délai pour iOS
        setTimeout(() => {
          if (!wantListenRef.current) return;
          try {
            startRecognitionInstance();
          } catch {
            setListening(false);
            wantListenRef.current = false;
          }
        }, 120);
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      console.warn('Speech start:', err);
      setListening(false);
    }
  }, [lang, syncUi]);

  const start = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setError('Reconnaissance vocale non supportée sur ce navigateur.');
      return;
    }

    setError(null);
    finalsRef.current = [];
    interimRef.current = '';
    setTranscript('');
    setInterim('');
    wantListenRef.current = true;
    startRecognitionInstance();
  }, [startRecognitionInstance]);

  const toggle = useCallback(() => {
    if (listening || wantListenRef.current) return stop();
    start();
    return null;
  }, [listening, start, stop]);

  useEffect(() => () => {
    wantListenRef.current = false;
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
  }, []);

  return {
    supported,
    listening,
    transcript,
    interim,
    /** Texte complet actuel (finals + interim) — à jour via refs */
    getFullText,
    error,
    start,
    stop,
    toggle,
    clearError: () => setError(null),
  };
}
