'use client';

import { useEffect, useState } from 'react';
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
import InstallationBillingPanel from './InstallationBillingPanel';

const MODULES = [
  { id: 'overview', label: 'Vue d\'ensemble' },
  { id: 'installation', label: 'Installation' },
  { id: 'tasks', label: 'Tâches' },
  { id: 'materials', label: 'Matériaux' },
  { id: 'costs', label: 'Coûts' },
  { id: 'purchases', label: 'Achats' },
  { id: 'plans', label: 'Plans 3D' },
  { id: 'drive', label: 'Drive' },
  { id: 'mail', label: 'Courriel' },
  { id: 'notes', label: 'Notes' },
];

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
  const custom = isCustomProject(project);
  const meta = typeof project.meta === 'string' ? JSON.parse(project.meta || '{}') : (project.meta || {});
  const standardMeta = project.standard_meta || null;
  const model3dUrl = resolveProject3dUrl(meta, standardMeta);
  const stdMeta = standardMeta ? parseMeta(standardMeta) : {};
  const productImage = productImageUrl(stdMeta);
  const stage = computeProductionStage(project.tasks);
  const stageInfo = PRODUCTION_STAGES[stage] || PRODUCTION_STAGES.queued;
  const nextTasks = project.tasks?.filter(t => t.status !== 'done').slice(0, 4) || [];
  const { done, total, pct } = checklistProgress(project.tasks);

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
          <div className="min-w-0">
            <p className="section-title mb-1">{project.client_name || 'Sans client'}</p>
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
              <div className="card-flat p-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-neya-border">
                  <p className="text-sm font-semibold text-neya-ink">Plan 3D</p>
                  {model3dUrl && (
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
        <Viewer3D url={model3dUrl} title={project.name} />
      )}

      {tab === 'drive' && (
        <DriveExplorer projectId={project.id} initialFolderId={project.drive_folder_id || 'root'} />
      )}

      {tab === 'mail' && (
        <GmailInbox projectId={project.id} linkProjectId={project.id} />
      )}

      {tab === 'installation' && (
        <InstallationBillingPanel
          projectId={project.id}
          projectName={project.name}
          clientId={project.client_id}
          clientName={project.client_name}
          onReload={onReload}
        />
      )}

      {tab === 'notes' && (
        <div className="card">
          <p className="text-sm whitespace-pre-wrap">{project.notes || 'Aucune note'}</p>
        </div>
      )}
    </div>
  );
}
