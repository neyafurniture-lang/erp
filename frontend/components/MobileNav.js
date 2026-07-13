'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { hasPermission } from '../lib/permissions';

const MAIN = [
  { href: '/', label: 'Accueil', permission: 'dashboard' },
  { href: '/production', label: 'Production', permission: 'production' },
  { href: '/liste-courses', label: 'Courses', permission: 'purchases' },
  { href: '/projects', label: 'Projets', permission: 'projects' },
];

const MORE = [
  { href: '/admin', label: 'Admin', permission: 'admin' },
  { href: '/purchases', label: 'Achats', permission: 'purchases' },
  { href: '/inventory', label: 'Stock', permission: 'inventory' },
  { href: '/team', label: 'Équipe', permission: 'team' },
  { href: '/calendar', label: 'Calendrier', permission: 'calendar' },
  { href: '/invoices', label: 'Factures', permission: 'invoices' },
  { href: '/clients', label: 'Clients', permission: 'clients' },
  { href: '/manual', label: 'Manuel', permission: 'dashboard' },
  { href: '/settings', label: 'Paramètres', permission: 'settings' },
  { href: '/roadmap', label: 'Roadmap', permission: 'settings' },
];

export default function MobileNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const main = MAIN.filter(i => hasPermission(user, i.permission));
  const more = MORE.filter(i => hasPermission(user, i.permission));
  const moreActive = more.some(({ href }) => pathname.startsWith(href));

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  return (
    <>
      {moreOpen && (
        <button type="button" aria-label="Fermer" className="lg:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setMoreOpen(false)} />
      )}
      {moreOpen && (
        <div className="lg:hidden fixed bottom-16 left-0 right-0 z-50 p-3">
          <div className="bg-white border border-neya-border rounded shadow-sm p-2 grid grid-cols-3 gap-1">
            {more.map(({ href, label }) => (
              <Link key={href} href={href} className={`text-center py-3 text-xs font-medium rounded ${pathname.startsWith(href) ? 'bg-neya-surface text-neya-ink font-semibold' : 'text-neya-muted'}`}>
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-neya-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex h-14">
          {main.map(({ href, label }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`flex-1 flex flex-col items-center justify-center text-[10px] font-medium ${active ? 'text-neya-ink font-semibold' : 'text-neya-muted'}`}>
                {label}
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(v => !v)} className={`flex-1 flex flex-col items-center justify-center text-[10px] font-medium ${moreActive || moreOpen ? 'text-neya-ink font-semibold' : 'text-neya-muted'}`}>
            Plus
          </button>
        </div>
      </nav>
    </>
  );
}
