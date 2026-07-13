'use client';

import { useEffect, useRef, useState } from 'react';

const IGNORE_SEL =
  '.voice-orb-container, .voice-composer, .voice-response-card, [data-element-picker], [data-neya-picker-ignore]';

function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function buildSelector(el) {
  if (!el || el === document.body || el === document.documentElement) return 'body';
  if (el.id) return `#${cssEscape(el.id)}`;
  const parts = [];
  let node = el;
  let depth = 0;
  while (node && node !== document.body && depth < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`#${cssEscape(node.id)}`);
      break;
    }
    const cls = [...(node.classList || [])]
      .filter((c) => c && !c.startsWith('hover:') && c.length < 40)
      .slice(0, 2);
    if (cls.length) part += '.' + cls.map(cssEscape).join('.');
    const parent = node.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(node) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    node = parent;
    depth += 1;
  }
  return parts.join(' > ');
}

function collectDataAttrs(el) {
  const out = {};
  if (!el?.attributes) return out;
  for (const a of el.attributes) {
    if (a.name.startsWith('data-') && Object.keys(out).length < 12) {
      out[a.name] = String(a.value).slice(0, 80);
    }
  }
  return out;
}

export function describeElement(el) {
  if (!el) return null;
  const text = String(el.innerText || el.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  const aria = el.getAttribute?.('aria-label') || '';
  const title = el.getAttribute?.('title') || '';
  const href = el.getAttribute?.('href') || '';
  const name = el.getAttribute?.('name') || '';
  const placeholder = el.getAttribute?.('placeholder') || '';
  const tag = el.tagName?.toLowerCase() || 'div';
  const classes = [...(el.classList || [])].slice(0, 10);
  const selector = buildSelector(el);
  const rect = el.getBoundingClientRect?.();
  const heading =
    el.closest?.('section, article, [role="main"], main, header, nav')?.querySelector?.('h1,h2,h3')
      ?.textContent?.trim()
      ?.slice(0, 80) || '';
  const label =
    (aria || title || text || placeholder || name || tag).slice(0, 60) || tag;

  return {
    tag,
    id: el.id || null,
    classes,
    text,
    ariaLabel: aria || null,
    title: title || null,
    href: href || null,
    name: name || null,
    placeholder: placeholder || null,
    data: collectDataAttrs(el),
    selector,
    pathname: typeof location !== 'undefined' ? location.pathname : '',
    heading: heading || null,
    role: el.getAttribute?.('role') || null,
    label,
    box: rect
      ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        }
      : null,
  };
}

/**
 * Mode inspection : survol + clic pour désigner un élément à Lia.
 */
export default function ElementPicker({ active, onPick, onCancel }) {
  const [hoverBox, setHoverBox] = useState(null);
  const hoverElRef = useRef(null);

  useEffect(() => {
    if (!active) {
      setHoverBox(null);
      hoverElRef.current = null;
      return undefined;
    }

    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';

    function ignored(el) {
      return !el || el.closest?.(IGNORE_SEL);
    }

    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || ignored(el) || el === document.body || el === document.documentElement) {
        setHoverBox(null);
        hoverElRef.current = null;
        return;
      }
      hoverElRef.current = el;
      const r = el.getBoundingClientRect();
      setHoverBox({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        label: (el.getAttribute('aria-label') || el.innerText || el.tagName)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 48),
      });
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const el = hoverElRef.current || document.elementFromPoint(e.clientX, e.clientY);
      if (!el || ignored(el)) return;
      const desc = describeElement(el);
      if (desc) onPick?.(desc);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
      }
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.body.style.cursor = prevCursor;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [active, onPick, onCancel]);

  if (!active) return null;

  return (
    <div data-element-picker className="fixed inset-0 z-[58] pointer-events-none" aria-live="polite">
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[59] pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2 bg-white border border-neya-border shadow-sm text-sm">
          <span className="text-neya-ink font-medium">Pointer un élément</span>
          <span className="text-neya-muted text-xs hidden sm:inline">Cliquez la cible · Échap pour annuler</span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-1 text-xs px-2 py-1 border border-neya-border hover:bg-neya-surface"
          >
            Annuler
          </button>
        </div>
      </div>
      {hoverBox && (
        <div
          className="absolute border-2 border-neya-ink bg-neya-ink/5 pointer-events-none transition-[top,left,width,height] duration-75"
          style={{
            top: hoverBox.top,
            left: hoverBox.left,
            width: Math.max(hoverBox.width, 4),
            height: Math.max(hoverBox.height, 4),
          }}
        >
          <span className="absolute -top-6 left-0 max-w-[240px] truncate text-[10px] px-1.5 py-0.5 bg-neya-ink text-white">
            {hoverBox.label || 'élément'}
          </span>
        </div>
      )}
    </div>
  );
}
