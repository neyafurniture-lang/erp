'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import DriveFilePreview from '../../components/DriveFilePreview';
import Viewer3D from '../../components/Viewer3D';
import { api, PURCHASE_NEED_STATUS } from '../../lib/api';

function extractDriveFileId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s) && !s.includes('/')) return s;
  const m = s.match(/\/(?:file\/d|open\?id=|uc\?id=)([a-zA-Z0-9_-]+)/)
    || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : s;
}

export default function AtelierZotiquePage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');
  const [driveInput, setDriveInput] = useState('');
  const [glbInput, setGlbInput] = useState('');
  const [notes, setNotes] = useState('');
  const [found, setFound] = useState([]);
  const [findQ, setFindQ] = useState('');
  const [finding, setFinding] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const res = await api('/atelier');
      setData(res);
      setDriveInput(res.drive_file_id || '');
      setGlbInput(res.glb_url || '');
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

  async function linkDriveFile() {
    const id = extractDriveFileId(driveInput);
    await saveConfig({ drive_file_id: id || null, glb_url: glbInput.trim() || '' });
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

  async function find3d(q = findQ) {
    setFinding(true);
    setErr('');
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await api(`/atelier/find-3d${qs}`);
      setFound(res.files || []);
    } catch (e) {
      setErr(e.message);
      setFound([]);
    } finally {
      setFinding(false);
    }
  }

  async function selectFound(file) {
    setDriveInput(file.id);
    await saveConfig({ drive_file_id: file.id });
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
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-neya-ink">Modèle 3D</h2>
              <p className="text-xs text-neya-muted">
                GLB / GLTF = viewer ici · SketchUp (.skp) = ouvrir Drive ou exporter GLB
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs text-neya-muted">Fichier Drive (ID ou lien)</span>
                <input
                  className="input w-full"
                  value={driveInput}
                  onChange={(e) => setDriveInput(e.target.value)}
                  placeholder="ID Drive ou https://drive.google.com/file/d/…"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-neya-muted">URL GLB publique (optionnel)</span>
                <input
                  className="input w-full"
                  value={glbInput}
                  onChange={(e) => setGlbInput(e.target.value)}
                  placeholder="https://…/atelier.glb"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-sm min-h-[40px]" disabled={busy} onClick={linkDriveFile}>
                Enregistrer le modèle
              </button>
              <button type="button" className="btn-secondary text-sm min-h-[40px]" disabled={finding} onClick={() => find3d()}>
                {finding ? 'Recherche…' : 'Chercher sur Drive'}
              </button>
              <Link href="/drive" className="btn-ghost text-sm min-h-[40px] inline-flex items-center">
                Ouvrir Drive
              </Link>
            </div>

            <div className="flex flex-wrap gap-2 items-end">
              <label className="block space-y-1 flex-1 min-w-[160px]">
                <span className="text-xs text-neya-muted">Recherche ciblée</span>
                <input
                  className="input w-full"
                  value={findQ}
                  onChange={(e) => setFindQ(e.target.value)}
                  placeholder="zotique, assemblage, atelier…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') find3d(findQ);
                  }}
                />
              </label>
              <button type="button" className="btn-secondary text-sm min-h-[40px]" disabled={finding} onClick={() => find3d(findQ)}>
                OK
              </button>
            </div>

            {found.length > 0 && (
              <ul className="divide-y divide-neya-border border border-neya-border rounded-xl overflow-hidden">
                {found.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 bg-neya-surface/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neya-ink truncate">{f.name}</p>
                      <p className="text-[11px] text-neya-muted">
                        {f.kind === 'model3d' ? 'GLB/GLTF — viewer' : 'CAD — export GLB recommandé'}
                      </p>
                    </div>
                    <button type="button" className="btn-secondary text-xs min-h-[32px]" onClick={() => selectFound(f)}>
                      Utiliser
                    </button>
                    {f.webViewLink && (
                      <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs min-h-[32px]">
                        Drive
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {data?.drive_file && (
              <div className="border border-neya-border rounded-xl overflow-hidden min-h-[320px]">
                <DriveFilePreview file={data.drive_file} />
              </div>
            )}

            {!data?.drive_file && data?.glb_url && (
              <Viewer3D url={data.glb_url} title="Atelier 200 Zotique" />
            )}

            {!data?.drive_file && !data?.glb_url && (
              <p className="text-sm text-neya-muted">
                Pas encore de fichier lié. Sur le Drive : Production → Clients (ou dossier atelier),
                liez l’assemblage 3D ici. Si c’est un .skp, exportez aussi un .glb pour le voir dans le navigateur.
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
      </AppShell>
    </AuthGuard>
  );
}
