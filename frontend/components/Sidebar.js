'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Hammer,
  Cloud,
  Scissors,
  Shield,
  FolderKanban,
  ShoppingCart,
  Package,
  Users,
  Calendar,
  Clock,
  HardDrive,
  Mail,
  FileText,
  Wallet,
  BookOpen,
  Settings,
  Map,
  Globe,
  TrendingUp,
  Banknote,
  Store,
  Share2,
  LogOut,
  MoreHorizontal,
  Truck,
  Mic,
} from 'lucide-react';
import { api, logout } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { canAccessHours, canAccessPath, hasPermission } from '../lib/permissions';
import NeyaMark from './NeyaMark';

const NAV = [
  { href: '/', label: 'Tableau de bord', section: 'principal', permission: 'dashboard', icon: LayoutDashboard },
  { href: '/production', label: 'Production', section: 'principal', permission: 'production', icon: Hammer },
  { href: '/projects', label: 'Projets', section: 'principal', permission: 'projects', icon: FolderKanban },
  { href: '/team', label: 'Quarts', section: 'principal', permission: 'team', icon: Users },
  { href: '/calendar', label: 'Calendrier', section: 'principal', permission: 'calendar', icon: Calendar },
  { href: '/mes-heures', label: 'Mes heures', section: 'principal', permission: 'hours', icon: Clock },
  { href: '/cutting-plans', label: 'Plans de coupe', section: 'principal', permission: 'production', icon: Scissors },
  { href: '/sauna-cloud', label: 'Sauna Cloud', section: 'principal', permission: 'production', icon: Cloud },
  { href: '/mail', label: 'Courriel', section: 'ops', permission: 'mail', icon: Mail },
  { href: '/clients', label: 'Clients', section: 'ops', permission: 'clients', icon: Users },
  { href: '/suppliers', label: 'Fournisseurs', section: 'ops', permission: 'purchases', icon: Truck },
  { href: '/admin', label: 'Tâches bureau', section: 'ops', permission: 'admin', icon: Shield },
  { href: '/reunions', label: 'Réunions', section: 'ops', permission: 'meetings', icon: Mic },
  { href: '/marketplace', label: 'Ventes marketplace', section: 'tools', permission: 'marketplace', icon: Store },
  { href: '/social', label: 'Réseaux sociaux', section: 'tools', permission: 'social', icon: Share2 },
  { href: '/inventory', label: 'Stock', section: 'tools', permission: 'inventory', icon: Package },
  { href: '/liste-courses', label: 'Liste de courses', section: 'tools', permission: 'purchases', icon: ShoppingCart },
  { href: '/purchases', label: 'Achats atelier', section: 'tools', permission: 'purchases', icon: Package },
  { href: '/drive', label: 'Drive', section: 'tools', permission: 'drive', icon: HardDrive },
  { href: '/invoices', label: 'Devis & factures', section: 'facturation', permission: 'invoices', icon: FileText },
  { href: '/expenses', label: 'Dépenses', section: 'facturation', permission: 'expenses', icon: Wallet },
  { href: '/finance', label: 'Finance', section: 'facturation', permission: 'finance', icon: TrendingUp },
  { href: '/paie', label: 'Paie', section: 'facturation', permission: 'payroll', icon: Banknote },
  { href: '/standards', label: 'Standards', section: 'crm', permission: 'standards', icon: BookOpen },
  { href: '/web', label: 'Site web', section: 'crm', permission: 'web', icon: Globe },
];

const SECTIONS = [
  { id: 'principal', label: 'Atelier' },
  { id: 'ops', label: 'Bureau' },
  { id: 'facturation', label: 'Argent' },
  { id: 'tools', label: 'Outils' },
  { id: 'crm', label: 'Boutique' },
];

function NavLink({ href, label, active, Icon, danger }) {
  return (
    <Link
      href={href}
      className={`nav-item ${active ? 'nav-item-active' : 'nav-item-idle'} ${danger ? 'nav-item-danger' : ''}`}
    >
      {Icon ? <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden /> : null}
      <span className="truncate">{label}</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [shopUrl, setShopUrl] = useState('https://neyafurniture.ca');

  const visibleNav = NAV.filter(n => {
    if (n.permission === 'finance') return canAccessPath(user, '/finance');
    if (n.permission === 'hours') return canAccessHours(user);
    if (n.permission === 'payroll') return canAccessPath(user, '/paie');
    if (n.permission === 'meetings') return canAccessPath(user, '/reunions');
    return hasPermission(user, n.permission);
  });
  const showSettings = hasPermission(user, 'settings');
  const shopHost = shopUrl.replace(/^https?:\/\//, '');
  const initials = (user?.name || user?.email || 'N')
    .split(/\s+/)
    .map(p => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    api('/wordpress/status').then(s => { if (s?.base) setShopUrl(s.base); }).catch(() => {});
  }, []);

  return (
    <aside className="neya-sidebar hidden lg:flex fixed left-0 top-0 h-full w-[var(--sidebar-w)] flex-col z-40">
      <div className="neya-sidebar-brand">
        <div className="min-w-0">
          <NeyaMark className="h-9 w-auto max-w-[148px]" />
          <p className="neya-sidebar-tagline mt-0.5">Atelier Furniture</p>
        </div>
      </div>

      <nav className="neya-sidebar-nav" aria-label="Navigation principale">
        {SECTIONS.filter(sec => visibleNav.some(n => n.section === sec.id)).map(sec => (
          <section key={sec.id} className="nav-group mb-5">
            <h2 className="nav-group-title">{sec.label}</h2>
            <div className="nav-group-list">
              {visibleNav.filter(n => n.section === sec.id).map(({ href, label, icon: Icon }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
                return <NavLink key={href} href={href} label={label} active={active} Icon={Icon} />;
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="neya-sidebar-footer">
        <div className="nav-group-list mb-2">
          {hasPermission(user, 'dashboard') && (
            <NavLink href="/manual" label="Manuel" active={pathname.startsWith('/manual')} Icon={BookOpen} />
          )}
          {showSettings && (
            <>
              <NavLink href="/settings" label="Paramètres" active={pathname.startsWith('/settings')} Icon={Settings} />
              <NavLink href="/roadmap" label="Roadmap" active={pathname.startsWith('/roadmap')} Icon={Map} />
            </>
          )}
          <button type="button" onClick={logout} className="nav-item nav-item-idle nav-item-danger">
            <LogOut className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} aria-hidden />
            <span>Déconnexion</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/70">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neya-ink text-[12px] font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-neya-ink">{user?.name || 'Atelier'}</p>
            <p className="truncate text-[11px] text-neya-muted">{user?.role === 'admin' ? 'Propriétaire · Atelier' : 'Équipe atelier'}</p>
          </div>
          <MoreHorizontal className="h-4 w-4 text-neya-muted shrink-0" aria-hidden />
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
