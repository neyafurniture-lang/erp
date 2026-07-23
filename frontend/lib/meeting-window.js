'use client';

import { useSyncExternalStore } from 'react';

/** UI flottante — indépendante de la page / AppShell. */
let ui = {
  open: false,
  minimized: false,
  /** id réunion historique affichée en lecture seule, ou null */
  viewingId: null,
};

const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return ui;
}

export function openMeetingWindow({ viewingId = null } = {}) {
  ui = { open: true, minimized: false, viewingId };
  emit();
}

export function closeMeetingWindow() {
  ui = { ...ui, open: false, minimized: false, viewingId: null };
  emit();
}

export function minimizeMeetingWindow() {
  ui = { ...ui, minimized: true };
  emit();
}

export function expandMeetingWindow() {
  ui = { ...ui, open: true, minimized: false };
  emit();
}

export function setMeetingViewingId(viewingId) {
  ui = { ...ui, viewingId, open: true, minimized: false };
  emit();
}

export function useMeetingWindowUi() {
  return useSyncExternalStore(subscribe, getSnapshot, () => ({
    open: false,
    minimized: false,
    viewingId: null,
  }));
}
