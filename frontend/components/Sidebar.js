'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, logout } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { hasPermission } from '../lib/permissions';

const NAV = [
  { href: '/', label: 'Dashboard', section: 'principal', permission: 'dashboard' },
  { href: '/production', label: 'Production', section: 'principal', permission: 'production' },
  { href: '/admin', label: 'Gestion admin', section: 'principal', permission: 'admin' },
  { href: '/projects', label: 'Projets', section: 'principal', permission: 'projects' },
  { href: '/liste-courses', label: 'Liste de courses', section: 'ops', permission: 'purchases' },
  { href: '/purchases', label: 'Achats atelier', section: 'ops', permission: 'purchases' },
  { href: '/inventory', label: 'Stock', section: 'ops', permission: 'inventory' },
  { href: '/team', label: 'Équipe', section: 'ops', permission: 'team' },
  { href: '/drive', label: 'Drive', section: 'integrations', permission: 'drive' },
  { href: '/mail', label: 'Courriel', section: 'integrations', permission: 'mail' },
  { href: '/calendar', label: 'Calendrier', section: 'ops', permission: 'calendar' },
  { href: '/invoices', label: 'Factures', section: 'finance', permission: 'invoices' },
  { href: '/expenses', label: 'Dépenses', section: 'finance', permission: 'expenses' },
  { href: '/clients', label: 'Clients', section: 'crm', permission: 'clients' },
  { href: '/standards', label: 'Standards', section: 'crm', permission: 'standards' },
  { href: '/web', label: 'Site web', section: 'crm', permission: 'web' },
];

const SECTIONS = [
  { id: 'principal', label: 'Principal' },
  { id: 'ops', label: 'Opérations' },
  { id: 'integrations', label: 'Intégrations' },
  { id: 'finance', label: 'Finance' },
  { id: 'crm', label: 'Commercial' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [shopUrl, setShopUrl] = useState('https://neyafurniture.ca');

  const visibleNav = NAV.filter(n => hasPermission(user, n.permission));
  const showSettings = hasPermission(user, 'settings');

  useEffect(() => {
    api('/wordpress/status').then(s => { if (s?.base) setShopUrl(s.base); }).catch(() => {});
  }, []);

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 h-full w-[var(--sidebar-w)] bg-white border-r border-neya-border text-neya-ink flex-col z-40">
      <div className="px-5 py-5 border-b border-neya-border">
        <Image src="/brand/logo-orange.png" alt="Neya" width={88} height={32} className="h-8 w-auto" priority />
        <p className="text-[10px] text-neya-muted mt-2 tracking-wide">ERP · Neya Furniture</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {SECTIONS.filter(sec => visibleNav.some(n => n.section === sec.id)).map(sec => (
          <div key={sec.id} className="mb-6">
            <div className="flex items-center gap-2 px-3 mb-1">
              <span className="nav-section-label mb-0 shrink-0">{sec.label}</span>
              <span className="flex-1 h-px bg-neya-border/60" aria-hidden />
            </div>
            {visibleNav.filter(n => n.section === sec.id).map(({ href, label }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`nav-item block mb-0.5 ${active ? 'nav-item-active' : 'nav-item-idle'}`}
                >
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-neya-border space-y-1">
        {hasPermission(user, 'dashboard') && (
          <Link href="/manual" className={`nav-item block ${pathname.startsWith('/manual') ? 'nav-item-active' : 'nav-item-idle'}`}>
            Manuel ERP
          </Link>
        )}
        {showSettings && (
          <>
            <Link href="/settings" className={`nav-item block ${pathname.startsWith('/settings') ? 'nav-item-active' : 'nav-item-idle'}`}>
              Paramètres
            </Link>
            <Link href="/roadmap" className={`nav-item block ${pathname.startsWith('/roadmap') ? 'nav-item-active' : 'nav-item-idle'}`}>
              Roadmap
            </Link>
          </>
        )}
        <button type="button" onClick={logout} className="nav-item w-full text-left nav-item-idle text-neya-error hover:bg-red-50">
          Déconnexion
        </button>
        <a href={shopUrl} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-neya-muted hover:text-neya-orange px-3 pt-2">
          {shopUrl.replace(/^https?:\/\//, '')} ↗
        </a>
      </div>
    </aside>
  );
}
