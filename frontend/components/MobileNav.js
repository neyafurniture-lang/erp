'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { hasPermission } from '../lib/permissions';

const TABS = [
  { href: '/', label: 'Accueil', permission: 'dashboard', icon: 'home' },
  { href: '/production', label: 'Prod', permission: 'production', icon: 'prod' },
  { href: '/projects', label: 'Projets', permission: 'projects', icon: 'projects' },
  { href: '/mail', label: 'Mail', permission: 'mail', icon: 'mail' },
];

const MENU_GROUPS = [
  {
    title: 'Atelier',
    items: [
      { href: '/', label: 'Dashboard', permission: 'dashboard' },
      { href: '/production', label: 'Production', permission: 'production' },
      { href: '/sauna-cloud', label: 'Sauna Cloud', permission: 'production' },
      { href: '/cutting-plans', label: 'Plans de coupe', permission: 'production' },
      { href: '/admin', label: 'Session admin', permission: 'admin' },
      { href: '/projects', label: 'Projets', permission: 'projects' },
    ],
  },
  {
    title: 'Opérations',
    items: [
      { href: '/liste-courses', label: 'Liste de courses', permission: 'purchases' },
      { href: '/purchases', label: 'Achats atelier', permission: 'purchases' },
      { href: '/inventory', label: 'Stock', permission: 'inventory' },
      { href: '/team', label: 'Équipe', permission: 'team' },
      { href: '/calendar', label: 'Calendrier', permission: 'calendar' },
      { href: '/expenses', label: 'Dépenses', permission: 'expenses' },
    ],
  },
  {
    title: 'Outils',
    items: [
      { href: '/drive', label: 'Drive', permission: 'drive' },
      { href: '/mail', label: 'Courriel', permission: 'mail' },
    ],
  },
  {
    title: 'Facturation',
    items: [
      { href: '/invoices', label: 'Devis & factures', permission: 'invoices' },
    ],
  },
  {
    title: 'Commercial',
    items: [
      { href: '/clients', label: 'Clients', permission: 'clients' },
      { href: '/standards', label: 'Standards', permission: 'standards' },
      { href: '/web', label: 'Site web', permission: 'web' },
    ],
  },
  {
    title: 'Système',
    items: [
      { href: '/manual', label: 'Manuel ERP', permission: 'dashboard' },
      { href: '/settings', label: 'Paramètres', permission: 'settings' },
      { href: '/roadmap', label: 'Roadmap', permission: 'settings' },
    ],
  },
];

function TabIcon({ name, active }) {
  const stroke = active ? '#D86B30' : 'currentColor';
  const common = { fill: 'none', stroke, strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
          <path {...common} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
        </svg>
      );
    case 'prod':
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
          <path {...common} d="M4 7h16M4 12h10M4 17h14" />
        </svg>
      );
    case 'projects':
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
          <rect {...common} x="4" y="5" width="16" height="14" rx="2" />
          <path {...common} d="M8 5v14M4 10h16" />
        </svg>
      );
    case 'mail':
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
          <rect {...common} x="3" y="5" width="18" height="14" rx="2" />
          <path {...common} d="m3 7 9 7 9-7" />
        </svg>
      );
    case 'menu':
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
          <path {...common} d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      );
    default:
      return null;
  }
}

function isActivePath(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export default function MobileNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = TABS.filter(t => hasPermission(user, t.permission));
  const groups = MENU_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => hasPermission(user, i.permission)) }))
    .filter(g => g.items.length > 0);

  const menuActive = !tabs.some(t => isActivePath(pathname, t.href));

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [menuOpen]);

  return (
    <>
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-[70] flex flex-col" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            className="absolute inset-0 bg-neya-ink/40"
            aria-label="Fermer le menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="mobile-menu-sheet relative mt-auto flex flex-col bg-white rounded-t-2xl shadow-lg max-h-[88dvh] animate-mobile-sheet-in">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-neya-border shrink-0">
              <div>
                <p className="text-base font-semibold text-neya-ink">Menu</p>
                <p className="text-xs text-neya-muted mt-0.5">Tout l’ERP</p>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="w-10 h-10 rounded-full bg-neya-surface text-neya-ink text-xl leading-none"
                aria-label="Fermer"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {groups.map(g => (
                <section key={g.title} className="mb-5">
                  <h3 className="px-3 mb-1.5 text-[13px] font-semibold text-neya-orange">{g.title}</h3>
                  <ul className="rounded-xl bg-neya-surface overflow-hidden">
                    {g.items.map((item, idx) => {
                      const active = isActivePath(pathname, item.href);
                      return (
                        <li key={item.href} className={idx > 0 ? 'border-t border-neya-border/70' : ''}>
                          <Link
                            href={item.href}
                            className={`flex items-center justify-between px-4 py-3.5 text-[15px] min-h-[48px] ${
                              active ? 'bg-white font-semibold text-neya-ink' : 'text-neya-ink/85 font-medium'
                            }`}
                          >
                            <span>{item.label}</span>
                            {active ? (
                              <span className="w-2 h-2 rounded-full bg-neya-orange shrink-0" aria-hidden />
                            ) : (
                              <span className="text-neya-muted/50 text-lg leading-none" aria-hidden>›</span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="mobile-dock lg:hidden" aria-label="Navigation">
        <div className="mobile-dock-inner">
          {tabs.map(tab => {
            const active = isActivePath(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`mobile-dock-item ${active ? 'mobile-dock-item-active' : ''}`}
              >
                <TabIcon name={tab.icon} active={active} />
                <span>{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className={`mobile-dock-item ${menuActive || menuOpen ? 'mobile-dock-item-active' : ''}`}
            aria-expanded={menuOpen}
          >
            <TabIcon name="menu" active={menuActive || menuOpen} />
            <span>Menu</span>
          </button>
        </div>
      </nav>
    </>
  );
}
