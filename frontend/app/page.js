'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../components/AppShell';
import AuthGuard from '../components/AuthGuard';
import ProjectCard from '../components/ProjectCard';
import { api, formatMoney, formatDate } from '../lib/api';
import { AdminTasksSummary } from '../components/AdminTasksPanel';
import SupplierInvoiceQueue from '../components/SupplierInvoiceQueue';
import EditableSection from '../components/EditableSection';

const QUICK_ACTIONS = [
  { href: '/production', label: 'Production', icon: '⚒', primary: true },
  { href: '/admin', label: 'Admin', icon: '📋' },
  { href: '/projects', label: 'Projet', icon: '▣' },
  { href: '/invoices', label: 'Devis', icon: '▤' },
  { href: '/clients', label: 'Client', icon: '◉' },
  { href: '/expenses', label: 'Dépense', icon: '▥' },
  { href: '/calendar', label: 'Calendrier', icon: '▦' },
  { href: '/web', label: 'Site web', icon: '🌐' },
];

const TASK_STATUS = {
  todo: { label: 'À faire', cls: 'bg-neya-cream text-neya-muted' },
  doing: { label: 'En cours', cls: 'bg-neya-warning/20 text-neya-warning' },
  done: { label: 'Fait', cls: 'bg-green-100 text-green-800' },
};

