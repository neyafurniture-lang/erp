'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { api, TASK_TYPES } from '../lib/api';

const TASK_STATUS = [
  { value: 'todo', label: 'À faire' },
  { value: 'doing', label: 'En cours' },
  { value: 'done', label: 'Terminé' },
];

export function toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

export function fromDatetimeLocal(val) {
  if (!val) return null;
  return new Date(val).toISOString();
}

/**
 * Modal d'édition d'une tâche calendrier :
 * heures, projet lié, notes annexes, statut, etc.
 */
export default function CalendarTaskModal({
  taskId,
  initialData = null,
  projects: projectsProp = null,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(null);
  const [projects, setProjects] = useState(projectsProp || []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr('');
      try {
        const [task, projList] = await Promise.all([
          initialData?.id && String(initialData.id) === String(taskId) && initialData.title
            ? Promise.resolve(initialData)
            : api(`/tasks/${taskId}`),
          projectsProp
            ? Promise.resolve(projectsProp)
            : api('/projects').catch(() => []),
        ]);
        if (cancelled) return;
        setProjects(Array.isArray(projList) ? projList : []);
        setForm({
          ...task,
          start_time: toDatetimeLocal(task.start_time || task.start),
          end_time: toDatetimeLocal(task.end_time || task.end),
          project_id: task.project_id || '',
          description: task.description || '',
          estimated_minutes: task.estimated_minutes ?? '',
        });
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Impossible de charger la tâche');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (taskId) load();
    return () => { cancelled = true; };
  }, [taskId, initialData, projectsProp]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setErr('');
    try {
      await api(`/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          type: form.type || 'admin',
          status: form.status || 'todo',
          assigned_to: form.assigned_to || null,
          estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
          start_time: fromDatetimeLocal(form.start_time),
          end_time: fromDatetimeLocal(form.end_time),
          project_id: form.project_id ? Number(form.project_id) : null,
          sort_order: form.sort_order ?? 0,
        }),
      });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function unscheduleTask() {
    if (!confirm('Retirer cette tâche du calendrier ?')) return;
    setSaving(true);
    setErr('');
    try {
      await api(`/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          project_id: form.project_id ? Number(form.project_id) : null,
          estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
          start_time: null,
          end_time: null,
        }),
      });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Supprimer définitivement cette tâche ?')) return;
    setSaving(true);
    setErr('');
    try {
      await api(`/tasks/${taskId}`, { method: 'DELETE' });
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const projectOptions = projects.filter(p => p.status === 'active' || String(p.id) === String(form?.project_id));
  const projectId = form?.project_id ? Number(form.project_id) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl border border-neya-border max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neya-border px-5 py-4 flex items-center justify-between z-10">
          <h3 className="font-heading text-lg">Modifier la tâche</h3>
          <button type="button" onClick={onClose} className="text-neya-muted hover:text-neya-ink text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{err}</div>}
          {loading || !form ? (
            <p className="text-sm text-neya-muted">Chargement…</p>
          ) : (
            <>
              <div>
                <label className="label">Titre</label>
                <input
                  className="input"
                  value={form.title || ''}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="label mb-0">Projet lié</label>
                  {projectId ? (
                    <Link
                      href={`/projects/${projectId}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-neya-orange hover:underline"
                    >
                      Ouvrir le projet <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : null}
                </div>
                <select
                  className="input"
                  value={form.project_id || ''}
                  onChange={e => setForm({ ...form, project_id: e.target.value })}
                >
                  <option value="">— Aucun —</option>
                  {projectOptions.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.project_number ? `${p.project_number} — ` : ''}{p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Type</label>
                  <select className="input" value={form.type || 'admin'} onChange={e => setForm({ ...form, type: e.target.value })}>
                    {TASK_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Statut</label>
                  <select className="input" value={form.status || 'todo'} onChange={e => setForm({ ...form, status: e.target.value })}>
                    {TASK_STATUS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Début</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={form.start_time || ''}
                    onChange={e => setForm({ ...form, start_time: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Fin</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={form.end_time || ''}
                    onChange={e => setForm({ ...form, end_time: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">Durée estimée (min)</label>
                <input
                  type="number"
                  min={15}
                  step={15}
                  className="input"
                  value={form.estimated_minutes ?? ''}
                  onChange={e => setForm({ ...form, estimated_minutes: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Notes annexes</label>
                <textarea
                  className="input min-h-[88px]"
                  value={form.description || ''}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Détails, consignes, rappel…"
                />
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-neya-border px-5 py-4 flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saving || loading || !form} className="btn-primary flex-1 sm:flex-none">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" onClick={unscheduleTask} disabled={saving || loading || !form} className="btn-secondary text-sm">
            Retirer du calendrier
          </button>
          <button type="button" onClick={remove} disabled={saving || loading || !form} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
            Supprimer
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary text-sm sm:ml-auto">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
