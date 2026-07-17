'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../components/AppShell';
import AuthGuard from '../components/AuthGuard';
import { api, formatMoney, formatDate } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { AdminTasksSummary } from '../components/AdminTasksPanel';
import SupplierInvoiceQueue from '../components/SupplierInvoiceQueue';
import EditableSection from '../components/EditableSection';

const QUICK_ACTIONS = [
  { href: '/production', label: 'Production' },
  { href: '/sauna-cloud', label: 'Sauna Cloud' },
  { href: '/projects', label: 'Projets' },
  { href: '/invoices', label: 'Devis / factures' },
  { href: '/mail', label: 'Courriel' },
  { href: '/liste-courses', label: 'Liste de courses' },
  { href: '/clients', label: 'Clients' },
  { href: '/calendar', label: 'Calendrier' },
  { href: '/expenses', label: 'Dépenses' },
  { href: '/admin', label: 'Session admin' },
];

function Metric({ label, value, hint, href, tone }) {
  const body = (
    <div className={`dash-metric ${tone || ''}`}>
      <p className="dash-metric-label">{label}</p>
      <p className="dash-metric-value">{value}</p>
      {hint ? <p className="dash-metric-hint">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block hover:bg-neya-surface/80 transition-colors">{body}</Link> : body;
}

function SectionHead({ title, href, hrefLabel = 'Voir tout', aside }) {
  return (
    <div className="dash-section-head">
      <h2 className="dash-section-title">{title}</h2>
      <div className="flex items-center gap-3">
        {aside}
        {href && (
          <Link href={href} className="dash-link">
            {hrefLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

function AlertsBar({ alerts }) {
  if (!alerts?.length) return null;
  return (
    <div className="dash-alerts">
      {alerts.map((a, i) => (
        <Link
          key={i}
          href={a.href || '/'}
          className={`dash-alert dash-alert-${a.type || 'info'}`}
        >
          <span className="dash-alert-dot" aria-hidden />
          <span className="flex-1 min-w-0">{a.text}</span>
          <span className="dash-alert-arrow" aria-hidden>→</span>
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
    <div className="dash-block">
      <SectionHead
        title={title}
        aside={pending.length > 0 ? <span className="dash-count">{pending.length}</span> : null}
      />
      <form onSubmit={addTodo} className="flex gap-2 mb-2">
        <input
          className="input flex-1"
          placeholder="Ajouter une tâche…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
        />
        <button type="submit" disabled={adding || !newTitle.trim()} className="btn-secondary text-sm shrink-0 disabled:opacity-40">
          Ajouter
        </button>
      </form>
      <ul className="dash-list">
        {pending.length === 0 && done.length === 0 && (
          <li className="dash-empty">Rien pour l&apos;instant</li>
        )}
        {pending.map(todo => (
          <li key={todo.id} className="dash-row">
            <button
              type="button"
              onClick={() => toggleTodo(todo)}
              className="dash-check"
              aria-label="Cocher"
            />
            <span className="text-sm flex-1">{todo.title}</span>
          </li>
        ))}
        {done.map(todo => (
          <li key={todo.id} className="dash-row opacity-50">
            <button
              type="button"
              onClick={() => toggleTodo(todo)}
              className="dash-check dash-check-on"
              aria-label="Décocher"
            >✓</button>
            <span className="text-sm line-through flex-1">{todo.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskRow({ task, onToggle }) {
  const time = task.start_time
    ? new Date(task.start_time).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <li className="dash-row">
      {task.status !== 'done' && (
        <button
          type="button"
          onClick={() => onToggle(task)}
          className="dash-check"
          title="Marquer fait"
          aria-label="Marquer fait"
        />
      )}
      <Link href={task.project_id ? `/projects/${task.project_id}` : '/calendar'} className="flex-1 min-w-0">
        <p className="text-sm font-medium text-neya-ink truncate">{task.title}</p>
        <p className="text-xs text-neya-muted truncate">
          {time && `${time} · `}{task.project_name || 'Atelier'}
        </p>
      </Link>
      {task.status === 'doing' && <span className="dash-pill">En cours</span>}
    </li>
  );
}

function ProjectRow({ project }) {
  const overdue = project.deadline && new Date(project.deadline) < new Date(new Date().toDateString());
  const progress = project.progress_pct ?? project.costs?.progress_pct ?? 0;
  const open = (project.tasks_open ?? 0);
  const done = (project.tasks_done ?? 0);
  const total = open + done;

  return (
    <Link href={`/projects/${project.id}`} className="dash-project-row">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-neya-muted truncate mb-0.5">{project.client_name || 'Sans client'}</p>
        <p className="text-sm font-medium text-neya-ink truncate">{project.name}</p>
        <div className="dash-progress mt-2">
          <div className="dash-progress-bar" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      </div>
      <div className="text-right shrink-0 ml-4">
        {total > 0 && (
          <p className="text-xs text-neya-ink tabular-nums">{done}/{total}</p>
        )}
        {project.deadline && (
          <p className={`text-[11px] mt-0.5 ${overdue ? 'text-neya-error font-medium' : 'text-neya-muted'}`}>
            {formatDate(project.deadline)}
          </p>
        )}
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [layout, setLayout] = useState(null);
  const [sauna, setSauna] = useState(null);
  const [error, setError] = useState('');
  const firstName = (user?.name || '').split(/\s+/)[0] || '';

  const load = () => Promise.all([
    api('/dashboard'),
    api('/ui/dashboard-layout'),
    api('/sauna-cloud').catch(() => null),
  ]).then(([d, ui, sc]) => {
    setData(d);
    setLayout(ui.layout);
    setSauna(sc);
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
    return (
      <AuthGuard>
        <AppShell title="Accueil" wide>
          <div className="text-neya-muted py-16 text-center text-sm">Chargement…</div>
        </AppShell>
      </AuthGuard>
    );
  }

  const s = data?.stats || {};
  const web = data?.web;
  const sections = (layout?.sections || []).filter(sec => sec.visible !== false);
  const todayCount = data?.tasksToday?.length ?? 0;
  const dueHint = s.overdueProjects > 0
    ? `${s.overdueProjects} en retard`
    : `${s.dueSoonProjects ?? 0} sous 7 j`;

  function wrap(section, node) {
    return (
      <EditableSection
        key={section.id}
        section={section}
        editMode={editMode}
        className="dash-section"
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
      ));
    }

    switch (section.id) {
      case 'alerts':
        if (!data?.alerts?.length) return null;
        return wrap(section, <AlertsBar alerts={data.alerts} />);

      case 'supplier_invoices':
        return wrap(section, <SupplierInvoiceQueue compact />);

      case 'admin_tasks':
        return wrap(section, (
          <div className="dash-block">
            <AdminTasksSummary />
          </div>
        ));

      case 'sauna_cloud': {
        const prog = sauna?.progress || { done: 0, total: 0, pct: 0 };
        const nextFrames = (sauna?.frames || []).filter(f => f.status !== 'done').slice(0, 4);
        return wrap(section, (
          <div className="dash-block">
            <SectionHead title="Sauna Cloud — frames" href="/sauna-cloud" hrefLabel="Ouvrir →" />
            <div className="flex justify-between text-xs text-neya-muted mb-1">
              <span>Avancement</span>
              <span className="font-semibold text-neya-ink">{prog.done}/{prog.total} · {prog.pct}%</span>
            </div>
            <div className="h-2 bg-neya-cream rounded-full overflow-hidden mb-3">
              <div className="h-full bg-neya-orange transition-all" style={{ width: `${prog.pct}%` }} />
            </div>
            {nextFrames.length === 0 ? (
              <p className="text-sm text-neya-muted">Toutes les frames sont complétées.</p>
            ) : (
              <ul className="space-y-1.5 mb-3">
                {nextFrames.map(f => (
                  <li key={f.id} className="text-sm flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-neya-border shrink-0" />
                    <span className="truncate">{f.title}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/sauna-cloud" className="btn-secondary text-xs w-full text-center">
              Compléter les frames
            </Link>
          </div>
        ));
      }

      case 'projects_cards':
        return wrap(section, (
          <div className="dash-block">
            <SectionHead title="Projets en cours" href="/projects" />
            {!data?.projectCards?.length ? (
              <div className="dash-empty-block">
                <p className="text-sm text-neya-muted mb-3">Aucun projet actif</p>
                <Link href="/projects" className="btn-primary text-sm">Créer un projet</Link>
              </div>
            ) : (
              <div className="dash-projects">
                {(data.projectCards || []).slice(0, 8).map(p => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </div>
            )}
          </div>
        ));

      case 'quick_actions':
        return wrap(section, (
          <div className="dash-block">
            <SectionHead title="Raccourcis" />
            <div className="dash-shortcuts">
              {QUICK_ACTIONS.map(a => (
                <Link key={a.href} href={a.href} className="dash-shortcut">
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        ));

      case 'stats':
        return wrap(section, (
          <div className="dash-metrics">
            <Metric
              label="Projets actifs"
              value={s.activeProjects ?? 0}
              hint={dueHint}
              href="/projects"
              tone={s.overdueProjects > 0 ? 'dash-metric-warn' : ''}
            />
            <Metric
              label="À recevoir"
              value={formatMoney(s.invoicesDue)}
              hint={`${data?.pendingInvoices?.length ?? 0} facture(s)`}
              href="/invoices"
              tone="dash-metric-accent"
            />
            <Metric
              label="Dépenses du mois"
              value={formatMoney(s.expensesMonth)}
              hint="Ce mois-ci"
              href="/expenses"
            />
            <Metric
              label="Clients"
              value={s.clients ?? 0}
              hint={web?.configured ? `${web.web_orders_active ?? 0} cmd. web` : `${s.unscheduledTasks ?? 0} à planifier`}
              href="/clients"
            />
          </div>
        ));

      case 'today_week':
        return wrap(section, (
          <div className="dash-split">
            <div className="dash-block">
              <SectionHead
                title="Aujourd’hui"
                href="/calendar"
                hrefLabel="Calendrier"
                aside={todayCount > 0 ? <span className="dash-count">{todayCount}</span> : null}
              />
              {!data?.tasksToday?.length ? (
                <p className="dash-empty">Aucune tâche — planifiez dans le calendrier</p>
              ) : (
                <ul className="dash-list">
                  {data.tasksToday.map(t => (
                    <TaskRow key={t.id} task={t} onToggle={completeTask} />
                  ))}
                </ul>
              )}
            </div>
            <div className="dash-block">
              <SectionHead
                title="Cette semaine"
                aside={<span className="text-xs text-neya-muted">{data?.tasksWeek?.length ?? 0}</span>}
              />
              {!data?.tasksWeek?.length ? (
                <p className="dash-empty">Semaine libre pour l&apos;instant</p>
              ) : (
                <ul className="dash-list">
                  {data.tasksWeek.map(t => {
                    const d = new Date(t.start_time);
                    return (
                      <li key={t.id} className="dash-row">
                        <div className="dash-date-cell">
                          <span className="dash-date-day">{d.toLocaleDateString('fr-CA', { weekday: 'short' })}</span>
                          <span className="dash-date-num">{d.getDate()}</span>
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

      case 'finances':
        return wrap(section, (
          <div className="dash-block">
            <SectionHead title="Finances" href="/invoices" hrefLabel="Factures & devis" />
            <div className="dash-kv">
              <div className="dash-kv-row">
                <span>Factures en attente</span>
                <strong className="text-neya-orange tabular-nums">{formatMoney(s.invoicesDue)}</strong>
              </div>
              <div className="dash-kv-row">
                <span>Devis en cours</span>
                <strong className="tabular-nums">{data?.pendingQuotes?.length ?? 0}</strong>
              </div>
              <div className="dash-kv-row">
                <span>Dépenses (mois)</span>
                <strong className="tabular-nums">{formatMoney(s.expensesMonth)}</strong>
              </div>
              <div className="dash-kv-row dash-kv-row-last">
                <span>Budget projets actifs</span>
                <strong className="tabular-nums">{formatMoney(s.budgetActive)}</strong>
              </div>
            </div>
          </div>
        ));

      case 'projects_deadlines':
        return wrap(section, (
          <div className="dash-split">
            <div className="dash-block">
              <SectionHead title="Projets actifs" href="/projects" />
              {!data?.activeProjects?.length ? (
                <p className="dash-empty">Aucun projet actif</p>
              ) : (
                <ul className="dash-list">
                  {data.activeProjects.map(p => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="dash-row hover:bg-neya-surface -mx-1 px-1 rounded-sm">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-neya-muted">{p.client_name || 'Sans client'}</p>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          {p.tasks_open > 0 && (
                            <span className="text-xs tabular-nums text-neya-muted">{p.tasks_done}/{p.tasks_done + p.tasks_open}</span>
                          )}
                          {p.deadline && <p className="text-[10px] text-neya-muted">{formatDate(p.deadline)}</p>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="dash-block">
              <SectionHead title="Deadlines proches" />
              {!data?.urgentProjects?.length ? (
                <p className="dash-empty">Aucune deadline dans les 14 prochains jours</p>
              ) : (
                <ul className="dash-list">
                  {data.urgentProjects.map(p => {
                    const overdue = p.deadline && new Date(p.deadline) < new Date(new Date().toDateString());
                    return (
                      <li key={p.id}>
                        <Link href={`/projects/${p.id}`} className="dash-row hover:bg-neya-surface -mx-1 px-1 rounded-sm">
                          <p className="text-sm font-medium truncate flex-1">{p.name}</p>
                          <span className={`text-xs tabular-nums shrink-0 ml-2 ${overdue ? 'text-neya-error font-medium' : 'text-neya-muted'}`}>
                            {formatDate(p.deadline)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ));

      case 'invoices_web':
        return wrap(section, (
          <div className="dash-split">
            <div className="dash-block">
              <SectionHead title="Factures à suivre" href="/invoices" />
              {!data?.pendingInvoices?.length ? (
                <p className="dash-empty">Tout est à jour</p>
              ) : (
                <ul className="dash-list">
                  {data.pendingInvoices.map(inv => (
                    <li key={inv.id}>
                      <Link href={`/invoices/${inv.id}`} className="dash-row hover:bg-neya-surface -mx-1 px-1 rounded-sm">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{inv.invoice_number}</p>
                          <p className="text-xs text-neya-muted">{inv.client_name}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-medium tabular-nums">{formatMoney(inv.total - inv.amount_paid)}</p>
                          <p className="text-[10px] text-neya-muted">{inv.due_date ? formatDate(inv.due_date) : inv.status}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {web && (
              <div className="dash-block">
                <SectionHead
                  title="Site web"
                  href="/web"
                  hrefLabel="Hub"
                  aside={(
                    <span className={`text-[11px] ${web.configured ? 'text-neya-success' : 'text-neya-warning'}`}>
                      {web.configured ? 'Connecté' : 'Non configuré'}
                    </span>
                  )}
                />
                {web.configured ? (
                  <div className="dash-metrics dash-metrics-compact">
                    <Metric label="Fiches" value={web.linked_products} />
                    <Metric label="Commandes" value={web.web_orders_total} />
                    <Metric label="Projets" value={web.web_projects} />
                  </div>
                ) : (
                  <p className="dash-empty">Connectez WooCommerce pour sync produits et commandes.</p>
                )}
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
      <AppShell
        title={firstName ? `${greeting} ${firstName}` : greeting}
        subtitle={`Voici l'atelier · ${todayLabel}`}
        wide
      >
        {error && (
          <div className="mb-6 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>
        )}

        <header className="dash-hero lg:hidden">
          <div>
            <p className="dash-hero-kicker capitalize">{todayLabel}</p>
            <h1 className="dash-hero-title">
              {greeting}{' '}
              <span className="text-neya-orange">{firstName || 'atelier'}</span>
            </h1>
            <p className="dash-hero-sub">
              {s.activeProjects ?? 0} projets actifs
              {s.overdueProjects > 0 ? ` · ${s.overdueProjects} en retard` : ''}
              {todayCount > 0 ? ` · ${todayCount} tâches aujourd'hui` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleEditMode}
            className={`text-sm px-3 py-2 rounded-lg border font-medium transition-colors ${
              editMode
                ? 'bg-neya-ink text-white border-neya-ink'
                : 'bg-white border-neya-border text-neya-ink hover:bg-neya-surface'
            }`}
          >
            {editMode ? 'Terminer' : 'Réorganiser'}
          </button>
        </header>

        <div className="hidden lg:flex justify-end mb-4 gap-2">
          {editMode && (
            <button type="button" onClick={addTodoList} className="btn-secondary text-sm">
              + Liste todo
            </button>
          )}
          <button
            type="button"
            onClick={toggleEditMode}
            className={`text-sm px-3 py-2 rounded-lg border font-medium transition-colors ${
              editMode
                ? 'bg-neya-ink text-white border-neya-ink'
                : 'bg-white border-neya-border text-neya-ink hover:bg-neya-surface'
            }`}
          >
            {editMode ? 'Terminer' : 'Réorganiser'}
          </button>
        </div>

        {editMode && (
          <div className="dash-edit-banner mb-6 rounded-xl">
            Mode édition — utilisez ↑ ↓ pour déplacer les blocs. L’ordre est sauvegardé pour votre compte.
          </div>
        )}

        <div className="dash-stack space-y-6">
          {sections.map(renderSection)}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