function StatCard({ label, value, sub, accent, href }) {
  const inner = (
    <div className={`card h-full transition-all ${href ? 'hover:border-neya-orange hover:shadow-md cursor-pointer' : ''}`}>
      <p className="text-xs sm:text-sm text-neya-muted">{label}</p>
      <p className={`text-2xl sm:text-3xl font-heading mt-1 ${accent || 'text-neya-ink'}`}>{value}</p>
      {sub && <p className="text-[10px] sm:text-xs text-neya-muted mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

function AlertsBar({ alerts }) {
  if (!alerts?.length) return null;
  const styles = {
    danger: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mb-6 -mx-1 px-1 scrollbar-hide">
      {alerts.map((a, i) => (
        <Link
          key={i}
          href={a.href}
          className={`shrink-0 text-xs sm:text-sm font-medium px-4 py-2.5 rounded-full border ${styles[a.type] || styles.info}`}
        >
          {a.text} →
        </Link>
      ))}
    </div>
  );
}

function DashboardTodoList({ todos, onChange, listKey = 'main', title = 'Ma todo' }) {
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const listTodos = todos.filter(t => (t.list_key || 'main') === listKey);
  const pending = listTodos.filter(t => !t.done);
  const done = listTodos.filter(t => t.done);

  async function addTodo(e) {
    e.preventDefault();
    const t = newTitle.trim();
    if (!t) return;
    setAdding(true);
    try {
      await api('/dashboard/todos', { method: 'POST', body: JSON.stringify({ title: t, list_key: listKey }) });
      setNewTitle('');
      onChange();
    } finally {
      setAdding(false);
    }
  }

  async function toggleTodo(todo) {
    await api(`/dashboard/todos/${todo.id}`, { method: 'PATCH', body: JSON.stringify({ done: !todo.done }) });
    onChange();
  }

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-heading text-base sm:text-lg">{title}</h2>
        {pending.length > 0 && (
          <span className="text-xs font-semibold bg-neya-orange text-white px-2.5 py-0.5 rounded-full">{pending.length}</span>
        )}
      </div>
      <form onSubmit={addTodo} className="flex gap-2 mb-3">
        <input
          className="input flex-1"
          placeholder="Ajouter…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
        />
        <button type="submit" disabled={adding || !newTitle.trim()} className="btn-primary text-sm shrink-0 disabled:opacity-40">
          +
        </button>
      </form>
      <ul className="space-y-1 max-h-64 overflow-y-auto">
        {pending.length === 0 && done.length === 0 && (
          <li className="text-sm text-neya-muted italic py-2">Rien pour l&apos;instant</li>
        )}
        {pending.map(todo => (
          <li key={todo.id} className="flex items-center gap-2 py-2 min-h-[44px]">
            <button
              type="button"
              onClick={() => toggleTodo(todo)}
              className="w-9 h-9 shrink-0 rounded-lg border-2 border-neya-border hover:border-neya-orange bg-white"
              aria-label="Cocher"
            />
            <span className="text-sm flex-1">{todo.title}</span>
          </li>
        ))}
        {done.map(todo => (
          <li key={todo.id} className="flex items-center gap-2 py-2 opacity-60">
            <button
              type="button"
              onClick={() => toggleTodo(todo)}
              className="w-9 h-9 shrink-0 rounded-lg bg-neya-orange text-white text-sm"
              aria-label="Décocher"
            >✓</button>
            <span className="text-sm line-through flex-1">{todo.title}</span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-neya-muted mt-2">Cochées → disparaissent après 2 jours</p>
    </div>
  );
}

function TaskRow({ task, onToggle }) {
  const st = TASK_STATUS[task.status] || TASK_STATUS.todo;
  const time = task.start_time
    ? new Date(task.start_time).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <li className="flex items-center gap-2 py-2.5 border-b border-neya-border/60 last:border-0">
      {task.status !== 'done' && (
        <button
          type="button"
          onClick={() => onToggle(task)}
          className="w-8 h-8 shrink-0 rounded-lg border border-neya-border hover:bg-neya-orange hover:border-neya-orange hover:text-white text-xs"
          title="Marquer fait"
        >✓</button>
      )}
      <Link href={task.project_id ? `/projects/${task.project_id}` : '/calendar'} className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{task.title}</p>
        <p className="text-xs text-neya-muted truncate">
          {time && `${time} · `}{task.project_name || 'Atelier'}
        </p>
      </Link>
      <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
    </li>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [layout, setLayout] = useState(null);
  const [error, setError] = useState('');

  const load = () => Promise.all([
    api('/dashboard'),
    api('/ui/dashboard-layout'),
  ]).then(([d, ui]) => {
    setData(d);
    setLayout(ui.layout);
    setError('');
  }).catch(e => setError(e.message));

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('neya:assistant-action', handler);
    return () => window.removeEventListener('neya:assistant-action', handler);
  }, []);

  const editMode = Boolean(layout?.edit_mode);

  async function toggleEditMode() {
    const next = await api('/ui/dashboard-layout/edit-mode', {
      method: 'POST',
      body: JSON.stringify({ enabled: !editMode }),
    });
    setLayout(next);
  }

  async function moveSection(sectionId, direction) {
    const next = await api('/ui/dashboard-layout/move', {
      method: 'POST',
      body: JSON.stringify({ section_id: sectionId, direction }),
    });
    setLayout(next);
  }

  async function removeTodoSection(sectionId) {
    const next = await api('/ui/dashboard-layout/remove', {
      method: 'POST',
      body: JSON.stringify({ section_id: sectionId }),
    });
    setLayout(next);
  }

  async function addTodoList() {
    const title = window.prompt('Nom de la liste todo ?', 'Todo atelier');
    if (!title) return;
    const next = await api('/ui/dashboard-layout/add-todo', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    setLayout(next);
  }

  async function completeTask(task) {
    await api(`/tasks/${task.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...task, status: 'done' }),
    });
    load();
    window.dispatchEvent(new CustomEvent('neya:assistant-action'));
  }

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bonjour';
    if (h < 18) return 'Bon après-midi';
    return 'Bonsoir';
  })();

  const todayLabel = new Date().toLocaleDateString('fr-CA', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  if (!data && !error) {
    return <AuthGuard><AppShell title="Dashboard" wide><div className="text-neya-muted py-12 text-center">Chargement…</div></AppShell></AuthGuard>;
  }

  const s = data?.stats || {};
  const web = data?.web;
  const sections = (layout?.sections || []).filter(sec => sec.visible !== false);

  function wrap(section, node, extraClass = 'mb-6') {
    return (
      <EditableSection
        key={section.id}
        section={section}
        editMode={editMode}
        className={extraClass}
        onMoveUp={(id) => moveSection(id, 'up')}
        onMoveDown={(id) => moveSection(id, 'down')}
        onHide={removeTodoSection}
      >
        {node}
      </EditableSection>
    );
  }

  function renderSection(section) {
    if (section.type === 'todo') {
      return wrap(section, (
        <DashboardTodoList
          todos={data?.todos || []}
          onChange={load}
          listKey={section.list_key || 'main'}
          title={section.title || section.label || 'Todo'}
        />
      ), 'mb-4');
    }

    switch (section.id) {
      case 'alerts':
        return wrap(section, <AlertsBar alerts={data?.alerts} />, 'mb-4');
      case 'supplier_invoices':
        return wrap(section, <SupplierInvoiceQueue />, 'mb-4');
      case 'projects_cards':
        return wrap(section, (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium tracking-tight">Projets en cours</h2>
              <Link href="/projects" className="text-xs text-neya-orange hover:underline">Tous →</Link>
            </div>
            {data?.projectCards?.length === 0 ? (
              <div className="card-flat text-center py-12">
                <p className="text-sm text-neya-muted mb-4">Aucun projet actif</p>
                <Link href="/projects" className="btn-primary">Créer un projet</Link>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data?.projectCards?.map(p => (
                  <ProjectCard key={p.id} project={p} large onStatusChange={() => load()} />
                ))}
              </div>
            )}
          </section>
        ));
      case 'quick_actions':
        return wrap(section, (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {QUICK_ACTIONS.map(a => (
              <Link
                key={a.href}
                href={a.href}
                className={`flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-2xl border text-center min-h-[72px] transition-all active:scale-95 ${
                  a.primary
                    ? 'bg-neya-orange text-white border-neya-orange shadow-sm'
                    : 'bg-white border-neya-border hover:border-neya-orange text-neya-ink'
                }`}
              >
                <span className="text-xl">{a.icon}</span>
                <span className="text-[11px] font-semibold">{a.label}</span>
              </Link>
            ))}
          </div>
        ));
      case 'stats':
        return wrap(section, (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Projets actifs" value={s.activeProjects ?? 0} href="/projects"
              sub={s.overdueProjects > 0 ? `${s.overdueProjects} en retard` : `${s.dueSoonProjects ?? 0} deadline sous 7j`}
              accent={s.overdueProjects > 0 ? 'text-red-600' : 'text-neya-ink'} />
            <StatCard label="À recevoir" value={formatMoney(s.invoicesDue)} href="/invoices"
              sub={`${data?.pendingInvoices?.length ?? 0} facture(s)`} accent="text-neya-orange" />
            <StatCard label="Dépenses mois" value={formatMoney(s.expensesMonth)} href="/expenses" sub="Ce mois-ci" />
            <StatCard label="Clients" value={s.clients ?? 0} href="/clients"
              sub={web?.configured ? `${web.web_orders_active ?? 0} cmd. web` : `${s.unscheduledTasks ?? 0} tâches à planifier`} />
          </div>
        ));
      case 'today_week':
        return wrap(section, (
          <div className="space-y-4">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading text-base sm:text-lg">Aujourd&apos;hui</h2>
                <Link href="/calendar" className="text-xs text-neya-orange hover:underline">Calendrier →</Link>
              </div>
              {data?.tasksToday?.length === 0 ? (
                <p className="text-sm text-neya-muted py-4 text-center">Aucune tâche — planifiez dans le calendrier</p>
              ) : (
                <ul>{data?.tasksToday?.map(t => <TaskRow key={t.id} task={t} onToggle={completeTask} />)}</ul>
              )}
            </div>
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading text-base sm:text-lg">Cette semaine</h2>
                <span className="text-xs text-neya-muted">{data?.tasksWeek?.length ?? 0} planifiée(s)</span>
              </div>
              {data?.tasksWeek?.length === 0 ? (
                <p className="text-sm text-neya-muted py-2">Semaine libre pour l&apos;instant</p>
              ) : (
                <ul className="divide-y divide-neya-border/60">
                  {data?.tasksWeek?.map(t => {
                    const d = new Date(t.start_time);
                    return (
                      <li key={t.id} className="flex items-center gap-3 py-2.5">
                        <div className="w-10 text-center shrink-0">
                          <p className="text-[10px] text-neya-muted uppercase">{d.toLocaleDateString('fr-CA', { weekday: 'short' })}</p>
                          <p className="text-sm font-bold text-neya-orange">{d.getDate()}</p>
                        </div>
                        <Link href={t.project_id ? `/projects/${t.project_id}` : '/calendar'} className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{t.title}</p>
                          <p className="text-xs text-neya-muted truncate">
                            {d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })} · {t.project_name || 'Atelier'}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ));
      case 'admin_tasks':
        return wrap(section, (
          <AdminTasksSummary tasks={data?.adminTasks || []} openCount={s.adminTasksOpen ?? 0} onChange={load} />
        ), 'mb-4');
      case 'finances':
        return wrap(section, (
          <div className="card">
            <h2 className="font-heading text-base mb-3">Facturation</h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-neya-muted">Factures en attente</span>
                <span className="font-semibold text-neya-orange">{formatMoney(s.invoicesDue)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neya-muted">Devis en cours</span>
                <span className="font-semibold">{data?.pendingQuotes?.length ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-neya-border pt-3">
                <span className="text-neya-muted">Budget projets actifs</span>
                <span className="font-semibold">{formatMoney(s.budgetActive)}</span>
              </div>
            </div>
            <Link href="/invoices" className="btn-secondary text-xs w-full mt-4 text-center">Voir devis & factures</Link>
          </div>
        ), 'mb-4');
      case 'projects_deadlines':
        return wrap(section, (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading text-base sm:text-lg">Projets actifs</h2>
                <Link href="/projects" className="text-xs text-neya-orange hover:underline">Tous →</Link>
              </div>
              {data?.activeProjects?.length === 0 ? (
                <p className="text-sm text-neya-muted">Aucun projet actif</p>
              ) : (
                <ul className="space-y-2">
                  {data?.activeProjects?.map(p => (
                    <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-xl hover:bg-neya-cream/60 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-neya-muted">{p.client_name || 'Sans client'}</p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        {p.tasks_open > 0 && (
                          <span className="text-xs text-neya-orange font-medium">{p.tasks_done}/{p.tasks_done + p.tasks_open}</span>
                        )}
                        {p.deadline && <p className="text-[10px] text-neya-muted">{formatDate(p.deadline)}</p>}
                      </div>
                    </Link>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h2 className="font-heading text-base sm:text-lg mb-3">Deadlines proches</h2>
              {data?.urgentProjects?.length === 0 ? (
                <p className="text-sm text-neya-muted">Aucune deadline dans les 14 prochains jours</p>
              ) : (
                <ul className="space-y-2">
                  {data?.urgentProjects?.map(p => {
                    const overdue = p.deadline && new Date(p.deadline) < new Date(new Date().toDateString());
                    return (
                      <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-xl hover:bg-neya-cream/60">
                        <p className="text-sm font-medium truncate flex-1">{p.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                          {formatDate(p.deadline)}
                        </span>
                      </Link>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ));
      case 'invoices_web':
        return wrap(section, (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading text-base sm:text-lg">Factures à suivre</h2>
                <Link href="/invoices" className="text-xs text-neya-orange hover:underline">Toutes →</Link>
              </div>
              {data?.pendingInvoices?.length === 0 ? (
                <p className="text-sm text-neya-muted">Tout est à jour ✓</p>
              ) : (
                <ul className="space-y-2">
                  {data?.pendingInvoices?.map(inv => (
                    <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center justify-between py-2 border-b border-neya-border/50 last:border-0 hover:bg-neya-cream/40 -mx-2 px-2 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{inv.invoice_number}</p>
                        <p className="text-xs text-neya-muted">{inv.client_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatMoney(inv.total - inv.amount_paid)}</p>
                        <p className="text-[10px] text-neya-muted">{inv.due_date ? formatDate(inv.due_date) : inv.status}</p>
                      </div>
                    </Link>
                  ))}
                </ul>
              )}
            </div>
            {web && (
              <div className="card border-neya-orange/20 bg-gradient-to-br from-white to-neya-cream/40">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading text-base sm:text-lg">neyafurniture.ca</h2>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${web.configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                    {web.configured ? 'Connecté' : 'Non configuré'}
                  </span>
                </div>
                {web.configured ? (
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div><p className="text-lg font-heading text-neya-orange">{web.linked_products}</p><p className="text-[10px] text-neya-muted">Fiches</p></div>
                    <div><p className="text-lg font-heading">{web.web_orders_total}</p><p className="text-[10px] text-neya-muted">Commandes</p></div>
                    <div><p className="text-lg font-heading">{web.web_projects}</p><p className="text-[10px] text-neya-muted">Projets</p></div>
                  </div>
                ) : (
                  <p className="text-sm text-neya-muted mb-3">Connectez WooCommerce pour sync produits et commandes.</p>
                )}
                <Link href="/web" className="btn-primary text-sm w-full text-center">Hub site web</Link>
              </div>
            )}
          </div>
        ));
      default:
        return null;
    }
  }

  return (
    <AuthGuard>
      <AppShell title="Dashboard" wide>
        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>
        )}

        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl sm:text-2xl text-neya-ink">{greeting} 👋</h2>
            <p className="text-sm text-neya-muted capitalize mt-0.5">{todayLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editMode && (
              <button type="button" onClick={addTodoList} className="btn-secondary text-sm">
                + Todo
              </button>
            )}
            <button
              type="button"
              onClick={toggleEditMode}
              className={`text-sm px-3 py-2 rounded-xl border font-medium ${
                editMode
                  ? 'bg-neya-orange text-white border-neya-orange'
                  : 'bg-white border-neya-border text-neya-ink'
              }`}
            >
              {editMode ? '✓ Terminer édition' : '✎ Éditer UI'}
            </button>
          </div>
        </div>

        {editMode && (
          <div className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl">
            Mode édition : utilisez ↑ ↓ sur chaque section, ou dites à l&apos;IA « ajoute une todo atelier » / « monte la section stats ».
          </div>
        )}

        {sections.map(renderSection)}
      </AppShell>
    </AuthGuard>
  );
}
