'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, formatMoney, formatDate, TASK_TYPES } from '../lib/api';
import { isCustomProject, checklistProgress } from '../lib/projects';
import { PRODUCTION_STAGES, computeProductionStage, resolveProject3dUrl } from '../lib/production';
import { parseMeta } from '../lib/standards';
import { productImageUrl } from '../lib/fiche-images';
import Viewer3D from './Viewer3D';
import DriveExplorer from './DriveExplorer';
import GmailInbox from './GmailInbox';

const ALL_MODULES = [
  { id: 'overview', label: 'Vue d\'ensemble', locked: true },
  { id: 'tasks', label: 'Tâches', locked: true },
  { id: 'materials', label: 'Matériaux' },
  { id: 'costs', label: 'Coûts', adminOnly: true },
  { id: 'purchases', label: 'Achats' },
  { id: 'quotes', label: 'Devis' },
  { id: 'plans', label: 'Plans 3D' },
  { id: 'drive', label: 'Drive' },
  { id: 'mail', label: 'Courriel' },
  { id: 'hours', label: 'Heures' },
  { id: 'notes', label: 'Notes atelier' },
];

const DEFAULT_ENABLED = ALL_MODULES.map(m => m.id);
const ADMIN_SESSION_KEY = 'neya_project_admin_ok';

function parseMetaObj(project) {
  return typeof project.meta === 'string' ? JSON.parse(project.meta || '{}') : (project.meta || {});
}

function parseHoursLogbook(project) {
  return parseMetaObj(project).hours_logbook || null;
}

function normalizeHoursPeople(log) {
  if (Array.isArray(log?.people) && log.people.length) return log.people.map(String);
  // Rétrocompat mono-personne
  return ['Mehdi'];
}

function normalizeHoursRows(rows = [], people = ['Mehdi']) {
  return (rows || []).map(r => {
    const hours = { ...(r.hours || {}) };
    for (const p of people) {
      if (hours[p] === undefined) {
        // ancienne ligne : actual_hours → première personne
        if (r.actual_hours !== undefined && r.actual_hours !== '' && p === people[0]) {
          hours[p] = r.actual_hours;
        } else {
          hours[p] = hours[p] ?? '';
        }
      }
    }
    return {
      dateKey: r.dateKey || '',
      label: r.label || '',
      planned_hours: r.planned_hours ?? '',
      start: r.start || '',
      end: r.end || '',
      notes: r.notes || '',
      hours,
    };
  });
}

function emptyHoursRow(people) {
  const hours = {};
  for (const p of people) hours[p] = '';
  return {
    dateKey: new Date().toISOString().slice(0, 10),
    label: '',
    planned_hours: '',
    start: '',
    end: '',
    notes: '',
    hours,
  };
}

function sumPersonHours(rows, person) {
  return rows.reduce((s, r) => {
    const v = r.hours?.[person];
    if (v === '' || v == null) return s;
    return s + Number(v);
  }, 0);
}

function enabledModulesFromMeta(meta) {
  const list = Array.isArray(meta.enabled_modules) ? meta.enabled_modules : null;
  if (!list?.length) return [...DEFAULT_ENABLED];
  const set = new Set(list);
  // Toujours garder overview + tasks
  set.add('overview');
  set.add('tasks');
  return ALL_MODULES.map(m => m.id).filter(id => set.has(id));
}

