'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../components/AppShell';
import AuthGuard from '../../components/AuthGuard';
import { api } from '../../lib/api';

function FrameRow({ frame, onToggle, onNotes, onRename, onDelete }) {
  const [notes, setNotes] = useState(frame.description || '');
  const [title, setTitle] = useState(frame.title || '');
  const [editingTitle, setEditingTitle] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(frame.description));
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);
  const done = frame.status === 'done';

  useEffect(() => {
    setNotes(frame.description || '');
    setTitle(frame.title || '');
  }, [frame.id, frame.description, frame.title]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function scheduleNotes(value) {
    setNotes(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await onNotes(frame.id, value);
      } finally {
        setSaving(false);
      }
    }, 500);
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next || next === frame.title) {
      setTitle(frame.title);
      setEditingTitle(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(frame.id, next);
      setEditingTitle(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`card rounded-2xl space-y-2 shadow-sm hover:shadow-md transition-shadow ${done ? 'bg-neya-surface/40 border-green-200' : ''}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggle(frame)}
          className={`mt-0.5 w-9 h-9 shrink-0 rounded-lg border-2 flex items-center justify-center transition-colors ${
            done
              ? 'bg-green-600 border-green-600 text-white'
              : 'border-neya-border bg-white hover:border-neya-orange'
          }`}
          aria-label={done ? 'Marquer à faire' : 'Marquer complété'}
        >
          {done ? '✓' : ''}
        </button>

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              className="input text-sm font-medium"
              value={title}
              autoFocus
              onChange={e => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') { setTitle(frame.title); setEditingTitle(false); }
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className={`text-left text-sm font-medium w-full ${done ? 'text-neya-muted line-through' : 'text-neya-ink'}`}
              title="Cliquer pour renommer"
            >
              {frame.title}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${done ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
              {done ? 'Complété' : 'À faire'}
            </span>
            <button
              type="button"
              onClick={() => setNotesOpen(v => !v)}
              className="text-[11px] text-neya-muted hover:text-neya-ink"
            >
              {notesOpen ? 'Masquer notes' : (notes ? 'Voir notes' : '+ Note')}
            </button>
            {saving && <span className="text-[10px] text-neya-muted">…</span>}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onDelete(frame)}
          className="btn-secondary text-xs py-1.5 px-2 text-red-600 border-red-200 shrink-0"
          title="Supprimer la frame"
        >
          ✕
        </button>
      </div>

      {notesOpen && (
        <textarea
          className="input text-sm min-h-[72px] resize-y"
          placeholder="Notes sur cette frame (matériaux, mesures, problèmes…)"
          value={notes}
          onChange={e => scheduleNotes(e.target.value)}
        />
      )}
    </div>
  );
}

export default function SaunaCloudPage() {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [projectNotes, setProjectNotes] = useState('');
  const [newFrame, setNewFrame] = useState('');
  const [busy, setBusy] = useState(false);
  const notesTimer = useRef(null);

  async function load() {
    try {
      const data = await api('/sauna-cloud');
      setBoard(data);
      setProjectNotes(data.project?.notes || '');
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    return () => { if (notesTimer.current) clearTimeout(notesTimer.current); };
  }, []);

  function scheduleProjectNotes(value) {
    setProjectNotes(value);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      try {
        const res = await api('/sauna-cloud/notes', {
          method: 'PATCH',
          body: JSON.stringify({ notes: value }),
        });
        setBoard(res.board);
      } catch (e) {
        setError(e.message);
      }
    }, 600);
  }

  async function toggleFrame(frame) {
    const next = frame.status === 'done' ? 'todo' : 'done';
    try {
      const res = await api(`/sauna-cloud/frames/${frame.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      setBoard(res.board);
    } catch (e) {
      setError(e.message || 'Mise à jour impossible');
    }
  }

  async function saveFrameNotes(id, notes) {
    try {
      const res = await api(`/sauna-cloud/frames/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      });
      setBoard(res.board);
    } catch (e) {
      setError(e.message || 'Notes non enregistrées');
    }
  }

  async function renameFrame(id, title) {
    try {
      const res = await api(`/sauna-cloud/frames/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
      setBoard(res.board);
    } catch (e) {
      setError(e.message || 'Renommage impossible');
    }
  }

  async function deleteFrame(frame) {
    if (!confirm(`Supprimer « ${frame.title} » ?`)) return;
    try {
      const res = await api(`/sauna-cloud/frames/${frame.id}`, { method: 'DELETE' });
      setBoard(res.board);
    } catch (e) {
      setError(e.message || 'Suppression impossible');
    }
  }

  async function addFrame(e) {
    e.preventDefault();
    if (!newFrame.trim()) return;
    setBusy(true);
    try {
      const res = await api('/sauna-cloud/frames', {
        method: 'POST',
        body: JSON.stringify({ title: newFrame.trim() }),
      });
      setBoard(res.board);
      setNewFrame('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!board && !error) {
    return (
      <AuthGuard>
        <AppShell title="Sauna Cloud" subtitle="Frames à fabriquer — suivi de progression">
          <p className="text-neya-muted py-12">Chargement…</p>
        </AppShell>
      </AuthGuard>
    );
  }

  const prog = board?.progress || { done: 0, total: 0, pct: 0 };
  const todo = (board?.frames || []).filter(f => f.status !== 'done');
  const done = (board?.frames || []).filter(f => f.status === 'done');

  return (
    <AuthGuard>
      <AppShell title="Sauna Cloud" subtitle="Frames à fabriquer — suivi de progression" wide>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <p className="text-sm text-neya-muted">
              Liste des frames à fabriquer — cochez pour faire avancer le projet.
            </p>
            {board?.project?.id && (
              <Link href={`/projects/${board.project.id}`} className="text-xs text-neya-orange hover:underline">
                Voir le projet ERP →
              </Link>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-display font-semibold text-neya-orange tabular-nums">{prog.pct}%</p>
            <p className="text-xs text-neya-muted">{prog.done} / {prog.total} frames</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">
            {error}
          </div>
        )}

        <div className="h-2.5 bg-neya-surface rounded-full overflow-hidden mb-8">
          <div className="h-full bg-neya-orange transition-all" style={{ width: `${prog.pct}%` }} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display font-semibold text-lg">À faire ({todo.length})</h2>
              </div>
              <form onSubmit={addFrame} className="flex gap-2 mb-4">
                <input
                  className="input flex-1"
                  placeholder="Ajouter une frame… ex. Frame mur latéral gauche"
                  value={newFrame}
                  onChange={e => setNewFrame(e.target.value)}
                />
                <button type="submit" disabled={busy || !newFrame.trim()} className="btn-primary shrink-0 disabled:opacity-40">
                  + Ajouter
                </button>
              </form>
              <div className="space-y-2">
                {todo.length === 0 ? (
                  <p className="text-sm text-neya-muted card rounded-2xl py-8 text-center">
                    Aucune frame restante — projet à jour.
                  </p>
                ) : (
                  todo.map(f => (
                    <FrameRow
                      key={f.id}
                      frame={f}
                      onToggle={toggleFrame}
                      onNotes={saveFrameNotes}
                      onRename={renameFrame}
                      onDelete={deleteFrame}
                    />
                  ))
                )}
              </div>
            </section>

            {done.length > 0 && (
              <section>
                <h2 className="font-display font-semibold text-lg mb-3">Complétées ({done.length})</h2>
                <div className="space-y-2">
                  {done.map(f => (
                    <FrameRow
                      key={f.id}
                      frame={f}
                      onToggle={toggleFrame}
                      onNotes={saveFrameNotes}
                      onRename={renameFrame}
                      onDelete={deleteFrame}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-4">
            <div className="card rounded-2xl">
              <h2 className="font-display font-semibold text-base mb-2">Notes projet</h2>
              <p className="text-xs text-neya-muted mb-2">
                Notes générales Sauna Cloud (sauvegarde auto).
              </p>
              <textarea
                className="input text-sm min-h-[180px] resize-y"
                placeholder="Mesures, client, délais, problèmes atelier…"
                value={projectNotes}
                onChange={e => scheduleProjectNotes(e.target.value)}
              />
            </div>
            <div className="rounded-2xl border border-neya-border bg-neya-surface p-4 text-sm text-neya-muted space-y-1">
              <p className="font-medium text-neya-ink">Astuce</p>
              <p>Cochez une frame pour marquer l’avancement.</p>
              <p>Cliquez le titre pour renommer. Ouvrez « + Note » pour les détails.</p>
            </div>
          </aside>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
