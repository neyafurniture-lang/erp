'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import Drive3dPicker from '../../components/Drive3dPicker';
import DriveFilePreview from '../../components/DriveFilePreview';
import Viewer3D from '../../components/Viewer3D';
import { api, PURCHASE_NEED_STATUS } from '../../lib/api';

export default function AtelierZotiquePage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');
  const [notes, setNotes] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const res = await api('/atelier');
      setData(res);
      setNotes(res.notes || '');
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveConfig(patch) {
    setBusy(true);
    setErr('');
    try {
      await api('/atelier', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pick3d(file) {
    setPickerOpen(false);
    await saveConfig({ drive_file_id: file.id });
  }

  async function clear3d() {
    if (!confirm('Retirer le modèle 3D lié ?')) return;
    await saveConfig({ drive_file_id: '' });
  }

  async function saveNotes() {
    await saveConfig({ notes });
  }

  async function seedNeeds() {
    setBusy(true);
    setSeedMsg('');
    setErr('');
    try {
      const res = await api('/atelier/seed-needs', { method: 'POST' });
      setSeedMsg(`${res.created} ajouté(s), ${res.skipped} déjà présent(s)`);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleNeedStatus(item) {
    const next = item.status === 'needed' ? 'ordered' : item.status === 'ordered' ? 'received' : 'needed';
    try {
      await api(`/purchases/needs/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const needs = data?.needs || [];
  const neededCount = needs.filter((n) => n.status === 'needed').length;
  const hasModel = !!(data?.drive_file || data?.glb_url);

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-5xl">
          <header className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-neya-muted">Déménagement atelier</p>
            <h1 className="text-2xl font-semibold text-neya-ink">200 Zotique — 1er étage</h1>
            <p className="text-sm text-neya-muted">
              Assemblage 3D du futur atelier + liste d’achats pour le fit-out.
              {data?.project?.id && (
                <>
                  {' '}Projet{' '}
                  <Link href={`/projects/${data.project.id}`} className="text-neya-orange hover:underline">
                    {data.project.name}
                  </Link>
                </>
              )}
            </p>
          </header>

          {err && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{err}</p>
          )}

          <section className="card rounded-2xl space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-neya-ink">Modèle 3D</h2>
                <p className="text-xs text-neya-muted mt-0.5">
                  Choisissez uniquement le fichier 3D (GLB / GLTF / SketchUp) sur le Drive.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary text-sm min-h-[40px]"
                  disabled={busy}
                  onClick={() => setPickerOpen(true)}
                >
                  {hasModel ? 'Changer le 3D' : 'Sélectionner le 3D'}
                </button>
                {data?.drive_file_id && (
                  <button type="button" className="btn-ghost text-sm min-h-[40px]" disabled={busy} onClick={clear3d}>
                    Retirer
                  </button>
                )}
              </div>
            </div>

            {data?.drive_file && (
              <div className="space-y-2">
                <p className="text-xs text-neya-muted truncate">
                  Fichier : <span className="text-neya-ink font-medium">{data.drive_file.name}</span>
                </p>
                <div className="border border-neya-border rounded-xl overflow-hidden min-h-[320px]">
                  <DriveFilePreview file={data.drive_file} />
                </div>
              </div>
            )}

            {!data?.drive_file && data?.glb_url && (
              <Viewer3D url={data.glb_url} title="Atelier 200 Zotique" />
            )}

            {!hasModel && (
              <p className="text-sm text-neya-muted">
                Aucun modèle lié. Cliquez « Sélectionner le 3D », puis naviguez jusqu’à l’assemblage
                (ex. Production → Clients). Les autres types de fichiers sont masqués.
              </p>
            )}
          </section>

          <section className="card rounded-2xl space-y-3 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-neya-ink">Notes déménagement</h2>
            <textarea
              className="input w-full min-h-[88px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contraintes élec, accès monte-charge, dates…"
            />
            <button type="button" className="btn-secondary text-sm min-h-[40px]" disabled={busy} onClick={saveNotes}>
              Enregistrer les notes
            </button>
          </section>

          <section className="card rounded-2xl space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-neya-ink">Liste d’achats — fit-out</h2>
                <p className="text-xs text-neya-muted">
                  {neededCount} à acheter · {needs.length} au total
                  {' · '}
                  <Link href="/purchases" className="text-neya-orange hover:underline">Module achats</Link>
                </p>
              </div>
              <button type="button" className="btn-primary text-sm min-h-[40px]" disabled={busy} onClick={seedNeeds}>
                Générer la liste de départ
              </button>
            </div>
            {seedMsg && <p className="text-xs text-neya-muted">{seedMsg}</p>}

            {needs.length === 0 ? (
              <p className="text-sm text-neya-muted">
                Aucun besoin lié. Cliquez « Générer la liste de départ » (éclairage, élec, poussière, établis, rayonnage…).
              </p>
            ) : (
              <ul className="space-y-2">
                {needs.map((n) => {
                  const st = PURCHASE_NEED_STATUS[n.status] || PURCHASE_NEED_STATUS.needed;
                  return (
                    <li
                      key={n.id}
                      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                        n.priority === 'urgent' && n.status === 'needed'
                          ? 'border-red-200 bg-red-50/40'
                          : 'border-neya-border bg-neya-surface/30'
                      }`}
                    >
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      {n.priority === 'urgent' && n.status === 'needed' && (
                        <span className="text-[10px] font-semibold uppercase text-red-700">Urgent</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neya-ink">{n.title}</p>
                        <p className="text-[11px] text-neya-muted">
                          {n.quantity} {n.unit} · {n.category}
                          {n.notes ? ` · ${n.notes}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost text-xs min-h-[32px]"
                        onClick={() => toggleNeedStatus(n)}
                      >
                        Statut →
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <Drive3dPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={pick3d}
          title="Sélectionner le modèle 3D"
        />
      </AppShell>
    </AuthGuard>
  );
}
