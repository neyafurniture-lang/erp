'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import AppShell from '../../../../components/AppShell';
import AuthGuard from '../../../../components/AuthGuard';
import { api, getToken, getApiUrl } from '../../../../lib/api';

export default function QuoteBriefPage() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [photos, setPhotos] = useState([]);
  const [form, setForm] = useState({
    client_id: '',
    title: '',
    notes: '',
    wood: '',
    dimensions: '',
    finish: '',
    deadline: '',
    extra: '',
    create_project: true,
  });

  useEffect(() => {
    api('/clients').then(setClients).catch(() => setClients([]));
  }, []);

  useEffect(() => () => {
    photos.forEach(p => p.preview && URL.revokeObjectURL(p.preview));
  }, [photos]);

  function addPhotos(list) {
    const next = [...list].filter(f => /^image\//.test(f.type)).slice(0, 8);
    setPhotos(prev => [
      ...prev,
      ...next.map(file => ({ file, preview: URL.createObjectURL(file) })),
    ].slice(0, 8));
  }

  function removePhoto(i) {
    setPhotos(prev => {
      const copy = [...prev];
      const [gone] = copy.splice(i, 1);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return copy;
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!form.client_id) {
      setError('Sélectionnez un client');
      return;
    }
    if (!String(form.title || '').trim()) {
      setError('Indiquez un titre de projet');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('client_id', form.client_id);
      body.append('title', form.title.trim());
      body.append('notes', form.notes);
      body.append('wood', form.wood);
      body.append('dimensions', form.dimensions);
      body.append('finish', form.finish);
      body.append('deadline', form.deadline);
      body.append('extra', form.extra);
      body.append('create_project', form.create_project ? '1' : '0');
      photos.forEach(p => body.append('photos', p.file));

      const res = await fetch(`${getApiUrl()}/invoices/quotes/from-brief`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      const id = data.quote?.id;
      if (!id) throw new Error('Devis créé sans identifiant');
      router.push(`/invoices/quotes/${id}?lia=1`);
    } catch (err) {
      setError(err.message || 'Génération impossible');
      setBusy(false);
    }
  }

  return (
    <AuthGuard>
      <AppShell title="Nouveau devis — brief" wide>
        <Link href="/invoices" className="text-sm text-neya-muted hover:text-neya-ink mb-4 inline-block">
          ← Facturation
        </Link>

        <form onSubmit={submit} className="max-w-3xl space-y-5">
          <div className="card rounded-none space-y-4">
            <div>
              <h1 className="font-heading text-xl text-neya-ink">Brief projet → devis</h1>
              <p className="text-sm text-neya-muted mt-1">
                Remplissez les infos et photos. Lia génère le devis et les tâches atelier.
                Ensuite vous discutez avec elle pour corriger ce qui ne va pas.
              </p>
            </div>

            {error && (
              <p className="text-sm text-neya-error bg-red-50 border border-red-100 px-3 py-2">{error}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Client *</label>
                <select
                  className="input"
                  required
                  value={form.client_id}
                  onChange={e => setForm({ ...form, client_id: e.target.value })}
                >
                  <option value="">Sélectionner</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Titre du projet *</label>
                <input
                  className="input"
                  required
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="ex. Table salle à manger James"
                />
              </div>
              <div>
                <label className="label">Dimensions</label>
                <input
                  className="input"
                  value={form.dimensions}
                  onChange={e => setForm({ ...form, dimensions: e.target.value })}
                  placeholder="ex. 84 × 40 × 30 po"
                />
              </div>
              <div>
                <label className="label">Bois / matériaux</label>
                <input
                  className="input"
                  value={form.wood}
                  onChange={e => setForm({ ...form, wood: e.target.value })}
                  placeholder="ex. Chêne blanc, acier noir"
                />
              </div>
              <div>
                <label className="label">Finition</label>
                <input
                  className="input"
                  value={form.finish}
                  onChange={e => setForm({ ...form, finish: e.target.value })}
                  placeholder="ex. Osmo UV, vernis eau"
                />
              </div>
              <div>
                <label className="label">Échéance souhaitée</label>
                <input
                  type="date"
                  className="input"
                  value={form.deadline}
                  onChange={e => setForm({ ...form, deadline: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="label">Description / portée</label>
              <textarea
                className="input"
                rows={5}
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Ce que le client veut, contraintes, quincaillerie, livraison…"
              />
            </div>
            <div>
              <label className="label">Autres infos</label>
              <textarea
                className="input"
                rows={2}
                value={form.extra}
                onChange={e => setForm({ ...form, extra: e.target.value })}
                placeholder="Budget cible, exclusions, références…"
              />
            </div>

            <div>
              <label className="label">Photos</label>
              <div
                className="border border-dashed border-neya-border p-4 text-sm text-neya-muted"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.length) addPhotos(e.dataTransfer.files);
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="text-sm"
                  onChange={e => {
                    if (e.target.files?.length) addPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
                <p className="text-xs mt-1">Jusqu’à 8 photos (références, lieu, croquis).</p>
                {photos.length > 0 && (
                  <ul className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {photos.map((p, i) => (
                      <li key={i} className="relative">
                        <img src={p.preview} alt="" className="h-20 w-full object-cover border border-neya-border" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute top-0.5 right-0.5 bg-white/90 text-neya-error text-xs px-1"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-neya-ink">
              <input
                type="checkbox"
                checked={form.create_project}
                onChange={e => setForm({ ...form, create_project: e.target.checked })}
              />
              Créer aussi le projet + tâches atelier
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="btn-primary gap-1.5 min-h-[40px]">
              <Sparkles className="h-4 w-4" />
              {busy ? 'Lia prépare le devis…' : 'Générer le devis'}
            </button>
            <Link href="/invoices" className="btn-secondary min-h-[40px] flex items-center">Annuler</Link>
          </div>
        </form>
      </AppShell>
    </AuthGuard>
  );
}
