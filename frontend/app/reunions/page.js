'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mic, Play, Trash2, Copy, Check, Radio } from 'lucide-react';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import {
  deleteSavedMeeting,
  getMeetingState,
  listSavedMeetings,
  startMeetingRecording,
  subscribeMeeting,
} from '../../lib/meeting-recorder';
import { openMeetingWindow } from '../../lib/meeting-window';

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('fr-CA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ReunionsPage() {
  const [history, setHistory] = useState([]);
  const [listening, setListening] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const refresh = useCallback(() => {
    setHistory(listSavedMeetings());
    setListening(Boolean(getMeetingState().listening));
  }, []);

  useEffect(() => {
    refresh();
    return subscribeMeeting(() => setListening(Boolean(getMeetingState().listening)));
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const launch = () => {
    openMeetingWindow({ viewingId: null });
    const st = getMeetingState();
    if (!st.listening) {
      startMeetingRecording({ clear: !st.transcript });
    }
  };

  return (
    <AuthGuard>
      <AppShell
        title="Réunions"
        subtitle="Synthèse speak-to-text — fenêtre indépendante, enregistrement continu"
      >
        <div className="space-y-6">
          <section className="cf-panel overflow-hidden">
            <div className="relative px-5 py-6 sm:px-7 sm:py-8 bg-[linear-gradient(135deg,oklch(0.97_0.01_55)_0%,oklch(0.99_0.005_80)_50%,white_100%)]">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 max-w-xl">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-neya-orange mb-2">
                    Module réunion
                  </p>
                  <h2 className="font-display text-[22px] sm:text-[26px] font-semibold text-neya-ink leading-tight">
                    Lancer · parler · le texte s’écrit
                  </h2>
                  <p className="mt-2 text-[14px] text-neya-muted leading-relaxed">
                    Une seule fenêtre flottante. Changez de page dans l’ERP : l’enregistrement
                    continue. Transcription navigateur (pas d’IA), sauvée au fil de l’eau sur cet
                    appareil.
                  </p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={launch}
                    className="btn-primary inline-flex items-center justify-center gap-2 h-11 px-5 text-[14px]"
                  >
                    {listening ? (
                      <>
                        <Radio className="h-4 w-4 animate-pulse" />
                        Ouvrir la fenêtre
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        Lancer l’enregistrement
                      </>
                    )}
                  </button>
                  {listening && (
                    <p className="text-[12px] text-center text-red-600 font-medium">
                      Enregistrement en cours…
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-px bg-neya-border border-t border-neya-border">
              {[
                { t: 'Speak-to-text', d: 'Chrome / Edge · fr-CA · micro navigateur' },
                { t: 'Anti-perte', d: 'Chaque phrase finalisée est écrite tout de suite' },
                { t: 'Fenêtre fixe', d: 'Réduire ou naviguer sans couper le micro' },
              ].map((item) => (
                <div key={item.t} className="bg-white px-4 py-3.5">
                  <p className="text-[13px] font-display font-semibold text-neya-ink">{item.t}</p>
                  <p className="mt-0.5 text-[12px] text-neya-muted leading-snug">{item.d}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-display text-[16px] font-semibold text-neya-ink">
                Réunions sauvées
              </h3>
              <button type="button" className="btn-ghost text-[12px]" onClick={refresh}>
                Actualiser
              </button>
            </div>

            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neya-border bg-neya-surface/40 px-5 py-10 text-center">
                <Mic className="mx-auto h-8 w-8 text-neya-muted/50 mb-2" />
                <p className="text-[14px] text-neya-muted">
                  Aucune synthèse pour l’instant. Lancez une réunion, puis « Sauver ».
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {history.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-xl border border-neya-border bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openMeetingWindow({ viewingId: m.id })}
                    >
                      <p className="truncate font-medium text-[14px] text-neya-ink">{m.title}</p>
                      <p className="text-[12px] text-neya-muted mt-0.5">
                        {formatWhen(m.savedAt || m.startedAt)}
                        {m.transcript
                          ? ` · ${m.transcript.split(/\s+/).filter(Boolean).length} mots`
                          : ''}
                      </p>
                      {m.transcript ? (
                        <p className="mt-1.5 text-[12.5px] text-neya-muted line-clamp-2 leading-snug">
                          {m.transcript}
                        </p>
                      ) : null}
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        className="btn-ghost text-[12px] inline-flex items-center gap-1"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(m.transcript || '');
                            setCopiedId(m.id);
                            setTimeout(() => setCopiedId(null), 1400);
                          } catch {
                            /* ignore */
                          }
                        }}
                      >
                        {copiedId === m.id ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copier
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-[12px] text-red-600 inline-flex items-center gap-1"
                        onClick={() => {
                          if (!window.confirm('Supprimer cette synthèse ?')) return;
                          deleteSavedMeeting(m.id);
                          refresh();
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Suppr.
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
