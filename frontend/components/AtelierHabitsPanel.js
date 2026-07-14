'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function AtelierHabitsPanel() {
  const [content, setContent] = useState('');
  const [path, setPath] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [newRule, setNewRule] = useState('');
  const [section, setSection] = useState('Devis & prix');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api('/habits');
      setContent(data.content || '');
      setPath(data.path || '');
      setUpdatedAt(data.updated_at || '');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const data = await api('/habits', {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
      setContent(data.content || content);
      setPath(data.path || path);
      setUpdatedAt(data.updated_at || '');
      setMsg('Habitudes enregistrées — Lia et Cursor les liront.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function appendQuick() {
    const rule = newRule.trim();
    if (!rule) return;
    setSaving(true);
    setError('');
    setMsg('');
    try {
      await api('/habits/append', {
        method: 'POST',
        body: JSON.stringify({ rule, section }),
      });
      setNewRule('');
      setMsg('Règle ajoutée.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-neya-muted">Chargement des habitudes…</p>;
  }

  return (
    <div className="space-y-4">
      <section className="card">
        <h2 className="font-heading text-lg mb-1">Habitudes atelier</h2>
        <p className="text-sm text-neya-muted mb-3">
          Règles métier pour Lia, les devis et Cursor (ex. jamais de prix à l’heure). Fichier&nbsp;:{' '}
          <code className="text-xs">{path || 'ATELIER_HABITS.md'}</code>
          {updatedAt && (
            <span className="text-neya-muted"> · {new Date(updatedAt).toLocaleString('fr-CA')}</span>
          )}
        </p>

        <div className="flex flex-wrap gap-2 mb-3">
          <select className="input text-sm max-w-[200px]" value={section} onChange={(e) => setSection(e.target.value)}>
            <option>Devis & prix</option>
            <option>Courriels & ton</option>
            <option>Interface ERP</option>
            <option>Production & atelier</option>
            <option>Général</option>
          </select>
          <input
            className="input text-sm flex-1 min-w-[200px]"
            placeholder="Nouvelle règle… ex. On signe les mails « L’équipe Neya »"
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') appendQuick();
            }}
          />
          <button type="button" className="btn-secondary text-sm" disabled={saving || !newRule.trim()} onClick={appendQuick}>
            Ajouter
          </button>
        </div>

        <textarea
          className="input font-mono text-xs min-h-[320px] leading-relaxed"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button type="button" className="btn-primary text-sm" disabled={saving} onClick={save}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" className="btn-ghost text-sm" onClick={load}>
            Recharger
          </button>
          {msg && <span className="text-xs text-green-800">{msg}</span>}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      </section>
    </div>
  );
}
