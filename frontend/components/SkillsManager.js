'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export const ACTION_TYPES = [
  'create_task', 'create_project', 'schedule_task', 'create_expense', 'list_today', 'create_client',
  'complete_task', 'update_task', 'delete_task', 'list_project_tasks',
  'update_project', 'update_client', 'list_projects', 'list_clients', 'list_expenses',
  'list_skills', 'create_skill', 'update_skill',
  'create_quote', 'create_invoice', 'convert_quote', 'send_quote', 'send_invoice',
  'list_quotes', 'list_invoices', 'delete_project', 'delete_client', 'delete_expense',
  'update_standard', 'sync_wordpress', 'sync_web_orders', 'list_web_orders', 'sync_web_photos',
  'ui_edit_mode', 'ui_add_todo_list', 'ui_move_section', 'ui_hide_section', 'ui_show_section', 'ui_reset_layout',
  'erp_manual', 'search_projects', 'search_memory', 'get_project',
  'list_emails', 'search_emails', 'get_email', 'list_mail_threads',
  'create_fabrication_plan',
];

export default function SkillsManager({ compact = false }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', action_type: 'create_task', triggers: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setSkills(await api('/assistant/skills'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(skill) {
    await api(`/assistant/skills/${skill.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...skill, enabled: !skill.enabled }),
    });
    load();
  }

  async function saveEdit() {
    const triggers = form.triggers.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    await api(`/assistant/skills/${editing}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        action_type: form.action_type,
        trigger_patterns: triggers,
      }),
    });
    setEditing(null);
    load();
  }

  async function createNew() {
    const triggers = form.triggers.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (!form.name.trim()) return;
    await api('/assistant/skills', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.trim().replace(/\s+/g, '_').toLowerCase(),
        description: form.description,
        action_type: form.action_type,
        trigger_patterns: triggers.length ? triggers : [form.name],
      }),
    });
    setForm({ name: '', description: '', action_type: 'create_task', triggers: '' });
    setMsg('Skill ajoutée');
    load();
  }

  async function remove(id) {
    if (!confirm('Supprimer cette skill ?')) return;
    await api(`/assistant/skills/${id}`, { method: 'DELETE' });
    load();
  }

  async function seedDefaults() {
    await api('/settings/seed-skills', { method: 'POST' });
    setMsg('Skills par défaut rechargées');
    load();
  }

  function startEdit(skill) {
    setEditing(skill.id);
    setForm({
      name: skill.name,
      description: skill.description || '',
      action_type: skill.action_type,
      triggers: (skill.trigger_patterns || []).join(', '),
    });
  }

  const textSize = compact ? 'text-xs' : 'text-sm';
  const inputCls = compact ? 'input text-xs py-1.5' : 'input text-sm py-2';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`${textSize} text-neya-muted`}>
          Chaque skill lie des mots-clés (déclencheurs) à une action ERP exécutée par le chat.
        </p>
        <button type="button" onClick={seedDefaults} className="btn-secondary text-xs">
          Recharger skills par défaut
        </button>
      </div>

      {msg && <p className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">{msg}</p>}
      {error && <p className="text-xs text-neya-error">{error}</p>}
      {loading && <p className={`${textSize} text-neya-muted`}>Chargement…</p>}

      {!loading && (
        <div className="grid gap-3">
          {skills.map(skill => (
            <div key={skill.id} className="card !p-4">
              {editing === skill.id ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Nom</label>
                    <input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Action</label>
                    <select className={inputCls} value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                      {ACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Description</label>
                    <input className={inputCls} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Déclencheurs (virgules)</label>
                    <input className={inputCls} value={form.triggers} onChange={e => setForm({ ...form, triggers: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2 flex gap-2">
                    <button type="button" onClick={saveEdit} className="btn-primary text-sm">Sauvegarder</button>
                    <button type="button" onClick={() => setEditing(null)} className="btn-secondary text-sm">Annuler</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-neya-ink">{skill.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-neya-cream text-neya-muted">{skill.action_type}</span>
                    </div>
                    {skill.description && <p className={`${textSize} text-neya-muted mt-1`}>{skill.description}</p>}
                    <p className={`${textSize} text-neya-muted mt-2`}>
                      {(skill.trigger_patterns || []).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggle(skill)}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        skill.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {skill.enabled ? 'Active' : 'Inactive'}
                    </button>
                    <button type="button" onClick={() => startEdit(skill)} className="text-sm text-neya-orange hover:underline">Modifier</button>
                    {!['create_task', 'list_today', 'list_skills'].includes(skill.name) && (
                      <button type="button" onClick={() => remove(skill.id)} className="text-sm text-neya-error hover:underline">Supprimer</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card !p-4 border-dashed border-neya-orange/30 bg-neya-cream/30">
        <h3 className="font-heading text-base mb-3">Nouvelle skill</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Nom unique</label>
            <input className={inputCls} placeholder="ex: rappel_deadline" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Type d&apos;action</label>
            <select className={inputCls} value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
              {ACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Déclencheurs</label>
            <input className={inputCls} placeholder="mot1, mot2, mot3" value={form.triggers} onChange={e => setForm({ ...form, triggers: e.target.value })} />
          </div>
        </div>
        <button type="button" onClick={createNew} className="btn-primary mt-3">Ajouter la skill</button>
      </div>
    </div>
  );
}
