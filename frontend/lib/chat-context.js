'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/** @typedef {{ type: 'project'|'client'|'standard', id: number, label: string, meta?: Record<string, unknown> }} ChatPageContext */

let currentContext = null;
const listeners = new Set();

function emit() {
  listeners.forEach(fn => fn());
}

/** @param {ChatPageContext|null} ctx */
export function setChatPageContext(ctx) {
  currentContext = ctx;
  emit();
}

export function clearChatPageContext() {
  currentContext = null;
  emit();
}

export function getChatPageContext() {
  return currentContext;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentContext;
}

export function useChatPageContext() {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** Enregistre le contexte chat pour la page courante (nettoyé au départ). */
export function useRegisterChatContext(context) {
  useEffect(() => {
    if (context?.type && context?.id) {
      setChatPageContext(context);
    } else {
      clearChatPageContext();
    }
    return () => clearChatPageContext();
  }, [context?.type, context?.id, context?.label]);
}
