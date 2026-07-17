'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, logout } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { hasPermission } from '../lib/permissions';

const NAV = [
  { href: '/', label: 'Tableau de bord', section: 'principal', permission: 'dashboard' },
  { href: '/production', label: 'Production', section: 'principal', permission: 'production' },
  { href: '/sauna-cloud', label: 'Sauna Cloud', section: 'principal', permission: 'production' },
  { href: '/cutting-plans', label: 'Plans de coupe', section: 'principal', permission: 'production' },
  { href: '/admin', label: 'Session admin', section: 'principal', permission: 'admin' },
  { href: '/projects', label: 'Projets', section: 'principal', permission: 'projects' },
  { href: '/liste-courses', label: 'Liste de courses', section: 'ops', permission: 'purchases' },
  { href: '/purchases', label: 'Achats atelier', section: 'ops', permission: 'purchases' },
  { href: '/inventory', label: 'Stock', section: 'ops', permission: 'inventory' },
  { href: '/team', label: 'Équipe', section: 'ops', permission: 'team' },
  { href: '/calendar', label: 'Calendrier', section: 'ops', permission: 'calendar' },
  { href: '/drive', label: 'Drive', section: 'integrations', permission: 'drive' },
  { href: '/mail', label: 'Courriel', section: 'integrations', permission: 'mail' },
  { href: '/invoices', label: 'Devis & factures', section: 'facturation', permission: 'invoices' },
  { href: '/expenses', label: 'Dépenses', section: 'ops', permission: 'expenses' },
  { href: '/clients', label: 'Clients', section: 'crm', permission: 'clients' },
  { href: '/standards', label: 'Standards', section: 'crm', permission: 'standards' },
  { href: '/web', label: 'Site web', section: 'crm', permission: 'web' },
];

const SECTIONS = [
  { id: 'principal', label: 'Atelier' },
  { id: 'ops', label: 'Opérations' },
  { id: 'integrations', label: 'Outils' },
  { id: 'facturation', label: 'Facturation' },
  { id: 'crm', label: 'Commercial' },
];

function NavLink({ href, label, active }) {
  return (
    <Link
      href={href}
      className={`nav-item ${active ? 'nav-item-active' : 'nav-item-idle'}`}
    >
      <span className="nav-item-dot" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [shopUrl, setShopUrl] = useState('https://neyafurniture.ca');

  const visibleNav = NAV.filter(n => hasPermission(user, n.permission));
  const showSettings = hasPermission(user, 'settings');
  const shopHost = shopUrl.replace(/^https?:\/\//, '');

  useEffect(() => {
    api('/wordpress/status').then(s => { if (s?.base) setShopUrl(s.base); }).catch(() => {});
  }, []);

  return (
    <aside className="neya-sidebar hidden lg:flex fixed left-0 top-0 h-full w-[var(--sidebar-w)] flex-col z-40">
      <div className="neya-sidebar-brand">
        <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-[10px] shadow-sm">
          <Image src="/brand/picto-orange.png" alt="Neya" width={32} height={32} className="h-8 w-8 object-cover" priority />
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-semibold leading-tight text-neya-ink">
            NEYA <span className="text-neya-orange">ERP</span>
          </p>
          <p className="neya-sidebar-tagline">Atelier Furniture</p>
        </div>
      </div>

      <nav className="neya-sidebar-nav" aria-label="Navigation principale">
        {SECTIONS.filter(sec => visibleNav.some(n => n.section === sec.id)).map(sec => (
          <section key={sec.id} className="nav-group">
            <h2 className="nav-group-title">{sec.label}</h2>
            <div className="nav-group-list">
              {visibleNav.filter(n => n.section === sec.id).map(({ href, label }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
                return <NavLink key={href} href={href} label={label} active={active} />;
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="neya-sidebar-footer">
        <div className="nav-group-list">
          {hasPermission(user, 'dashboard') && (
            <NavLink href="/manual" label="Manuel" active={pathname.startsWith('/manual')} />
          )}
          {showSettings && (
            <>
              <NavLink href="/settings" label="Paramètres" active={pathname.startsWith('/settings')} />
              <NavLink href="/roadmap" label="Roadmap" active={pathname.startsWith('/roadmap')} />
            </>
          )}
          <button type="button" onClick={logout} className="nav-item nav-item-idle nav-item-danger">
            <span className="nav-item-dot" aria-hidden />
            <span>Déconnexion</span>
          </button>
        </div>
        <a
          href={shopUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="neya-sidebar-shop"
        >
          {shopHost}
        </a>
      </div>
    </aside>
  );
}
