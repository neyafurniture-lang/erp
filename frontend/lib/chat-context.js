'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/** @typedef {{ type: 'project'|'client'|'standard'|'quote'|'invoice'|'ui', id?: number, label: string, pathname?: string, meta?: Record<string, unknown> }} ChatPageContext */

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

/**
 * Fusionne le contexte page (projet/client…) avec un élément UI pointé.
 * @param {object|null} pickedElement
 */
export function buildAssistantContext(pickedElement = null) {
  const base = currentContext;
  if (!pickedElement && !base) return null;
  if (!pickedElement) return base;
  const label = pickedElement.label || pickedElement.text?.slice(0, 40) || 'Élément UI';
  return {
    type: base?.type || 'ui',
    id: base?.id || undefined,
    label: base?.label || label,
    pathname:
      (typeof location !== 'undefined' ? location.pathname : '') ||
      pickedElement.pathname ||
      base?.pathname ||
      '',
    meta: {
      ...(base?.meta || {}),
      element: pickedElement,
    },
  };
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
