'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { hasPermission } from '../lib/permissions';

const MAIN = [
  { href: '/', label: 'Accueil', permission: 'dashboard' },
  { href: '/production', label: 'Prod.', permission: 'production' },
  { href: '/sauna-cloud', label: 'Sauna', permission: 'production' },
  { href: '/liste-courses', label: 'Courses', permission: 'purchases' },
];

const MORE_GROUPS = [
  {
    title: 'Atelier',
    items: [
      { href: '/projects', label: 'Projets', permission: 'projects' },
      { href: '/admin', label: 'Admin', permission: 'admin' },
      { href: '/purchases', label: 'Achats', permission: 'purchases' },
      { href: '/inventory', label: 'Stock', permission: 'inventory' },
      { href: '/team', label: 'Équipe', permission: 'team' },
    ],
  },
  {
    title: 'Outils',
    items: [
      { href: '/calendar', label: 'Calendrier', permission: 'calendar' },
      { href: '/mail', label: 'Courriel', permission: 'mail' },
      { href: '/drive', label: 'Drive', permission: 'drive' },
    ],
  },
  {
    title: 'Business',
    items: [
      { href: '/invoices', label: 'Factures', permission: 'invoices' },
      { href: '/clients', label: 'Clients', permission: 'clients' },
      { href: '/manual', label: 'Manuel', permission: 'dashboard' },
      { href: '/settings', label: 'Paramètres', permission: 'settings' },
      { href: '/roadmap', label: 'Roadmap', permission: 'settings' },
    ],
  },
];

export default function MobileNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const main = MAIN.filter(i => hasPermission(user, i.permission));
  const groups = MORE_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => hasPermission(user, i.permission)) }))
    .filter(g => g.items.length > 0);
  const moreActive = groups.some(g => g.items.some(({ href }) => pathname.startsWith(href)));

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  return (
    <>
      {moreOpen && (
        <button type="button" aria-label="Fermer" className="lg:hidden fixed inset-0 z-40 bg-black/35" onClick={() => setMoreOpen(false)} />
      )}
      {moreOpen && (
        <div className="lg:hidden fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 z-50 p-3">
          <div className="bg-neya-surface border border-neya-border rounded-lg shadow-sm p-3 space-y-4 max-h-[55vh] overflow-y-auto">
            {groups.map(g => (
              <section key={g.title}>
                <h3 className="px-2 mb-1.5 text-[13px] font-semibold text-neya-orange">{g.title}</h3>
                <div className="grid grid-cols-3 gap-1">
                  {g.items.map(({ href, label }) => {
                    const active = pathname.startsWith(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        className={`text-center py-2.5 text-[13px] font-medium rounded-md transition-colors ${
                          active ? 'bg-white text-neya-ink font-semibold shadow-sm ring-1 ring-neya-border' : 'text-neya-ink/80 hover:bg-white'
                        }`}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-neya-surface border-t border-neya-border" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex h-14">
          {main.map(({ href, label }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 text-[12px] font-medium ${
                  active ? 'text-neya-ink font-semibold' : 'text-neya-ink/65'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-neya-orange' : 'bg-transparent'}`} aria-hidden />
                {label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(v => !v)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-[12px] font-medium ${
              moreActive || moreOpen ? 'text-neya-ink font-semibold' : 'text-neya-ink/65'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${moreActive || moreOpen ? 'bg-neya-orange' : 'bg-transparent'}`} aria-hidden />
            Plus
          </button>
        </div>
      </nav>
    </>
  );
}
