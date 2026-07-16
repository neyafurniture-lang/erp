'use client';

import { useEffect, useState } from 'react';
import { api, getApiRoot, getApiUrl, getToken } from '../lib/api';

function formatBytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function DeployVpsPanel() {
  const [local, setLocal] = useState(null);
  const [git, setGit] = useState(null);
  const [gitConfig, setGitConfig] = useState(null);
  const [remoteUrl, setRemoteUrl] = useState('https://erp.neyafurniture.ca');
  const [remote, setRemote] = useState(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [savingRepo, setSavingRepo] = useState(false);
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState(null);
  const [exports, setExports] = useState([]);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [vpsHost, setVpsHost] = useState('51.222.31.75');
  const [includeDb, setIncludeDb] = useState(true);
  const [showLegacy, setShowLegacy] = useState(false);

  async function load() {
    setErr('');
    try {
      const data = await api('/deploy/diagnostics');
      setLocal(data.local);
      setGit(data.git || null);
      setGitConfig(data.gitConfig || null);
      if (data.gitConfig?.repoUrl) setRepoUrl(data.gitConfig.repoUrl);
      if (data.gitConfig?.vpsHost) setVpsHost(data.gitConfig.vpsHost);
      else if (data.git?.remoteUrl) setRepoUrl(data.git.remoteUrl);
      if (data.remote) setRemote(data.remote);
      const list = await api('/deploy/exports');
      setExports(list);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function probeVps() {
    setProbing(true);
    setErr('');
    try {
      const data = await api(`/deploy/diagnostics?remote=${encodeURIComponent(remoteUrl)}`);
      setRemote(data.remote);
      setGit(data.git || git);
      setGitConfig(data.gitConfig || gitConfig);
    } catch (e) {
      setErr(e.message);
    } finally {
      setProbing(false);
    }
  }

  async function saveRepo() {
    setSavingRepo(true);
    setErr('');
    setOkMsg('');
    try {
      const data = await api('/deploy/git/config', {
        method: 'POST',
        body: JSON.stringify({ repoUrl }),
      });
      setGitConfig(data.gitConfig);
      setOkMsg('URL du dépôt enregistrée.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setSavingRepo(false);
    }
  }

  async function deployFromGit(force = false) {
    setDeploying(true);
    setErr('');
    setOkMsg('');
    try {
      const data = await api('/deploy/git/deploy', {
        method: 'POST',
        body: JSON.stringify({ force, vpsHost }),
      });
      setOkMsg(data.message || 'Déploiement lancé.');
      await probeVps();
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeploying(false);
    }
  }

  async function generatePackage() {
    setPreparing(true);
    setErr('');
    setResult(null);
    try {
      const data = await api('/deploy/prepare', {
        method: 'POST',
        body: JSON.stringify({ includeDb, vpsHost, vpsPath: '/opt/neya-erp' }),
      });
      setResult(data);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setPreparing(false);
    }
  }

  async function downloadFile(filename) {
    const token = getToken();
    const res = await fetch(`${getApiUrl()}/deploy/download/${encodeURIComponent(filename)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Téléchargement échoué (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const mailIssue = remote?.ok && !remote?.mailOk;
  const origin = git?.remoteUrl || repoUrl || 'git@github.com:VOTRE_ORG/neya-erp.git';
  const branch = git?.branch || gitConfig?.branch || 'main';

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="font-heading text-lg mb-1">Mise à jour via Git</h2>
        <p className="text-sm text-neya-muted mb-4">
          Flux recommandé : commit local → push GitHub → le VPS fait <code className="text-xs">git pull</code> + rebuild Docker.
        </p>

        {err && (
          <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded mb-4">{err}</div>
        )}
        {okMsg && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 px-3 py-2 rounded mb-4">{okMsg}</div>
        )}

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="border border-neya-border p-4 bg-neya-surface/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-neya-muted mb-2">Local (PC / backend)</p>
            {git?.isRepo ? (
              <ul className="text-sm space-y-1">
                <li>Branche <span className="font-mono">{git.branch}</span></li>
                <li>Commit <span className="font-mono">{git.commit}</span>{git.dirty ? ' · modifications non commit' : ''}</li>
                <li>Version <span className="font-mono">{git.version || local?.version || '?'}</span></li>
                <li>
                  Origin : {git.remoteUrl
                    ? <span className="font-mono text-xs break-all">{git.remoteUrl}</span>
                    : <span className="text-amber-800">pas encore de remote</span>}
                </li>
                {git.pushPending && <li className="text-amber-800">{git.ahead} commit(s) à pousser</li>}
                {git.updateAvailable && <li className="text-amber-800">{git.behind} commit(s) en retard vs origin</li>}
                {!git.pushPending && !git.updateAvailable && git.remoteUrl && (
                  <li className="text-neya-muted">À jour avec origin</li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-neya-muted">
                {git?.message || 'Dépôt Git non détecté — initialisez avec git init + remote.'}
              </p>
            )}
          </div>

          <div className="border border-neya-border p-4 bg-neya-surface/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-neya-muted mb-2">VPS (prod)</p>
            <div className="flex gap-2 mb-2">
              <input
                className="input text-sm flex-1 min-h-[40px]"
                value={remoteUrl}
                onChange={e => setRemoteUrl(e.target.value)}
                placeholder="https://erp.neyafurniture.ca"
              />
              <button type="button" onClick={probeVps} disabled={probing} className="btn-secondary text-xs shrink-0 min-h-[40px]">
                {probing ? '…' : 'Vérifier'}
              </button>
            </div>
            {remote?.ok ? (
              <ul className="text-sm space-y-1">
                <li>Version <span className="font-mono">{remote.version || '?'}</span> · commit <span className="font-mono">{remote.commit || '?'}</span></li>
                <li>Courriel ERP : {remote.mailOk ? 'OK' : 'manquant'}</li>
                {local?.commit && remote.commit && local.commit !== remote.commit && (
                  <li className="text-amber-800 text-xs">Prod ≠ local — poussez puis déployez</li>
                )}
              </ul>
            ) : remote ? (
              <p className="text-sm text-red-700">{remote.error || 'VPS inaccessible'}</p>
            ) : (
              <p className="text-sm text-neya-muted">Cliquez Vérifier pour comparer avec la prod</p>
            )}
          </div>
        </div>

        {mailIssue && (
          <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 px-4 py-3 rounded mb-4">
            Le VPS n&apos;a pas toutes les routes courriel. Déployez la branche à jour via Git.
          </div>
        )}

        <div className="space-y-3 mb-4">
          <label className="block text-sm">
            <span className="label">URL dépôt Git (GitHub / GitLab)</span>
            <div className="flex flex-wrap gap-2 mt-1">
              <input
                className="input flex-1 min-w-[220px] font-mono text-sm"
                value={repoUrl}
                onChange={e => setRepoUrl(e.target.value)}
                placeholder="git@github.com:org/neya-erp.git"
              />
              <button type="button" onClick={saveRepo} disabled={savingRepo || !repoUrl.trim()} className="btn-secondary text-sm min-h-[44px]">
                {savingRepo ? '…' : 'Enregistrer'}
              </button>
            </div>
          </label>
          <p className="text-xs text-neya-muted">
            VPS : <span className="font-mono text-neya-ink">{vpsHost || gitConfig?.vpsHost || '51.222.31.75'}</span>
            {gitConfig?.sshKeyConfigured
              ? ' · clé SSH OK'
              : ' · clé SSH manquante — ajoutez NEYA_VPS_SSH_KEY dans backend/.env (sinon Permission denied)'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button type="button" onClick={() => deployFromGit(false)} disabled={deploying} className="btn-primary">
            {deploying ? 'Déploiement…' : 'Déployer sur le VPS (git pull)'}
          </button>
          <button type="button" onClick={() => deployFromGit(true)} disabled={deploying} className="btn-secondary">
            Forcer rebuild
          </button>
          <button type="button" onClick={load} className="btn-ghost text-sm">Actualiser</button>
        </div>

        <div className="border border-neya-border bg-neya-surface/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neya-muted mb-2">Commandes locales</p>
          <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap text-neya-ink">
{`# 1. Commit + push
git add -A
git commit -m "votre message"
git push -u origin ${branch}

# 2. Sur le VPS (ou bouton ci-dessus)
cd /opt/neya-erp
./deploy/check-update.sh
./deploy/deploy.sh

# Premier branchement VPS → Git (une fois)
# .\\deploy\\vps-init-git.ps1 -RepoUrl "${origin}"`}
          </pre>
          <p className="text-xs text-neya-muted mt-2">
            Automatique : GitHub Actions (.github/workflows/deploy.yml) après configuration des secrets DEPLOY_*.
          </p>
        </div>
      </section>

      <section className="card bg-red-50/50 border border-red-200/60">
        <h2 className="font-heading text-base mb-2 text-red-900">Rollback d&apos;urgence</h2>
        <p className="text-sm text-red-900/80 mb-3">
          Restaure le commit précédent + backup Postgres.
        </p>
        <pre className="text-xs font-mono bg-white border border-red-200/50 rounded p-3 overflow-x-auto">
{`cd /opt/neya-erp && sudo ./deploy/install-rollback.sh
.\\deploy\\vps-back.ps1
ssh ubuntu@${vpsHost || '51.222.31.75'} back.sh`}
        </pre>
      </section>

      <section className="card">
        <button type="button" onClick={() => setShowLegacy(v => !v)} className="btn-ghost text-sm px-0">
          {showLegacy ? '▾' : '▸'} Package ZIP (secours, ancien flux)
        </button>
        {showLegacy && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-neya-muted">
              À utiliser seulement si Git n&apos;est pas encore branché sur le VPS.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-sm">
                <span className="label">IP / hôte VPS</span>
                <input className="input mt-1" value={vpsHost} onChange={e => setVpsHost(e.target.value)} placeholder="51.222.31.75" />
              </label>
              <label className="flex items-end gap-2 text-sm cursor-pointer pb-2">
                <input type="checkbox" checked={includeDb} onChange={e => setIncludeDb(e.target.checked)} className="accent-neya-orange" />
                Inclure export SQL
              </label>
            </div>
            <button type="button" onClick={generatePackage} disabled={preparing} className="btn-secondary">
              {preparing ? 'Génération…' : 'Générer package ZIP'}
            </button>
            {result && (
              <div className="rounded border border-green-200 bg-green-50/80 p-4 text-sm space-y-2">
                <button type="button" onClick={() => downloadFile(result.files.zip)} className="text-neya-ink underline font-medium">
                  Télécharger {result.files.zip}
                </button>
                {' '}({formatBytes(result.manifest?.files?.zipSizeBytes)})
                <pre className="text-xs bg-neya-ink text-neya-cream p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                  {result.manifest?.instructions?.steps?.join('\n')}
                </pre>
              </div>
            )}
            {exports.length > 0 && (
              <ul className="text-sm divide-y divide-neya-border">
                {exports.slice(0, 6).map(f => (
                  <li key={f.name} className="py-2 flex justify-between gap-2">
                    <button type="button" onClick={() => downloadFile(f.name)} className="underline truncate text-left">
                      {f.name}
                    </button>
                    <span className="text-neya-muted shrink-0">{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <p className="text-xs text-neya-muted">API : {getApiRoot()}</p>
    </div>
  );
}
