'use client';

import Link from 'next/link';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import ChatAssistant from './ChatAssistant';
import NavigationBackSupport from './NavigationBackSupport';
import NeyaMark from './NeyaMark';
import { Bell, Plus, Search } from 'lucide-react';

export default function AppShell({
  children,
  title,
  subtitle,
  wide = false,
  flushMobile = false,
  /** Plein écran sans padding (ex. Courriel Craft Flow) */
  flush = false,
}) {
  return (
    <div className="min-h-screen min-h-[100dvh] bg-[var(--background)]">
      <NavigationBackSupport />
      <Sidebar />
      <MobileNav />

      <div className="lg:hidden sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-neya-border px-4 h-14 flex items-center gap-3">
        <NeyaMark className="h-7 w-auto shrink-0 max-w-[110px]" />
        {title && <h1 className="text-sm font-display font-semibold text-neya-ink truncate flex-1">{title}</h1>}
      </div>

      <main className={`lg:ml-[var(--sidebar-w)] min-h-screen min-h-[100dvh] ${
        flush || flushMobile ? 'pb-mail' : 'pb-shell'
      } ${flush ? 'flex flex-col' : ''}`}>
        <header className="hidden lg:flex sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-neya-border px-8 h-16 items-center gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            {title && (
              <h1 className="truncate font-display text-[19px] font-semibold text-neya-ink">{title}</h1>
            )}
            {subtitle && (
              <p className="truncate text-[12.5px] text-neya-muted">{subtitle}</p>
            )}
          </div>
          <div className="hidden flex-1 max-w-md xl:block">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neya-muted" aria-hidden />
              <input
                type="search"
                placeholder="Rechercher un projet, client, mail…"
                className="h-9 w-full rounded-lg border border-neya-border bg-neya-surface/80 pl-9 pr-16 text-[13px] outline-none placeholder:text-neya-muted focus:border-neya-orange/40 focus:bg-white focus:ring-2 focus:ring-neya-orange/15"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-neya-border bg-white px-1.5 py-0.5 text-[10px] font-medium text-neya-muted">
                ⌘K
              </kbd>
            </label>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="relative grid h-9 w-9 place-items-center rounded-lg text-neya-muted hover:bg-neya-surface"
              aria-label="Notifications"
            >
              <Bell className="h-[17px] w-[17px]" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-neya-orange" />
            </button>
            <Link
              href="/projects"
              className="hidden h-9 items-center gap-1.5 rounded-lg bg-neya-ink px-3 text-[13px] font-medium text-white hover:bg-neya-ink/90 sm:inline-flex"
            >
              <Plus className="h-4 w-4" /> Nouveau
            </Link>
            <Link href="/settings" className="btn-ghost text-xs">Paramètres</Link>
          </div>
        </header>
        <div className={
          flush
            ? 'flex-1 min-h-0 w-full overflow-hidden'
            : `mx-auto w-full ${wide ? 'max-w-[1400px]' : 'max-w-6xl'} ${
              flushMobile
                ? 'p-0 sm:p-6 lg:px-8 lg:py-8'
                : 'p-4 sm:p-6 lg:px-8 lg:py-8'
            }`
        }>
          {children}
        </div>
      </main>
      <ChatAssistant />
    </div>
  );
}
