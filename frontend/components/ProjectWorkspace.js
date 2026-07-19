'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, formatMoney, formatDate, TASK_TYPES, resolveUploadUrl } from '../lib/api';
import { isCustomProject, checklistProgress } from '../lib/projects';
import { PRODUCTION_STAGES, computeProductionStage, resolveProject3dUrl } from '../lib/production';
import { parseMeta } from '../lib/standards';
import { productImageUrl } from '../lib/fiche-images';
import Viewer3D from './Viewer3D';
import ProjectPlansPanel from './ProjectPlansPanel';
import DriveExplorer from './DriveExplorer';
import GmailInbox from './GmailInbox';

const MODULES = [
  { id: 'overview', label: 'Vue d\'ensemble' },
  { id: 'tasks', label: 'Tâches' },
  { id: 'materials', label: 'Matériaux' },
  { id: 'costs', label: 'Coûts' },
  { id: 'purchases', label: 'Achats' },
  { id: 'plans', label: 'Plans' },
  { id: 'drive', label: 'Drive' },
  { id: 'mail', label: 'Courriel' },
  { id: 'hours', label: 'Heures' },
  { id: 'notes', label: 'Notes' },
];

function parseMetaObj(project) {
  return typeof project.meta === 'string' ? JSON.parse(project.meta || '{}') : (project.meta || {});
}

function parseHoursLogbook(project) {
  return parseMetaObj(project).hours_logbook || null;
}

function normalizeHoursPeople(log) {
  if (Array.isArray(log?.people) && log.people.length) return log.people.map(String);
  return ['Mehdi'];
}

