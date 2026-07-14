'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const STATUS_CLS = {
  queued: 'bg-neya-surface text-neya-muted border border-neya-border',
  running: 'bg-neya-ink text-white',
  done: 'bg-neya-surface text-neya-ink border border-neya-border',
  error: 'bg-red-50 text-red-700 border border-red-200',
};

export default function CursorAgentPanel() {
  const [config, setConfig] = useState(null);
  const [gitInfo, setGitInfo] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [form, setForm] = useState({
    cursor_api_key: '',
    cursor_runtime: 'local',
    cursor_repo_url: '',
    cursor_cwd: '/workspace',
    cursor_model: 'composer-2.5',
    cursor_auto_backup: true,
  });
  const [prompt, setPrompt] = useState('');
  const [commitMsg, setCommitMsg] = useState('chore: modifications agent Cursor');
  const [roadmap, setRoadmap] = useState([]);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const bottomRef = useRef(null);

  const loadGit = useCallback(async () => {
    try {
      setGitInfo(await api('/cursor-agent/git'));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [cfg, rm, list] = await Promise.all([
        api('/cursor-agent/config'),
        api('/cursor-agent/roadmap'),
        api('/cursor-agent/runs'),
      ]);
      setConfig(cfg);
      setForm(f => ({
        ...f,
        cursor_runtime: cfg.runtime || 'local',
        cursor_repo_url: cfg.repo_url || '',
        cursor_cwd: cfg.cwd || '/workspace',
        cursor_model: cfg.model || 'composer-2.5',
        cursor_auto_backup: cfg.auto_backup !== false,
        cursor_api_key: '',
      }));
      if (!cfg.configured) setShowConfig(true);
      setRoadmap(rm);
      setRuns(list);
      await loadGit();
    } catch (e) {
      setErr(e.message);
    }
  }, [loadGit]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      api('/cursor-agent/runs').then(setRuns).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runs]);

  async function saveConfig() {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const payload = { ...form };
      if (!payload.cursor_api_key) delete payload.cursor_api_key;
      const cfg = await api('/cursor-agent/config', { method: 'PUT', body: JSON.stringify(payload) });
      setConfig(cfg);
      setForm(f => ({ ...f, cursor_api_key: '' }));
      setShowConfig(false);
      setOkMsg('Configuration enregistrée.');
      await loadGit();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    setErr('');
    setOkMsg('');
    setPrompt('');
    try {
      await api('/cursor-agent/run', {
        method: 'POST',
        body: JSON.stringify({ prompt: p, label: p.slice(0, 80) }),
      });
      setRuns(await api('/cursor-agent/runs'));
      setOkMsg('Run lancé — backup Git créé automatiquement avant modification.');
      await loadGit();
    } catch (e) {
      setErr(e.message);
      setPrompt(p);
    } finally {
      setBusy(false);
    }
  }

  async function launchRoadmap(id) {
    setBusy(true);
    setErr('');
    try {
      await api(`/cursor-agent/roadmap/${id}`, { method: 'POST' });
      setRuns(await api('/cursor-agent/runs'));
      await loadGit();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function manualBackup() {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const b = await api('/cursor-agent/backups', { method: 'POST', body: JSON.stringify({ label: 'manual' }) });
      setOkMsg(`Backup créé : ${b.tag} (${b.commit})`);
      await loadGit();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await api('/cursor-agent/git/commit', {
        method: 'POST',
        body: JSON.stringify({ message: commitMsg }),
      });
      setOkMsg(r.empty ? 'Rien à committer.' : `Commit ${r.commit}`);
      await loadGit();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doPush() {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await api('/cursor-agent/git/push', { method: 'POST', body: '{}' });
      setOkMsg(`Push OK → ${r.remote}/${r.branch}`);
      await loadGit();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function restoreBackup(b) {
    if (!confirm(`Restaurer le backup ${b.tag || b.commit} ? Un snapshot de sécurité sera pris avant.`)) return;
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await api('/cursor-agent/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ tag: b.tag, commit: b.full_commit || b.commit }),
      });
      setOkMsg(`Restauré : ${r.restored}`);
      await loadGit();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const thread = [...runs].sort((a, b) => a.id - b.id);
  const git = gitInfo?.git || config?.git;
  const backups = gitInfo?.backups || [];

  return (
    <div className="space-y-4">
      <section className="card">
        <h2 className="font-heading text-lg mb-1">Passerelle Cursor sur le VPS</h2>
        <p className="text-sm text-neya-muted mb-3">
          L&apos;agent tourne sur l&apos;hôte Ubuntu (<code className="text-xs">/opt/neya-erp</code>), pas dans Docker.
          Backup Git obligatoire avant chaque run.
        </p>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div className="border border-neya-border p-3 bg-neya-surface/40">
            <p className="text-xs uppercase tracking-wide text-neya-muted font-semibold mb-1">Hôte VPS</p>
            {config?.host?.available ? (
              <>
                <p className="font-mono text-xs break-all">{config.host.hostname}</p>
                <p className="text-xs text-neya-muted mt-0.5">{config.host.platform}</p>
                <p className="font-mono text-xs break-all mt-1">{config.host.cwd || config?.cwd}</p>
              </>
            ) : (
              <p className="text-amber-800 text-xs">{config?.host?.error || 'Runner hôte hors ligne'}</p>
            )}
            <p className="mt-1">
              Runtime : <span className="font-medium">{config?.runtime || '?'}</span>
              {' · '}
              Backup auto : {config?.auto_backup === false ? 'off' : 'on'}
            </p>
          </div>
          <div className="border border-neya-border p-3 bg-neya-surface/40">
            <p className="text-xs uppercase tracking-wide text-neya-muted font-semibold mb-1">Git</p>
            {git?.isRepo ? (
              <ul className="space-y-0.5">
                <li>Branche <span className="font-mono">{git.branch}</span> · <span className="font-mono">{git.commit}</span></li>
                <li>{git.dirty ? `${git.dirtyFiles?.length || '?'} fichier(s) modifiés` : 'Arbre propre'}</li>
                <li className="font-mono text-xs break-all text-neya-muted">{git.remoteUrl || 'pas de remote origin'}</li>
              </ul>
            ) : (
              <p className="text-amber-800 text-xs">{git?.error || 'Git non initialisé sur /opt/neya-erp'}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" onClick={manualBackup} disabled={busy} className="btn-secondary text-xs min-h-[36px]">
            Backup maintenant
          </button>
          <button type="button" onClick={doCommit} disabled={busy} className="btn-secondary text-xs min-h-[36px]">
            Commit
          </button>
          <button type="button" onClick={doPush} disabled={busy} className="btn-secondary text-xs min-h-[36px]">
            Push origin
          </button>
          <button type="button" onClick={loadGit} disabled={busy} className="btn-ghost text-xs">
            Actualiser Git
          </button>
        </div>
        <input
          className="input mt-2 text-sm min-h-[40px]"
          value={commitMsg}
          onChange={e => setCommitMsg(e.target.value)}
          placeholder="Message de commit"
        />

        {backups.length > 0 && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-neya-muted font-semibold mb-2">Backups récents</p>
            <ul className="text-xs divide-y divide-neya-border border border-neya-border">
              {backups.slice(0, 6).map((b, i) => (
                <li key={b.tag || i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="font-mono truncate">{b.tag || b.commit} · {b.commit}</span>
                  <button type="button" onClick={() => restoreBackup(b)} disabled={busy} className="btn-ghost text-xs text-red-700">
                    Restaurer
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="card !p-0 overflow-hidden flex flex-col min-h-[60vh]">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-neya-border bg-neya-surface/40">
          <div>
            <h2 className="font-heading text-lg text-neya-ink">Agent Cursor</h2>
            <p className="text-xs text-neya-muted">Modifie l&apos;ERP via la passerelle VPS</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-1 font-semibold border ${
              config?.configured ? 'bg-neya-surface text-neya-ink border-neya-border' : 'bg-amber-50 text-amber-900 border-amber-200'
            }`}>
              {config?.configured ? `OK ${config.api_key_preview}` : 'Clé manquante'}
            </span>
            <button type="button" onClick={() => setShowConfig(v => !v)} className="btn-secondary text-xs h-9 px-3">
              {showConfig ? 'Fermer' : 'Config'}
            </button>
          </div>
        </div>

        {showConfig && (
          <div className="px-4 py-4 border-b border-neya-border bg-white space-y-3">
            <p className="text-xs text-neya-muted">
              Clé API :{' '}
              <a href="https://cursor.com/settings" target="_blank" rel="noreferrer" className="underline">
                cursor.com/settings
              </a>
            </p>
            <input
              className="input font-mono text-sm"
              type="password"
              placeholder={config?.configured ? 'Nouvelle clé (optionnel)' : 'key_…'}
              value={form.cursor_api_key}
              onChange={e => setForm({ ...form, cursor_api_key: e.target.value })}
            />
            <select
              className="input"
              value={form.cursor_runtime}
              onChange={e => setForm({ ...form, cursor_runtime: e.target.value })}
            >
              <option value="local">Local hôte VPS (/opt/neya-erp)</option>
              <option value="cloud">Cloud GitHub</option>
            </select>
            {form.cursor_runtime === 'cloud' ? (
              <input
                className="input font-mono text-sm"
                placeholder="https://github.com/org/neya-erp"
                value={form.cursor_repo_url}
                onChange={e => setForm({ ...form, cursor_repo_url: e.target.value })}
              />
            ) : (
              <input
                className="input font-mono text-sm"
                value={form.cursor_cwd}
                onChange={e => setForm({ ...form, cursor_cwd: e.target.value })}
              />
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.cursor_auto_backup !== false}
                onChange={e => setForm({ ...form, cursor_auto_backup: e.target.checked })}
              />
              Backup Git automatique avant chaque run
            </label>
            <button type="button" onClick={saveConfig} disabled={busy} className="btn-primary text-sm">
              Enregistrer
            </button>
          </div>
        )}

        {err && (
          <div className="mx-4 mt-3 bg-red-50 text-red-700 text-sm px-4 py-3 border border-red-200">{err}</div>
        )}
        {okMsg && (
          <div className="mx-4 mt-3 bg-green-50 text-green-800 text-sm px-4 py-3 border border-green-200">{okMsg}</div>
        )}

        <div className="px-4 py-3 border-b border-neya-border overflow-x-auto">
          <p className="text-[10px] uppercase tracking-wide text-neya-muted font-semibold mb-2">Roadmap</p>
          <div className="flex gap-2 min-w-max">
            {roadmap.map(item => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => launchRoadmap(item.id)}
                className="text-xs px-3 py-2 border border-neya-border bg-white hover:bg-neya-surface disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-neya-surface/30 min-h-[280px]">
          {thread.length === 0 && (
            <div className="text-center text-sm text-neya-muted py-12">
              Ex. « Améliore le login mobile » — un backup Git sera pris avant toute modification.
            </div>
          )}

          {thread.map(run => (
            <div key={run.id} className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-neya-ink text-white rounded px-4 py-3 text-sm whitespace-pre-wrap">
                  {run.prompt}
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-white border border-neya-border rounded px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold text-neya-muted uppercase">Agent #{run.id}</span>
                    <span className={`text-[10px] px-2 py-0.5 font-semibold ${STATUS_CLS[run.status] || STATUS_CLS.queued}`}>
                      {run.status === 'running' ? 'en cours…' : run.status}
                    </span>
                    {run.backup?.tag && (
                      <span className="text-[10px] font-mono text-neya-muted">backup {run.backup.tag}</span>
                    )}
                  </div>
                  {run.status === 'queued' || run.status === 'running' ? (
                    <p className="text-neya-muted animate-pulse">Modification en cours sur le VPS…</p>
                  ) : run.error ? (
                    <p className="text-red-600 whitespace-pre-wrap">{run.error}</p>
                  ) : (
                    <pre className="whitespace-pre-wrap text-neya-ink font-sans text-sm">
                      {typeof run.result === 'string' ? run.result : JSON.stringify(run.result, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-neya-border bg-white p-3 flex gap-2 items-end">
          <textarea
            className="input flex-1 min-h-[52px] max-h-32 resize-none"
            rows={2}
            placeholder="Demandez une modification du code ERP…"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChat();
              }
            }}
          />
          <button
            type="button"
            onClick={sendChat}
            disabled={busy || !prompt.trim()}
            className="btn-primary shrink-0 h-[52px] px-5 disabled:opacity-40"
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
