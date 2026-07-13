'use client';

import Link from 'next/link';
import Image from 'next/image';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import ChatAssistant from './ChatAssistant';
import NavigationBackSupport from './NavigationBackSupport';

export default function AppShell({ children, title, wide = false }) {
  return (
    <div className="min-h-screen min-h-[100dvh] bg-white">
      <NavigationBackSupport />
      <Sidebar />
      <MobileNav />

      <div className="lg:hidden sticky top-0 z-30 bg-white border-b border-neya-border px-4 h-12 flex items-center gap-3">
        <Image src="/brand/logo-orange.png" alt="Neya" width={72} height={28} className="h-6 w-auto shrink-0" priority />
        {title && <h1 className="text-sm font-medium text-neya-ink truncate flex-1">{title}</h1>}
        <Link href="/settings" className="text-xs text-neya-muted px-2 py-1">⚙</Link>
      </div>

      <main className="lg:ml-[var(--sidebar-w)] min-h-screen min-h-[100dvh] pb-shell">
        {title && (
          <header className="hidden lg:flex sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-neya-border px-8 h-14 items-center justify-between">
            <h1 className="text-lg font-medium text-neya-ink tracking-tight truncate">{title}</h1>
            <Link href="/settings" className="btn-ghost">Paramètres</Link>
          </header>
        )}
        <div className={`p-4 sm:p-6 lg:px-8 lg:py-8 mx-auto w-full ${wide ? 'max-w-[1400px]' : 'max-w-6xl'}`}>
          {children}
        </div>
      </main>
      <ChatAssistant />
    </div>
  );
}
