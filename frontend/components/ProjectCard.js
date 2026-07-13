'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, formatMoney, formatDate } from '../lib/api';

export default function ProjectCard({ project, large = false, onStatusChange }) {
  const [busy, setBusy] = useState(false);
  const costs = project.costs;
  const progress = project.progress_pct ?? costs?.progress_pct ?? 0;
  const overdue = project.deadline && new Date(project.deadline) < new Date(new Date().toDateString());
  const margin = costs?.margin_pct;
  const isDone = project.status === 'done';

  async function toggleDone(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api(`/projects/${project.id}/toggle-done`, { method: 'POST' });
      onStatusChange?.(updated);
    } catch (err) {
      window.alert(err.message || 'Impossible de mettre à jour le projet');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card relative transition-colors hover:border-neya-ink/20 group ${large ? 'p-5' : ''} ${isDone ? 'opacity-75' : ''}`}>
      <Link href={`/projects/${project.id}`} className="block">
        <div className="flex items-start justify-between gap-3 mb-3 pr-20">
          <div className="min-w-0 flex-1">
            <p className="section-title mb-1">{project.client_name || 'Atelier'}</p>
            <h3 className={`font-medium text-neya-ink truncate group-hover:text-neya-orange transition-colors ${large ? 'text-lg' : 'text-base'} ${isDone ? 'line-through text-neya-muted' : ''}`}>
              {project.name}
            </h3>
          </div>
          {project.priority > 0 && !isDone && (
            <span className="badge border-neya-error/30 text-neya-error bg-red-50 shrink-0">Urgent</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <span className="badge border-neya-border text-neya-muted bg-neya-surface">
            {isDone ? 'Terminé' : `${progress}% fait`}
          </span>
          {project.deadline && (
            <span className={`badge ${overdue && !isDone ? 'border-neya-error/30 text-neya-error bg-red-50' : 'border-neya-border text-neya-muted bg-white'}`}>
              {formatDate(project.deadline)}
            </span>
          )}
          {margin != null && margin !== 0 && (
            <span className={`badge ${margin >= 20 ? 'border-green-200 text-green-800 bg-green-50' : 'border-amber-200 text-amber-900 bg-amber-50'}`}>
              Marge {margin}%
            </span>
          )}
        </div>

        {!isDone && (
          <div className="h-1 bg-neya-surface rounded overflow-hidden mb-3">
            <div className="h-full bg-neya-orange transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="flex justify-between text-xs text-neya-muted">
          <span>
            {costs?.minutes_actual > 0
              ? `${Math.round(costs.minutes_actual / 60)}h / ${Math.round((costs.minutes_estimated || 0) / 60)}h`
              : `${project.tasks_done ?? 0}/${(project.tasks_done ?? 0) + (project.tasks_open ?? 0)} tâches`}
          </span>
          {costs?.cost_total > 0 && (
            <span>Coût {formatMoney(costs.cost_total)}</span>
          )}
        </div>

        {overdue && !isDone && (
          <p className="text-xs text-neya-error mt-2 font-medium">⚠ Retard livraison</p>
        )}
      </Link>

      <button
        type="button"
        onClick={toggleDone}
        disabled={busy}
        title={isDone ? 'Rouvrir le projet' : 'Marquer comme terminé'}
        className={`absolute top-3 right-3 z-10 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
          isDone
            ? 'bg-white border-neya-orange text-neya-orange hover:bg-neya-orange hover:text-white'
            : 'bg-neya-orange text-white border-neya-orange hover:bg-neya-ink'
        }`}
      >
        {busy ? '…' : isDone ? 'Rouvrir' : 'Terminer'}
      </button>
    </div>
  );
}