export default function ProjectWorkspace({ project, costs, materials, quoteSource, purchases, onReload }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const meta = parseMetaObj(project);
  const [enabledModules, setEnabledModules] = useState(() => enabledModulesFromMeta(meta));
  const [modulesOpen, setModulesOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editForm, setEditForm] = useState({
    name: project.name || '',
    deadline: project.deadline ? String(project.deadline).slice(0, 10) : '',
    notes: project.notes || '',
    budget_estimated: project.budget_estimated ?? '',
  });

  const visibleModules = useMemo(
    () => ALL_MODULES.filter(m => enabledModules.includes(m.id)),
    [enabledModules]
  );

  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab');
    return ALL_MODULES.some(m => m.id === t) ? t : 'overview';
  });
  const [matForm, setMatForm] = useState({ description: '', quantity: 1, unit_cost: 0 });
  const [taskForm, setTaskForm] = useState({ title: '', type: 'assemblage', estimated_minutes: 60 });
  const [taskBusy, setTaskBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [hoursBusy, setHoursBusy] = useState(false);
  const hoursLog = parseHoursLogbook(project);
  const [hoursPeople, setHoursPeople] = useState(() => normalizeHoursPeople(hoursLog));
  const [hoursRows, setHoursRows] = useState(() => normalizeHoursRows(hoursLog?.rows || [], normalizeHoursPeople(hoursLog)));

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [adminPinError, setAdminPinError] = useState('');
  const [adminPinBusy, setAdminPinBusy] = useState(false);
  const [adminNotes, setAdminNotes] = useState(meta.admin_notes || '');
  const [adminNotesBusy, setAdminNotesBusy] = useState(false);

  const custom = isCustomProject(project);
  const standardMeta = project.standard_meta || null;
  const model3dUrl = resolveProject3dUrl(meta, standardMeta);
  const stdMeta = standardMeta ? parseMeta(standardMeta) : {};
  const productImage = productImageUrl(stdMeta);
  const stage = computeProductionStage(project.tasks);
  const stageInfo = PRODUCTION_STAGES[stage] || PRODUCTION_STAGES.queued;
  const nextTasks = project.tasks?.filter(t => t.status !== 'done').slice(0, 4) || [];
  const { done, total, pct } = checklistProgress(project.tasks);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(ADMIN_SESSION_KEY) === '1') setAdminUnlocked(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setEnabledModules(enabledModulesFromMeta(parseMetaObj(project)));
    setAdminNotes(parseMetaObj(project).admin_notes || '');
    setEditForm({
      name: project.name || '',
      deadline: project.deadline ? String(project.deadline).slice(0, 10) : '',
      notes: project.notes || '',
      budget_estimated: project.budget_estimated ?? '',
    });
  }, [project.id, project.meta, project.name, project.deadline, project.notes, project.budget_estimated]);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && ALL_MODULES.some(m => m.id === t)) setTab(t);
    else if (!t) setTab('overview');
  }, [searchParams]);

  useEffect(() => {
    const log = parseHoursLogbook(project);
    const people = normalizeHoursPeople(log);
    setHoursPeople(people);
    setHoursRows(normalizeHoursRows(log?.rows || [], people));
  }, [project.id, project.meta]);

  useEffect(() => {
    if (!enabledModules.includes(tab)) changeTab('overview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledModules]);

  function changeTab(id) {
    if (id === tab) return;
    setTab(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'overview') params.delete('tab');
    else params.set('tab', id);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  async function saveProjectPatch(patch) {
    await api(`/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    onReload();
  }

  async function saveEdit(e) {
    e?.preventDefault?.();
    setEditBusy(true);
    try {
      await saveProjectPatch({
        name: editForm.name.trim() || project.name,
        deadline: editForm.deadline || null,
        notes: editForm.notes,
        budget_estimated: editForm.budget_estimated === '' ? project.budget_estimated : Number(editForm.budget_estimated),
      });
      setEditing(false);
    } catch (err) {
      window.alert(err.message || 'Enregistrement impossible');
    } finally {
      setEditBusy(false);
    }
  }

  async function toggleModule(id) {
    const mod = ALL_MODULES.find(m => m.id === id);
    if (mod?.locked) return;
    const next = enabledModules.includes(id)
      ? enabledModules.filter(x => x !== id)
      : [...enabledModules, id];
    // garder au moins overview + tasks
    const safe = ALL_MODULES.map(m => m.id).filter(x => next.includes(x) || ALL_MODULES.find(m => m.id === x)?.locked);
    setEnabledModules(safe);
    try {
      await saveProjectPatch({ meta: { enabled_modules: safe } });
    } catch (err) {
      window.alert(err.message || 'Impossible de sauver les modules');
      setEnabledModules(enabledModulesFromMeta(parseMetaObj(project)));
    }
  }

  async function verifyAdminPin(e) {
    e?.preventDefault?.();
    setAdminPinBusy(true);
    setAdminPinError('');
    try {
      await api('/projects/verify-admin-pin', {
        method: 'POST',
        body: JSON.stringify({ pin: adminPin }),
      });
      setAdminUnlocked(true);
      setAdminPin('');
      try { sessionStorage.setItem(ADMIN_SESSION_KEY, '1'); } catch { /* ignore */ }
    } catch (err) {
      setAdminPinError(err.message || 'Code incorrect');
    } finally {
      setAdminPinBusy(false);
    }
  }

  function lockAdmin() {
    setAdminUnlocked(false);
    try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch { /* ignore */ }
  }

  async function saveAdminNotes() {
    setAdminNotesBusy(true);
    try {
      await saveProjectPatch({ meta: { admin_notes: adminNotes } });
    } catch (err) {
      window.alert(err.message || 'Impossible d’enregistrer');
    } finally {
      setAdminNotesBusy(false);
    }
  }

  async function addMaterial(e) {
    e.preventDefault();
    await api(`/analytics/projects/${project.id}/materials`, {
      method: 'POST',
      body: JSON.stringify(matForm),
    });
    setMatForm({ description: '', quantity: 1, unit_cost: 0 });
    onReload();
  }

  async function toggleTask(task) {
    await api(`/tasks/${task.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...task, status: task.status === 'done' ? 'todo' : 'done' }),
    });
    onReload();
  }

  async function addTask(e) {
    e.preventDefault();
    if (!taskForm.title.trim()) return;
    setTaskBusy(true);
    try {
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          project_id: project.id,
          title: taskForm.title.trim(),
          type: taskForm.type,
          status: 'todo',
          estimated_minutes: Number(taskForm.estimated_minutes) || 60,
        }),
      });
      setTaskForm({ title: '', type: 'assemblage', estimated_minutes: 60 });
      onReload();
    } finally {
      setTaskBusy(false);
    }
  }

  async function deleteTask(task) {
    if (!confirm(`Supprimer l'étape « ${task.title} » ?`)) return;
    await api(`/tasks/${task.id}`, { method: 'DELETE' });
    onReload();
  }

  async function toggleProjectDone() {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      await api(`/projects/${project.id}/toggle-done`, { method: 'POST' });
      onReload();
    } catch (err) {
      window.alert(err.message || 'Impossible de mettre à jour le projet');
    } finally {
      setStatusBusy(false);
    }
  }

  function updateHourRow(idx, field, value) {
    setHoursRows(rows => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  function updatePersonHours(idx, person, value) {
    setHoursRows(rows => rows.map((r, i) => {
      if (i !== idx) return r;
      return { ...r, hours: { ...r.hours, [person]: value } };
    }));
  }

  function addHoursRow() {
    setHoursRows(rows => [...rows, emptyHoursRow(hoursPeople)]);
  }

  function removeHoursRow(idx) {
    setHoursRows(rows => rows.filter((_, i) => i !== idx));
  }

  async function saveHoursLogbook(e) {
    e?.preventDefault?.();
    setHoursBusy(true);
    try {
      const totals = {};
      for (const p of hoursPeople) totals[p] = sumPersonHours(hoursRows, p);
      await api(`/projects/${project.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          hours_logbook: {
            ...(hoursLog || {}),
            source: hoursLog?.source || 'manuel',
            people: hoursPeople,
            rows: hoursRows,
            totals,
            updated_at: new Date().toISOString(),
          },
          meta: {
            enabled_modules: enabledModules.includes('hours')
              ? enabledModules
              : [...enabledModules, 'hours'],
          },
        }),
      });
      onReload();
    } catch (err) {
      window.alert(err.message || 'Impossible d’enregistrer le carnet');
    } finally {
      setHoursBusy(false);
    }
  }

  async function syncMaterialsFromQuote() {
    await api(`/analytics/projects/${project.id}/materials/sync-quote`, { method: 'POST' });
    onReload();
  }

  const money = (v) => (adminUnlocked ? formatMoney(v) : '••••');

  const adminRail = (
    <aside className={`project-admin-rail ${adminOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="project-admin-rail__tab"
        onClick={() => setAdminOpen(o => !o)}
      >
        Notes admin
      </button>

      <div className="project-admin-rail__panel">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-white">Notes admin</p>
          {adminUnlocked ? (
            <button type="button" onClick={lockAdmin} className="text-[11px] text-white/80 hover:text-white underline">
              Verrouiller
            </button>
          ) : null}
        </div>

        {!adminUnlocked ? (
          <form onSubmit={verifyAdminPin} className="space-y-3">
            <p className="text-xs text-white/90 leading-relaxed">
              Code requis pour afficher les prix, budgets et notes internes.
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className="input !bg-white !text-neya-ink w-full"
              placeholder="Code"
              value={adminPin}
              onChange={e => setAdminPin(e.target.value)}
            />
            {adminPinError ? <p className="text-xs text-white font-medium">{adminPinError}</p> : null}
            <button type="submit" disabled={adminPinBusy || !adminPin} className="btn bg-white text-neya-orange border-0 w-full hover:bg-neya-cream">
              {adminPinBusy ? '…' : 'Déverrouiller'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 text-sm text-white">
              <div className="flex justify-between gap-2"><span className="text-white/80">Budget estimé</span><span className="font-semibold">{formatMoney(project.budget_estimated)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-white/80">Coût total</span><span className="font-semibold">{formatMoney(costs?.cost_total)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-white/80">Prix vente</span><span className="font-semibold">{formatMoney(costs?.sale_price)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-white/80">Marge</span><span className="font-semibold">{formatMoney(costs?.margin)} ({costs?.margin_pct ?? '—'}%)</span></div>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wide text-white/80 mb-1 block">Notes internes</label>
              <textarea
                className="input !bg-white/95 !text-neya-ink w-full min-h-[120px] text-sm"
                value={adminNotes}
                onChange={e => setAdminNotes(e.target.value)}
                placeholder="Marges, accords, alertes…"
              />
              <button
                type="button"
                onClick={saveAdminNotes}
                disabled={adminNotesBusy}
                className="mt-2 btn bg-white text-neya-orange border-0 text-xs w-full hover:bg-neya-cream"
              >
                {adminNotesBusy ? '…' : 'Enregistrer notes'}
              </button>
            </div>

            {enabledModules.includes('costs') && (
              <button type="button" onClick={() => { changeTab('costs'); setAdminOpen(false); }} className="text-xs text-white underline">
                Ouvrir l’onglet Coûts →
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="project-workspace relative">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Link href="/" className="text-xs text-neya-muted hover:text-neya-orange">← Dashboard</Link>
        <span className="text-neya-border">|</span>
        <Link href="/production" className="text-xs text-neya-muted hover:text-neya-orange">Production</Link>
      </div>

      <div className="project-workspace__main">
        <header className="mb-6 border-b border-neya-border pb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="section-title mb-1">{project.client_name || 'Sans client'}</p>
              {editing ? (
                <form onSubmit={saveEdit} className="space-y-3 max-w-xl">
                  <input
                    className="input text-xl font-medium"
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    required
                  />
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs text-neya-muted block">
                      Deadline
                      <input
                        type="date"
                        className="input mt-1"
                        value={editForm.deadline}
                        onChange={e => setEditForm(f => ({ ...f, deadline: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-neya-muted block">
                      Budget estimé {adminUnlocked ? '' : '(admin)'}
                      <input
                        type="number"
                        step="0.01"
                        className="input mt-1"
                        disabled={!adminUnlocked}
                        value={editForm.budget_estimated}
                        onChange={e => setEditForm(f => ({ ...f, budget_estimated: e.target.value }))}
                      />
                    </label>
                  </div>
                  <label className="text-xs text-neya-muted block">
                    Notes atelier
                    <textarea
                      className="input mt-1 min-h-[90px]"
                      value={editForm.notes}
                      onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={editBusy} className="btn-primary">{editBusy ? '…' : 'Enregistrer'}</button>
                    <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Annuler</button>
                  </div>
                </form>
              ) : (
                <>
                  <h1 className={`text-2xl sm:text-3xl font-medium tracking-tight ${project.status === 'done' ? 'text-neya-muted line-through' : 'text-neya-ink'}`}>
                    {project.name}
                  </h1>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" onClick={() => setEditing(true)} className="btn-secondary text-xs">
                      Modifier le projet
                    </button>
                    <button type="button" onClick={() => setModulesOpen(o => !o)} className="btn-secondary text-xs">
                      Modules actifs
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={toggleProjectDone}
              disabled={statusBusy}
              className={`shrink-0 text-sm font-semibold px-4 py-2 rounded-xl border transition-colors disabled:opacity-50 ${
                project.status === 'done'
                  ? 'bg-white border-neya-orange text-neya-orange hover:bg-neya-orange hover:text-white'
                  : 'bg-neya-orange text-white border-neya-orange hover:bg-neya-ink'
              }`}
            >
              {statusBusy ? '…' : project.status === 'done' ? 'Rouvrir le projet' : 'Terminer le projet'}
            </button>
          </div>

          {!editing && (
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="badge border-neya-border bg-neya-surface">{custom ? 'Sur mesure' : 'Catalogue'}</span>
              <span className={`badge ${project.status === 'done' ? 'border-green-200 text-green-800 bg-green-50' : 'border-neya-border bg-white'}`}>
                {project.status === 'done' ? 'Terminé' : 'En cours'}
              </span>
              {project.deadline && <span className="badge border-neya-border">{formatDate(project.deadline)}</span>}
              {adminUnlocked && costs && (
                <span className="badge border-neya-orange/30 text-neya-orange">Marge {costs.margin_pct}%</span>
              )}
            </div>
          )}

          {modulesOpen && (
            <div className="mt-4 card-flat">
              <p className="text-sm font-semibold text-neya-ink mb-1">Éléments actifs du projet</p>
              <p className="text-xs text-neya-muted mb-3">Cochez pour afficher / décochez pour masquer (Achats, Coûts, Devis, etc.).</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {ALL_MODULES.map(m => (
                  <label key={m.id} className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded border border-neya-border ${m.locked ? 'opacity-70' : ''}`}>
                    <input
                      type="checkbox"
                      checked={enabledModules.includes(m.id)}
                      disabled={m.locked}
                      onChange={() => toggleModule(m.id)}
                    />
                    <span>{m.label}{m.adminOnly ? ' (admin)' : ''}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-neya-border mb-6 -mx-1 px-1 pb-px">
          {visibleModules.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                if (m.adminOnly && !adminUnlocked) {
                  setAdminOpen(true);
                  return;
                }
                changeTab(m.id);
              }}
              className={`shrink-0 px-3 py-2 text-sm border-b-2 transition-colors ${
                tab === m.id ? 'border-neya-orange text-neya-ink font-semibold' : 'border-transparent text-neya-muted font-medium hover:text-neya-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="grid lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 space-y-4">
                <div className="card-flat p-0 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-neya-border">
                    <p className="text-sm font-semibold text-neya-ink">Plan 3D</p>
                    {model3dUrl && enabledModules.includes('plans') && (
                      <button type="button" onClick={() => changeTab('plans')} className="text-xs text-neya-orange hover:underline">
                        Plein écran →
                      </button>
                    )}
                  </div>
                  <Viewer3D url={model3dUrl} title={project.name} compact />
                </div>
                {!model3dUrl && productImage && (
                  <div className="card-flat p-4">
                    <p className="text-sm font-semibold text-neya-ink mb-3">Visuel produit</p>
                    <div className="relative h-40 bg-neya-surface rounded border border-neya-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={productImage} alt="" className="w-full h-full object-contain p-2" />
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-2 space-y-4">
                <div className="card-flat">
                  <p className="text-xs font-medium uppercase tracking-wide text-neya-muted mb-2">Étape atelier</p>
                  <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border ${stageInfo.color}`}>
                    {stageInfo.label}
                  </span>
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-neya-muted mb-1">
                      <span>Avancement</span>
                      <span className="font-semibold text-neya-ink">{pct}%</span>
                    </div>
                    <div className="h-2 bg-neya-cream rounded-full overflow-hidden">
                      <div className="h-full bg-neya-orange transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-neya-muted mt-1">{done}/{total} étapes complétées</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="card-flat py-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Coût</p>
                    <p className="text-lg font-semibold text-neya-ink mt-0.5">{money(costs?.cost_total)}</p>
                  </div>
                  <div className="card-flat py-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Marge</p>
                    <p className={`text-lg font-semibold mt-0.5 ${adminUnlocked && (costs?.margin ?? 0) >= 0 ? 'text-green-700' : 'text-neya-ink'}`}>
                      {money(costs?.margin)}
                    </p>
                  </div>
                  <div className="card-flat py-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Vente</p>
                    <p className="text-lg font-semibold text-neya-ink mt-0.5">{money(costs?.sale_price)}</p>
                  </div>
                  <div className="card-flat py-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Matériaux</p>
                    <p className="text-lg font-semibold text-neya-ink mt-0.5">{materials?.length || 0}</p>
                  </div>
                </div>
                {!adminUnlocked && (
                  <button type="button" onClick={() => setAdminOpen(true)} className="text-xs text-neya-orange hover:underline">
                    Déverrouiller les prix (Notes admin) →
                  </button>
                )}

                {project.deadline && (
                  <div className="card-flat py-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Deadline</p>
                    <p className={`text-sm font-semibold mt-0.5 ${new Date(project.deadline) < new Date() ? 'text-neya-error' : 'text-neya-ink'}`}>
                      {formatDate(project.deadline)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="card-flat">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-neya-ink">Prochaines étapes</p>
                  <button type="button" onClick={() => changeTab('tasks')} className="text-xs text-neya-orange hover:underline">
                    Toutes →
                  </button>
                </div>
                {nextTasks.length === 0 ? (
                  <p className="text-sm text-neya-muted">Toutes les étapes sont complétées.</p>
                ) : (
                  <ul className="divide-y divide-neya-border">
                    {nextTasks.map(t => (
                      <li key={t.id} className="flex items-center gap-3 py-2.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === 'doing' ? 'bg-neya-orange' : 'bg-neya-border'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-neya-ink truncate">{t.title}</p>
                          <p className="text-xs text-neya-muted">{TASK_TYPES.find(x => x.value === t.type)?.label || t.type}</p>
                        </div>
                        <button type="button" onClick={() => toggleTask(t)} className="text-xs text-neya-orange shrink-0 hover:underline">
                          Fait
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="card-flat">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-neya-ink">Notes atelier</p>
                  <button type="button" onClick={() => setEditing(true)} className="text-xs text-neya-orange hover:underline">
                    Modifier
                  </button>
                </div>
                <p className="text-sm text-neya-ink/80 whitespace-pre-wrap line-clamp-6">
                  {project.notes || 'Aucune note — ajoutez des instructions pour l\'atelier.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {tab === 'tasks' && (
          <div className="space-y-4">
            <form onSubmit={addTask} className="card grid sm:grid-cols-4 gap-3">
              <input className="input sm:col-span-2" placeholder="Nouvelle étape…" value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} required />
              <select className="input" value={taskForm.type} onChange={e => setTaskForm({ ...taskForm, type: e.target.value })}>
                {TASK_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input type="number" min={15} step={15} className="input" placeholder="Minutes" value={taskForm.estimated_minutes} onChange={e => setTaskForm({ ...taskForm, estimated_minutes: e.target.value })} />
              <button type="submit" disabled={taskBusy} className="btn-primary sm:col-span-4 w-fit">
                {taskBusy ? 'Ajout…' : '+ Ajouter une étape'}
              </button>
            </form>
            <div className="card">
              {!project.tasks?.length ? (
                <p className="text-sm text-neya-muted">Aucune étape — ajoutez la première ci-dessus.</p>
              ) : (
                <ul className="divide-y divide-neya-border">
                  {project.tasks.map(t => (
                    <li key={t.id} className="flex items-center gap-3 py-3">
                      <button type="button" onClick={() => toggleTask(t)} className={`w-5 h-5 border rounded shrink-0 ${t.status === 'done' ? 'bg-neya-orange border-neya-orange' : 'border-neya-border'}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${t.status === 'done' ? 'line-through text-neya-muted' : 'text-neya-ink'}`}>{t.title}</p>
                        <p className="text-xs text-neya-muted">
                          {TASK_TYPES.find(x => x.value === t.type)?.label || t.type}
                          {t.estimated_minutes ? ` · ${t.estimated_minutes} min` : ''}
                        </p>
                      </div>
                      <button type="button" onClick={() => deleteTask(t)} className="text-xs text-neya-error hover:underline shrink-0">Suppr.</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'materials' && (
          <div className="space-y-4">
            {quoteSource ? (
              <div className="card-flat flex flex-wrap items-center justify-between gap-2 py-3">
                <p className="text-sm text-neya-ink">
                  Source : devis <span className="font-semibold">{quoteSource.quote_number}</span>
                  {quoteSource.title ? ` — ${quoteSource.title}` : ''}
                </p>
                <button type="button" onClick={syncMaterialsFromQuote} className="btn-secondary text-xs">Resynchroniser depuis le devis</button>
              </div>
            ) : (
              <div className="card-flat py-3 text-sm text-neya-muted">Aucun devis lié — liez un devis au projet ou au client.</div>
            )}
            <form onSubmit={addMaterial} className="card grid sm:grid-cols-4 gap-3">
              <input className="input sm:col-span-2" placeholder="Description" value={matForm.description} onChange={e => setMatForm({ ...matForm, description: e.target.value })} required />
              <input type="number" step="0.01" className="input" placeholder="Qté" value={matForm.quantity} onChange={e => setMatForm({ ...matForm, quantity: e.target.value })} />
              <input type="number" step="0.01" className="input" placeholder="Coût unit." value={matForm.unit_cost} onChange={e => setMatForm({ ...matForm, unit_cost: e.target.value })} disabled={!adminUnlocked} />
              <button type="submit" className="btn-primary sm:col-span-4 w-fit">Ajouter matériau manuellement</button>
            </form>
            <div className="card">
              {materials?.length === 0 ? <p className="text-sm text-neya-muted">Aucun matériau.</p> : (
                <ul className="divide-y divide-neya-border">
                  {materials?.map(m => (
                    <li key={m.id} className="flex justify-between py-2 text-sm">
                      <span className="text-neya-ink">{m.description} × {m.quantity}</span>
                      <span className="font-medium">{adminUnlocked ? formatMoney(m.quantity * m.unit_cost) : '••••'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'costs' && (
          !adminUnlocked ? (
            <div className="card max-w-md space-y-3">
              <p className="text-sm text-neya-muted">Coûts protégés — déverrouillez via Notes admin.</p>
              <button type="button" className="btn-primary" onClick={() => setAdminOpen(true)}>Entrer le code</button>
            </div>
          ) : costs ? (
            <div className="card max-w-md space-y-3 text-sm">
              {[
                ['Matériaux', costs.materials],
                ['Dépenses', costs.expenses],
                ['Main-d\'œuvre', costs.labor],
                ['Total coût', costs.cost_total],
                ['Prix vente', costs.sale_price],
                ['Marge', costs.margin],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between border-b border-neya-border/50 pb-2">
                  <span className="text-neya-muted">{label}</span>
                  <span className="font-medium">{formatMoney(val)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neya-muted">Pas de données de coûts.</p>
          )
        )}

        {tab === 'purchases' && (
          <div className="card">
            {purchases?.length === 0 ? (
              <p className="text-sm text-neya-muted">Aucun achat lié — <Link href="/purchases" className="text-neya-orange">Module achats</Link></p>
            ) : (
              <ul className="divide-y divide-neya-border">
                {purchases?.map(p => (
                  <li key={p.id} className="py-2 flex justify-between text-sm">
                    <span>{p.title || `Commande #${p.id}`}</span>
                    <span className="badge border-neya-border">{p.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'quotes' && (
          <div className="card space-y-3">
            {quoteSource ? (
              <>
                <p className="text-sm text-neya-ink">
                  Devis lié : <span className="font-semibold">{quoteSource.quote_number}</span>
                  {quoteSource.title ? ` — ${quoteSource.title}` : ''}
                </p>
                {quoteSource.id && (
                  <Link href={`/quotes/${quoteSource.id}`} className="text-sm text-neya-orange hover:underline">
                    Ouvrir le devis →
                  </Link>
                )}
              </>
            ) : (
              <p className="text-sm text-neya-muted">
                Aucun devis lié. <Link href="/quotes" className="text-neya-orange">Voir les devis</Link>
              </p>
            )}
            {project.invoices?.length > 0 && (
              <div className="pt-3 border-t border-neya-border">
                <p className="text-xs uppercase text-neya-muted mb-2">Factures</p>
                <ul className="space-y-1">
                  {project.invoices.map(inv => (
                    <li key={inv.id}>
                      <Link href={`/invoices/${inv.id}`} className="text-sm text-neya-orange hover:underline">
                        {inv.invoice_number || `Facture #${inv.id}`}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'plans' && <Viewer3D url={model3dUrl} title={project.name} />}
        {tab === 'drive' && <DriveExplorer projectId={project.id} initialFolderId={project.drive_folder_id || 'root'} />}
        {tab === 'mail' && <GmailInbox projectId={project.id} linkProjectId={project.id} />}

        {tab === 'hours' && (
          <div className="card space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-neya-ink">Comptage d’heures</h2>
                <p className="text-sm text-neya-muted">
                  {hoursPeople.join(' · ')}
                  {hoursLog?.source ? ` · source ${hoursLog.source}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={addHoursRow}>+ Ligne</button>
                <button type="button" className="btn btn-primary" disabled={hoursBusy} onClick={saveHoursLogbook}>
                  {hoursBusy ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>

            {!hoursRows.length ? (
              <p className="text-sm text-neya-muted">
                Aucune ligne — cliquez sur « + Ligne » pour commencer le comptage.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-neya-muted border-b border-neya-border">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Travaux</th>
                      {hoursPeople.map(p => (
                        <th key={p} className="py-2 pr-3 font-medium">{p} (h)</th>
                      ))}
                      <th className="py-2 pr-3 font-medium">Notes</th>
                      <th className="py-2 font-medium w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {hoursRows.map((row, idx) => (
                      <tr key={`${row.dateKey}-${idx}`} className="border-b border-neya-border/60 align-top">
                        <td className="py-2 pr-3">
                          <input
                            type="date"
                            className="input !py-1 !px-2 w-[9.5rem]"
                            value={row.dateKey || ''}
                            onChange={e => updateHourRow(idx, 'dateKey', e.target.value)}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            className="input !py-1 !px-2 min-w-[9rem]"
                            placeholder="ex. assemblage"
                            value={row.label || ''}
                            onChange={e => updateHourRow(idx, 'label', e.target.value)}
                          />
                        </td>
                        {hoursPeople.map(p => (
                          <td key={p} className="py-2 pr-3">
                            <input
                              className="input !py-1 !px-2 w-20"
                              type="number"
                              min="0"
                              step="0.25"
                              value={row.hours?.[p] ?? ''}
                              onChange={e => updatePersonHours(idx, p, e.target.value)}
                            />
                          </td>
                        ))}
                        <td className="py-2 pr-3">
                          <input
                            className="input !py-1 !px-2 w-full min-w-[8rem]"
                            value={row.notes || ''}
                            onChange={e => updateHourRow(idx, 'notes', e.target.value)}
                          />
                        </td>
                        <td className="py-2">
                          <button type="button" className="text-xs text-neya-error hover:underline" onClick={() => removeHoursRow(idx)}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium text-neya-ink">
                      <td className="pt-3" colSpan={2}>Total</td>
                      {hoursPeople.map(p => (
                        <td key={p} className="pt-3">{sumPersonHours(hoursRows, p).toFixed(1)}</td>
                      ))}
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'notes' && (
          <div className="card space-y-3">
            <textarea
              className="input w-full min-h-[200px]"
              value={editForm.notes}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Notes atelier…"
            />
            <button
              type="button"
              className="btn-primary"
              disabled={editBusy}
              onClick={async () => {
                setEditBusy(true);
                try {
                  await saveProjectPatch({ notes: editForm.notes });
                } catch (err) {
                  window.alert(err.message || 'Erreur');
                } finally {
                  setEditBusy(false);
                }
              }}
            >
              {editBusy ? '…' : 'Enregistrer les notes'}
            </button>
          </div>
        )}
      </div>

      {adminRail}

      {/* Onglet orange mobile */}
      <button
        type="button"
        className="project-admin-fab lg:hidden"
        onClick={() => setAdminOpen(true)}
      >
        Admin
      </button>
    </div>
  );
}
