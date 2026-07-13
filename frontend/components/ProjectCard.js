'use client';

import Link from 'next/link';
import { formatMoney, formatDate } from '../lib/api';

export default function ProjectCard({ project, large = false }) {
  const costs = project.costs;
  const progress = project.progress_pct ?? costs?.progress_pct ?? 0;
  const overdue = project.deadline && new Date(project.deadline) < new Date(new Date().toDateString());
  const margin = costs?.margin_pct;

  return (
    <Link
      href={`/projects/${project.id}`}
      className={`card block transition-colors hover:border-neya-ink/20 group ${large ? 'p-5' : ''}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <p className="section-title mb-1">{project.client_name || 'Atelier'}</p>
          <h3 className={`font-medium text-neya-ink truncate group-hover:text-neya-orange transition-colors ${large ? 'text-lg' : 'text-base'}`}>
            {project.name}
          </h3>
        </div>
        {project.priority > 0 && (
          <span className="badge border-neya-error/30 text-neya-error bg-red-50 shrink-0">Urgent</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <span className="badge border-neya-border text-neya-muted bg-neya-surface">
          {progress}% fait
        </span>
        {project.deadline && (
          <span className={`badge ${overdue ? 'border-neya-error/30 text-neya-error bg-red-50' : 'border-neya-border text-neya-muted bg-white'}`}>
            {formatDate(project.deadline)}
          </span>
        )}
        {margin != null && margin !== 0 && (
          <span className={`badge ${margin >= 20 ? 'border-green-200 text-green-800 bg-green-50' : 'border-amber-200 text-amber-900 bg-amber-50'}`}>
            Marge {margin}%
          </span>
        )}
      </div>

      <div className="h-1 bg-neya-surface rounded overflow-hidden mb-3">
        <div className="h-full bg-neya-orange transition-all" style={{ width: `${progress}%` }} />
      </div>

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

      {overdue && (
        <p className="text-xs text-neya-error mt-2 font-medium">⚠ Retard livraison</p>
      )}
    </Link>
  );
}
