'use client';

import { useEffect, useRef, useState } from 'react';

/** Petit triangle ▸ / ▾ ouvrant un menu d’actions (supprimer, etc.). */
export default function DocRowMenu({ items = [], align = 'right' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div ref={rootRef} className="relative inline-flex" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Actions"
        aria-expanded={open}
        title="Actions"
        onClick={() => setOpen(o => !o)}
        className={`doc-row-menu__tri ${open ? 'is-open' : ''}`}
      >
        <span className="doc-row-menu__tri-icon" aria-hidden />
      </button>
      {open && (
        <div
          className={`absolute z-30 mt-1 min-w-[10rem] rounded-lg border border-neya-border bg-white py-1 shadow-lg ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.id || item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-neya-surface disabled:opacity-40 ${
                item.danger ? 'text-neya-error' : 'text-neya-ink'
              }`}
              onClick={() => {
                setOpen(false);
                item.onClick?.();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