function normalizeHoursRows(rows = [], people = ['Mehdi']) {
  return (rows || []).map(r => {
    const hours = { ...(r.hours || {}) };
    for (const p of people) {
      if (hours[p] === undefined) {
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

export default function ProjectWorkspace({ project, costs, materials, quoteSource, purchases, onReload }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab');
    return MODULES.some(m => m.id === t) ? t : 'overview';
  });
  const [matForm, setMatForm] = useState({ description: '', quantity: 1, unit_cost: 0 });
  const [taskForm, setTaskForm] = useState({ title: '', type: 'assemblage', estimated_minutes: 60 });
  const [taskBusy, setTaskBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [hoursBusy, setHoursBusy] = useState(false);
  const hoursLog = parseHoursLogbook(project);
  const [hoursPeople, setHoursPeople] = useState(() => normalizeHoursPeople(hoursLog));
  const [hoursRows, setHoursRows] = useState(() => normalizeHoursRows(hoursLog?.rows || [], normalizeHoursPeople(hoursLog)));
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(project.client_id ? String(project.client_id) : '');
  const [clientBusy, setClientBusy] = useState(false);
  const [clientMsg, setClientMsg] = useState('');
  const custom = isCustomProject(project);
  const meta = typeof project.meta === 'string' ? JSON.parse(project.meta || '{}') : (project.meta || {});
  const standardMeta = project.standard_meta || null;
  const model3dUrl = resolveProject3dUrl(meta, standardMeta);
  const planPages = Array.isArray(meta.plans) ? meta.plans : [];
  const stdMeta = standardMeta ? parseMeta(standardMeta) : {};
  const productImage = productImageUrl(stdMeta);
  const stage = computeProductionStage(project.tasks);
  const stageInfo = PRODUCTION_STAGES[stage] || PRODUCTION_STAGES.queued;
  const nextTasks = project.tasks?.filter(t => t.status !== 'done').slice(0, 4) || [];
  const { done, total, pct } = checklistProgress(project.tasks);

  useEffect(() => {
    api('/clients').then(setClients).catch(() => setClients([]));
  }, []);

  useEffect(() => {
    setClientId(project.client_id ? String(project.client_id) : '');
  }, [project.id, project.client_id]);

  useEffect(() => {
    const log = parseHoursLogbook(project);
    const people = normalizeHoursPeople(log);
    setHoursPeople(people);
    setHoursRows(normalizeHoursRows(log?.rows || [], people));
  }, [project.id, project.meta]);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && MODULES.some(m => m.id === t)) setTab(t);
    else if (!t) setTab('overview');
  }, [searchParams]);

  function changeTab(id) {
    if (id === tab) return;
    setTab(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'overview') params.delete('tab');
    else params.set('tab', id);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  async function saveClientLink(nextId) {
    setClientBusy(true);
    setClientMsg('');
    try {
      await api(`/projects/${project.id}/client`, {
        method: 'PATCH',
        body: JSON.stringify({ client_id: nextId === '' ? null : Number(nextId) }),
      });
      setClientMsg(nextId ? 'Client lié' : 'Client retiré');
      setTimeout(() => setClientMsg(''), 1500);
      onReload();
    } catch (err) {
      setClientMsg(err.message || 'Erreur liaison client');
      setClientId(project.client_id ? String(project.client_id) : '');
    } finally {
      setClientBusy(false);
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Link href="/" className="text-xs text-neya-muted hover:text-neya-orange">← Dashboard</Link>
        <span className="text-neya-border">|</span>
        <Link href="/production" className="text-xs text-neya-muted hover:text-neya-orange">Production</Link>
      </div>

      <header className="mb-8 border-b border-neya-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2 max-w-xl">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-neya-muted shrink-0">
                Client
              </label>
              <select
                className="input text-sm min-h-[36px] py-1.5 flex-1 min-w-[180px]"
                value={clientId}
                disabled={clientBusy}
                onChange={e => {
                  const v = e.target.value;
                  setClientId(v);
                  saveClientLink(v);
                }}
                aria-label="Lier un client au projet"
              >
                <option value="">— Sans client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ''}</option>
                ))}
              </select>
              {clients.length === 0 && (
                <Link href="/clients" className="text-xs text-neya-orange hover:underline shrink-0">
                  Créer un client →
                </Link>
              )}
              {clientMsg && (
                <span className={`text-xs ${/Erreur|invalide|introuvable/i.test(clientMsg) ? 'text-red-700' : 'text-green-700'}`}>
                  {clientBusy ? '…' : clientMsg}
                </span>
              )}
            </div>
            <h1 className={`text-2xl sm:text-3xl font-medium tracking-tight ${project.status === 'done' ? 'text-neya-muted line-through' : 'text-neya-ink'}`}>
              {project.name}
            </h1>
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
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="badge border-neya-border bg-neya-surface">{custom ? 'Sur mesure' : 'Catalogue'}</span>
          <span className={`badge ${project.status === 'done' ? 'border-green-200 text-green-800 bg-green-50' : 'border-neya-border bg-white'}`}>
            {project.status === 'done' ? 'Terminé' : 'En cours'}
          </span>
          {project.deadline && <span className="badge border-neya-border">{formatDate(project.deadline)}</span>}
          {costs && <span className="badge border-neya-orange/30 text-neya-orange">Marge {costs.margin_pct}%</span>}
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-neya-border mb-6 -mx-1 px-1 pb-px">
        {MODULES.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => changeTab(m.id)}
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
              {/* Priorité : PDF plans → visuel produit → 3D seulement s’il y a un modèle */}
              {planPages.length > 0 ? (
                <div className="card-flat p-0 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-neya-border">
                    <p className="text-sm font-semibold text-neya-ink">
                      Plans PDF <span className="text-neya-muted font-normal">({planPages.length})</span>
                    </p>
                    <button type="button" onClick={() => changeTab('plans')} className="text-xs text-neya-orange hover:underline">
                      Voir / importer →
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
                    {planPages.slice(0, 6).map(plan => {
                      const url = resolveUploadUrl(plan.url);
                      return (
                        <a
                          key={plan.id || plan.url}
                          href={url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-neya-border bg-neya-surface/50 overflow-hidden hover:border-neya-orange/40 transition-colors"
                        >
                          <div className="aspect-[4/3] bg-white">
                            {url ? (
                              <iframe
                                title={plan.name}
                                src={`${url}#toolbar=0&navpanes=0`}
                                className="w-full h-full pointer-events-none"
                              />
                            ) : (
                              <div className="w-full h-full grid place-items-center text-[11px] text-neya-muted">PDF</div>
                            )}
                          </div>
                          <p className="px-2 py-1.5 text-[11px] font-medium text-neya-ink truncate">{plan.name}</p>
                        </a>
                      );
                    })}
                  </div>
                </div>
              ) : productImage ? (
                <div className="card-flat p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-neya-ink">Visuel produit</p>
                    <button type="button" onClick={() => changeTab('plans')} className="text-xs text-neya-orange hover:underline">
                      Importer des plans PDF →
                    </button>
                  </div>
                  <div className="relative h-48 bg-neya-surface rounded border border-neya-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={productImage} alt="" className="w-full h-full object-contain p-2" />
                  </div>
                </div>
              ) : (
                <div className="card-flat py-8 px-4 text-center">
                  <p className="text-sm font-medium text-neya-ink">Aucun plan PDF pour l’instant</p>
                  <p className="text-xs text-neya-muted mt-1 mb-3">
                    Importez les shop drawings — la vue 3D n’apparaît que s’il y a un modèle GLB.
                  </p>
                  <button type="button" onClick={() => changeTab('plans')} className="btn-primary text-sm">
                    Importer un PDF
                  </button>
                </div>
              )}

              {model3dUrl && (
                <div className="card-flat p-0 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-neya-border">
                    <p className="text-sm font-semibold text-neya-ink">Modèle 3D</p>
                    <button type="button" onClick={() => changeTab('plans')} className="text-xs text-neya-orange hover:underline">
                      Plein écran →
                    </button>
                  </div>
                  <Viewer3D url={model3dUrl} title={project.name} compact />
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

              {hoursRows.some(r => hoursPeople.some(p => Number(r.hours?.[p]) > 0)) && (
                <button
                  type="button"
                  onClick={() => changeTab('hours')}
                  className="card-flat w-full text-left hover:border-neya-orange/40 transition-colors"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-neya-muted mb-2">Heures atelier</p>
                  <div className="flex flex-wrap gap-3">
                    {hoursPeople.map(p => (
                      <div key={p}>
                        <p className="text-[11px] text-neya-muted">{p}</p>
                        <p className="font-display text-lg font-semibold text-neya-ink tabular-nums">
                          {sumPersonHours(hoursRows, p).toFixed(2)} h
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-neya-orange mt-2">Ouvrir le carnet →</p>
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="card-flat py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Coût</p>
                  <p className="text-lg font-semibold text-neya-ink mt-0.5">{formatMoney(costs?.cost_total)}</p>
                </div>
                <div className="card-flat py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Marge</p>
                  <p className={`text-lg font-semibold mt-0.5 ${(costs?.margin ?? 0) >= 0 ? 'text-green-700' : 'text-neya-error'}`}>
                    {formatMoney(costs?.margin)}
                  </p>
                </div>
                <div className="card-flat py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Vente</p>
                  <p className="text-lg font-semibold text-neya-ink mt-0.5">{formatMoney(costs?.sale_price)}</p>
                </div>
                <div className="card-flat py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-neya-muted">Matériaux</p>
                  <p className="text-lg font-semibold text-neya-ink mt-0.5">{materials?.length || 0}</p>
                </div>
              </div>

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
              <p className="text-sm font-semibold text-neya-ink mb-3">Notes atelier</p>
              <p className="text-sm text-neya-ink/80 whitespace-pre-wrap line-clamp-6">
                {project.notes || 'Aucune note — ajoutez des instructions pour l\'atelier.'}
              </p>
              {purchases?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-neya-border">
                  <p className="text-xs font-medium uppercase tracking-wide text-neya-muted mb-2">Achats liés</p>
                  <ul className="space-y-1">
                    {purchases.slice(0, 3).map(p => (
                      <li key={p.id} className="text-sm text-neya-ink flex justify-between gap-2">
                        <span className="truncate">{p.title || `Commande #${p.id}`}</span>
                        <span className="text-xs text-neya-muted shrink-0">{p.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="space-y-4">
          <form onSubmit={addTask} className="card grid sm:grid-cols-4 gap-3">
            <input
              className="input sm:col-span-2"
              placeholder="Nouvelle étape…"
              value={taskForm.title}
              onChange={e => setTaskForm({ ...taskForm, title: e.target.value })}
              required
            />
            <select className="input" value={taskForm.type} onChange={e => setTaskForm({ ...taskForm, type: e.target.value })}>
              {TASK_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input
              type="number"
              min={15}
              step={15}
              className="input"
              placeholder="Minutes"
              value={taskForm.estimated_minutes}
              onChange={e => setTaskForm({ ...taskForm, estimated_minutes: e.target.value })}
            />
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
                    <button
                      type="button"
                      onClick={() => toggleTask(t)}
                      className={`w-5 h-5 border rounded shrink-0 ${t.status === 'done' ? 'bg-neya-orange border-neya-orange' : 'border-neya-border'}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${t.status === 'done' ? 'line-through text-neya-muted' : 'text-neya-ink'}`}>{t.title}</p>
                      <p className="text-xs text-neya-muted">
                        {TASK_TYPES.find(x => x.value === t.type)?.label || t.type}
                        {t.estimated_minutes ? ` · ${t.estimated_minutes} min` : ''}
                      </p>
                    </div>
                    <button type="button" onClick={() => deleteTask(t)} className="text-xs text-neya-error hover:underline shrink-0">
                      Suppr.
                    </button>
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
              <button type="button" onClick={syncMaterialsFromQuote} className="btn-secondary text-xs">
                Resynchroniser depuis le devis
              </button>
            </div>
          ) : (
            <div className="card-flat py-3 text-sm text-neya-muted">
              Aucun devis lié — liez un devis au projet ou au client pour importer les matériaux automatiquement.
            </div>
          )}

          <form onSubmit={addMaterial} className="card grid sm:grid-cols-4 gap-3">
            <input className="input sm:col-span-2" placeholder="Description" value={matForm.description} onChange={e => setMatForm({ ...matForm, description: e.target.value })} required />
            <input type="number" step="0.01" className="input" placeholder="Qté" value={matForm.quantity} onChange={e => setMatForm({ ...matForm, quantity: e.target.value })} />
            <input type="number" step="0.01" className="input" placeholder="Coût unit." value={matForm.unit_cost} onChange={e => setMatForm({ ...matForm, unit_cost: e.target.value })} />
            <button type="submit" className="btn-primary sm:col-span-4 w-fit">Ajouter matériau manuellement</button>
          </form>
          <div className="card">
            {materials?.length === 0 ? <p className="text-sm text-neya-muted">Aucun matériau — ils apparaîtront ici depuis le devis.</p> : (
              <ul className="divide-y divide-neya-border">
                {materials?.map(m => (
                  <li key={m.id} className="flex justify-between py-2 text-sm">
                    <span className="text-neya-ink">{m.description} × {m.quantity}</span>
                    <span className="font-medium">{formatMoney(m.quantity * m.unit_cost)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'costs' && costs && (
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

      {tab === 'plans' && (
        <div className="space-y-6">
          <ProjectPlansPanel project={project} onReload={onReload} />
          {model3dUrl ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-neya-ink">Modèle 3D</p>
              <Viewer3D url={model3dUrl} title={project.name} />
            </div>
          ) : null}
        </div>
      )}

      {tab === 'drive' && (
        <DriveExplorer projectId={project.id} initialFolderId={project.drive_folder_id || 'root'} />
      )}

      {tab === 'mail' && (
        <GmailInbox projectId={project.id} linkProjectId={project.id} />
      )}

      {tab === 'hours' && (
        <div className="card space-y-4 rounded-2xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-neya-ink">Comptage d’heures</h2>
              <p className="text-sm text-neya-muted">
                {hoursPeople.join(' · ')}
                {hoursLog?.source ? ` · source ${hoursLog.source}` : ''}
                {hoursLog?.updated_at ? ` · maj ${formatDate(hoursLog.updated_at)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={addHoursRow}>+ Ligne</button>
              <button type="button" className="btn-primary" disabled={hoursBusy} onClick={saveHoursLogbook}>
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
                  <tr className="font-semibold text-neya-ink">
                    <td className="pt-3" colSpan={2}>Total</td>
                    {hoursPeople.map(p => (
                      <td key={p} className="pt-3 tabular-nums">{sumPersonHours(hoursRows, p).toFixed(2)}</td>
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
        <div className="card">
          <p className="text-sm whitespace-pre-wrap">{project.notes || 'Aucune note'}</p>
        </div>
      )}
    </div>
  );
}
