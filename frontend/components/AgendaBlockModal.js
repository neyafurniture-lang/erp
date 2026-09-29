'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { slotPayload } from '../lib/agenda';

function hoursLabel(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return '';
  const h = Math.round((mins / 60) * 100) / 100;
  return `${h.toLocaleString('fr-CA', { maximumFractionDigits: 2 })} h`;
}

export default function AgendaBlockModal({
  block,
  initial,
  projects,
  employees,
  canManageAll,
  defaultEmployeeId,
  onClose,
  onSaved,
}) {
  const viewSeed = block
    ? {
      date: initial?.date || '',
      start: initial?.start || '09:00',
      end: initial?.end || '12:00',
      project_id: block.project_id ? String(block.project_id) : '',
      label: block.label || '',
      notes: block.notes || '',
      employee_id: block.employee_id ? String(block.employee_id) : (defaultEmployeeId ? String(defaultEmployeeId) : ''),
    }
    : {
      date: initial?.date || '',
      start: initial?.start || '09:00',
      end: initial?.end || '12:00',
      project_id: '',
      label: '',
      notes: '',
      employee_id: defaultEmployeeId ? String(defaultEmployeeId) : '',
    };

  const [form, setForm] = useState(viewSeed);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const lockProject = !!(block && block.kind === 'logbook' && block.preserve_hours);
  const preserveHours = !!(block && block.preserve_hours);

  useEffect(() => {
    setForm(viewSeed);
    setErr('');
    // Le formulaire se réinitialise quand on ouvre un autre bloc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.id, initial?.date, initial?.start]);

  useEffect(() => {
    if (block || !canManageAll || form.employee_id || !employees.length) return;
    setForm(f => (f.employee_id ? f : { ...f, employee_id: String(employees[0].id) }));
  }, [block, canManageAll, employees, form.employee_id]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const payload = slotPayload({
        id: block?.id,
        date: form.date,
        start: form.start,
        end: form.end,
        project_id: lockProject ? block.project_id : form.project_id,
        label: form.label,
        notes: form.notes,
        employee_id: canManageAll ? form.employee_id : undefined,
      });
      if (block?.id) {
        await api('/agenda/blocks', { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/agenda/blocks', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
      onClose();
    } catch (error) {
      setErr(error.message || 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  const duration = hoursLabel(form.start, form.end);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={save}
        className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl border border-neya-border max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-neya-border px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-heading text-lg">{block ? 'Modifier le bloc' : 'Bloc d’heures'}</h3>
            <p className="text-xs text-neya-muted mt-0.5">
              {block
                ? 'Le créneau met à jour le projet et Mes heures. Les autres lignes restent.'
                : 'Le bloc est ajouté au projet et à Mes heures, sans effacer l’existant.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-neya-muted text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{err}</div>}
          {block?.inferred && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
              Horaire estimé d’après la durée déjà enregistrée. Enregistrer fixe le créneau sans changer ces heures.
            </p>
          )}
          {preserveHours && (
            <p className="text-sm text-neya-ink bg-neya-surface px-3 py-2 rounded-lg">
              Heures du carnet conservées ({block.hours ?? 0} h). Seuls le jour et l’horaire sont ajustés.
            </p>
          )}

          {canManageAll && !block && (
            <div>
              <label className="label">Employé</label>
              <select
                className="input"
                value={form.employee_id}
                onChange={e => setForm({ ...form, employee_id: e.target.value })}
              >
                <option value="">— Profil lié au compte —</option>
                {employees.map(emp => (
                  <option key={emp.id} value={String(emp.id)}>{emp.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Projet</label>
            {lockProject ? (
              <p className="text-sm text-neya-ink">
                {block.project_name || 'Projet'}
                {block.project_id ? (
                  <>
                    {' · '}
                    <Link href={`/projects/${block.project_id}?tab=hours`} className="text-neya-orange hover:underline">
                      Ouvrir les heures
                    </Link>
                  </>
                ) : null}
              </p>
            ) : (
              <select
                className="input"
                value={form.project_id}
                onChange={e => setForm({ ...form, project_id: e.target.value })}
              >
                <option value="">— Mes heures seulement —</option>
                {projects.map(p => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="label">Jour</label>
            <input
              type="date"
              className="input"
              required
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Début</label>
              <input type="time" className="input" required value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
            </div>
            <div>
              <label className="label">Fin</label>
              <input type="time" className="input" required value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
            </div>
          </div>
          {duration && (
            <p className="text-sm text-neya-muted">Durée du créneau : <strong className="text-neya-ink">{duration}</strong></p>
          )}

          <div>
            <label className="label">Travaux</label>
            <input
              className="input"
              placeholder="ex. assemblage"
              value={form.label}
              onChange={e => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea
              className="input min-h-[72px]"
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-neya-border px-5 py-4 flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary flex-1 sm:flex-none">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary text-sm sm:ml-auto">Annuler</button>
        </div>
      </form>
    </div>
  );
}
