'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const STATUS_CLS = {
  queued: 'bg-amber-100 text-amber-800',
  running: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
};

export default function CursorAgentPanel() {
  const [config, setConfig] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [form, setForm] = useState({
    cursor_api_key: '',
    cursor_runtime: 'local',
    cursor_repo_url: '',
    cursor_cwd: '/opt/neya-erp',
    cursor_model: 'composer-2.5',
  });
  const [prompt, setPrompt] = useState('');
  const [roadmap, setRoadmap] = useState([]);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bottomRef = useRef(null);

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
        cursor_cwd: cfg.cwd || '/opt/neya-erp',
        cursor_model: cfg.model || 'composer-2.5',
        cursor_api_key: '',
      }));
      if (!cfg.configured) setShowConfig(true);
      setRoadmap(rm);
      setRuns(list);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

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
    try {
      const payload = { ...form };
      if (!payload.cursor_api_key) delete payload.cursor_api_key;
      const cfg = await api('/cursor-agent/config', { method: 'PUT', body: JSON.stringify(payload) });
      setConfig(cfg);
      setForm(f => ({ ...f, cursor_api_key: '' }));
      setShowConfig(false);
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
    setPrompt('');
    try {
      await api('/cursor-agent/run', {
        method: 'POST',
        body: JSON.stringify({ prompt: p, label: p.slice(0, 80) }),
      });
      setRuns(await api('/cursor-agent/runs'));
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
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Conversation = runs triés chronologiquement (ancien → récent)
  const thread = [...runs].sort((a, b) => a.id - b.id);

  return (
    <div className="space-y-4">
      <div className="card !p-0 overflow-hidden flex flex-col min-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-neya-border bg-neya-cream/50">
          <div>
            <h2 className="font-heading text-lg text-neya-ink">Chat Agent Cursor</h2>
            <p className="text-xs text-neya-muted">
              Discutez ici — l&apos;agent travaille en arrière-plan sur le code NEYA.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
              config?.configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}>
              {config?.configured ? `OK ${config.api_key_preview}` : 'Clé manquante'}
            </span>
            <button type="button" onClick={() => setShowConfig(v => !v)} className="btn-secondary text-xs h-9 px-3">
              {showConfig ? 'Fermer config' : 'Config'}
            </button>
          </div>
        </div>

        {showConfig && (
          <div className="px-4 py-4 border-b border-neya-border bg-white space-y-3">
            <p className="text-xs text-neya-muted">
              Clé API :{' '}
              <a href="https://cursor.com/settings" target="_blank" rel="noreferrer" className="text-neya-orange underline">
                cursor.com/settings
              </a>
              . Store JSONL (pas besoin de Node sqlite).
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
              <option value="local">Local (fichiers sur le VPS)</option>
              <option value="cloud">Cloud (GitHub)</option>
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
            <button type="button" onClick={saveConfig} disabled={busy} className="btn-primary text-sm">
              Enregistrer
            </button>
          </div>
        )}

        {err && (
          <div className="mx-4 mt-3 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-200">
            {err}
          </div>
        )}

        {/* Roadmap one-click */}
        <div className="px-4 py-3 border-b border-neya-border overflow-x-auto">
          <p className="text-[10px] uppercase tracking-wide text-neya-muted font-semibold mb-2">Roadmap — 1 clic</p>
          <div className="flex gap-2 min-w-max">
            {roadmap.map(item => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => launchRoadmap(item.id)}
                className="text-xs px-3 py-2 rounded-full border border-neya-border bg-white hover:border-neya-orange hover:text-neya-orange disabled:opacity-50"
              >
                ▶ {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-neya-cream/30 min-h-[320px]">
          {thread.length === 0 && (
            <div className="text-center text-sm text-neya-muted py-12">
              Écrivez un message ci-dessous ou cliquez une priorité roadmap.
              <br />
              Ex. « Améliore le login mobile »
            </div>
          )}

          {thread.map(run => (
            <div key={run.id} className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-neya-orange text-white rounded-2xl rounded-br-md px-4 py-3 text-sm whitespace-pre-wrap">
                  {run.prompt}
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-white border border-neya-border rounded-2xl rounded-bl-md px-4 py-3 text-sm shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold text-neya-muted uppercase">Agent #{run.id}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_CLS[run.status] || STATUS_CLS.queued}`}>
                      {run.status === 'running' ? 'réfléchit…' : run.status}
                    </span>
                  </div>
                  {run.status === 'queued' || run.status === 'running' ? (
                    <p className="text-neya-muted animate-pulse">Réponse en cours — naviguez librement dans l&apos;ERP…</p>
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

        {/* Composer */}
        <div className="border-t border-neya-border bg-white p-3 flex gap-2 items-end">
          <textarea
            className="input flex-1 min-h-[52px] max-h-32 resize-none"
            rows={2}
            placeholder="Parlez à l'agent Cursor…"
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
