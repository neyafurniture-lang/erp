'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import StandardFicheView from '../../../components/StandardFicheView';
import { api } from '../../../lib/api';
import { useRegisterChatContext } from '../../../lib/chat-context';

export default function StandardDetailPage() {
  const { id } = useParams();
  const [standard, setStandard] = useState(null);
  const [clients, setClients] = useState([]);
  const [createProject, setCreateProject] = useState(false);
  const [form, setForm] = useState({ name: '', client_id: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api(`/standards/${id}`)
      .then(setStandard)
      .catch(() => setError('Fiche introuvable'));
    api('/clients').then(setClients);
  }, [id]);

  useRegisterChatContext(standard ? {
    type: 'standard',
    id: standard.id,
    label: standard.name,
    meta: { sku: standard.sku, category: standard.category },
  } : null);

  async function createFromStandard() {
    try {
      await api(`/projects/from-standard/${id}`, {
        method: 'POST',
        body: JSON.stringify({ client_id: form.client_id || null, name: form.name || null }),
      });
      setCreateProject(false);
      alert('Projet créé avec toutes les étapes de fabrication !');
    } catch (err) {
      alert(err.message || 'Impossible de créer le projet');
    }
  }

  if (error) {
    return (
      <AuthGuard>
        <AppShell title="Fiche introuvable">
          <p className="text-neya-muted mb-4">{error}</p>
          <Link href="/standards" className="btn-secondary">Retour au catalogue</Link>
        </AppShell>
      </AuthGuard>
    );
  }

  if (!standard) {
    return (
      <AuthGuard>
        <AppShell title="Fiche produit">
          <p className="text-neya-muted">Chargement…</p>
        </AppShell>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <AppShell title="Fiche produit">
        <StandardFicheView
          standard={standard}
          onStandardChange={setStandard}
          onCreateProject={standard.product_type !== 'guide' ? () => setCreateProject(true) : undefined}
        />

        {createProject && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-96 border border-neya-border">
              <h3 className="font-heading text-lg mb-4">Créer projet depuis cette fiche</h3>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="label">Nom (optionnel)</label>
                  <input
                    className="input"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Auto-généré si vide"
                  />
                </div>
                <div>
                  <label className="label">Client</label>
                  <select
                    className="input"
                    value={form.client_id}
                    onChange={e => setForm({ ...form, client_id: e.target.value })}
                  >
                    <option value="">— Aucun —</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={createFromStandard} className="btn-primary">Créer</button>
                <button type="button" onClick={() => setCreateProject(false)} className="btn-secondary">Annuler</button>
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
