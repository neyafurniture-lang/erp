'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FolderKanban, Hammer, LayoutDashboard, Mail, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { canAccessHours, canAccessPath, hasPermission } from '../lib/permissions';

const TABS = [
  { href: '/', label: 'Accueil', permission: 'dashboard', Icon: LayoutDashboard },
  { href: '/production', label: 'Prod', permission: 'production', Icon: Hammer },
  { href: '/projects', label: 'Projets', permission: 'projects', Icon: FolderKanban },
  { href: '/mail', label: 'Courriel', permission: 'mail', Icon: Mail },
];

const MENU_GROUPS = [
  {
    title: 'Atelier',
    items: [
      { href: '/', label: 'Tableau de bord', permission: 'dashboard' },
      { href: '/production', label: 'Production', permission: 'production' },
      { href: '/projects', label: 'Projets', permission: 'projects' },
      { href: '/cutting-plans', label: 'Plans de coupe', permission: 'production' },
      { href: '/sauna-cloud', label: 'Sauna Cloud', permission: 'production' },
      { href: '/admin', label: 'Tâches admin', permission: 'admin' },
    ],
  },
  {
    title: 'Opérations',
    items: [
      { href: '/mail', label: 'Courriel', permission: 'mail' },
      { href: '/clients', label: 'Clients', permission: 'clients' },
      { href: '/suppliers', label: 'Fournisseurs', permission: 'purchases' },
      { href: '/calendar', label: 'Calendrier', permission: 'calendar' },
      { href: '/mes-heures', label: 'Mes heures', permission: 'hours' },
      { href: '/marketplace', label: 'Ventes marketplace', permission: 'marketplace' },
      { href: '/social', label: 'Réseaux sociaux', permission: 'social' },
      { href: '/inventory', label: 'Stock', permission: 'inventory' },
      { href: '/liste-courses', label: 'Liste de courses', permission: 'purchases' },
      { href: '/purchases', label: 'Achats atelier', permission: 'purchases' },
      { href: '/team', label: 'Équipe', permission: 'team' },
    ],
  },
  {
    title: 'Facturation',
    items: [
      { href: '/invoices', label: 'Devis & factures', permission: 'invoices' },
      { href: '/expenses', label: 'Dépenses', permission: 'expenses' },
      { href: '/finance', label: 'Finance', permission: 'finance' },
      { href: '/paie', label: 'Paie', permission: 'payroll' },
    ],
  },
  {
    title: 'Outils',
    items: [
      { href: '/drive', label: 'Drive', permission: 'drive' },
    ],
  },
  {
    title: 'Commercial',
    items: [
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

function isActivePath(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export default function MobileNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const canSee = (permission, href) => {
    if (permission === 'finance') return canAccessPath(user, href || '/finance');
    if (permission === 'hours') return canAccessHours(user);
    if (permission === 'payroll') return canAccessPath(user, href || '/paie');
    return hasPermission(user, permission);
  };
  const tabs = TABS.filter(t => canSee(t.permission, t.href));
  const groups = MENU_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => canSee(i.permission, i.href)) }))
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
                <p className="text-base font-display font-semibold text-neya-ink">Menu</p>
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
                  <h3 className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-neya-muted">{g.title}</h3>
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
            const Icon = tab.Icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`mobile-dock-item ${active ? 'mobile-dock-item-active' : ''}`}
              >
                <Icon className="h-[21px] w-[21px]" strokeWidth={active ? 2.3 : 1.9} aria-hidden />
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
            <MoreHorizontal className="h-[21px] w-[21px]" strokeWidth={menuActive || menuOpen ? 2.3 : 1.9} aria-hidden />
            <span>Plus</span>
          </button>
        </div>
      </nav>
    </>
  );
}
