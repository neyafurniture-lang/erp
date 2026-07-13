'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PERMISSION_AREAS, isAdmin } from '../lib/permissions';
import { useAuth } from '../lib/auth-context';

const EMPTY = {
  name: '',
  email: '',
  password: '',
  role: 'member',
  permissions: [],
  drive_access: [],
  employee_id: '',
  active: true,
};

export default function UsersManager() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [driveOptions, setDriveOptions] = useState({ projects: [], clients: [] });
  const [customFolderId, setCustomFolderId] = useState('');
  const [customFolderLabel, setCustomFolderLabel] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/users').then(setUsers).catch(e => setErr(e.message));

  useEffect(() => {
    load();
    api('/users/drive-options').then(setDriveOptions).catch(() => {});
    api('/employees').then(setEmployees).catch(() => {});
  }, []);

  if (!isAdmin(currentUser)) {
    return <p className="text-sm text-neya-muted">Réservé aux administrateurs.</p>;
  }

  const groups = [...new Set(Object.values(PERMISSION_AREAS).map(a => a.group))];

  function togglePerm(key) {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter(p => p !== key)
        : [...f.permissions, key],
    }));
  }

  function toggleDriveProject(projectId) {
    setForm(f => {
      const exists = f.drive_access.some(a => a.project_id === projectId);
      return {
        ...f,
        drive_access: exists
          ? f.drive_access.filter(a => a.project_id !== projectId)
          : [...f.drive_access, { project_id: projectId }],
      };
    });
  }

  function toggleDriveClient(clientId) {
    setForm(f => {
      const exists = f.drive_access.some(a => a.client_id === clientId);
      return {
        ...f,
        drive_access: exists
          ? f.drive_access.filter(a => a.client_id !== clientId)
          : [...f.drive_access, { client_id: clientId }],
      };
    });
  }

  function addCustomFolder(e) {
    e.preventDefault();
    const folder_id = customFolderId.trim();
    if (!folder_id) return;
    setForm(f => ({
      ...f,
      drive_access: [...f.drive_access, { folder_id, label: customFolderLabel.trim() || 'Dossier Drive' }],
    }));
    setCustomFolderId('');
    setCustomFolderLabel('');
  }

  function removeDriveEntry(i) {
    setForm(f => ({ ...f, drive_access: f.drive_access.filter((_, idx) => idx !== i) }));
  }

  function driveEntryLabel(entry) {
    if (entry.project_id) {
      const p = driveOptions.projects.find(x => x.id === entry.project_id);
      return p ? `Projet — ${p.name}` : `Projet #${entry.project_id}`;
    }
    if (entry.client_id) {
      const c = driveOptions.clients.find(x => x.id === entry.client_id);
      return c ? `Client — ${c.name}` : `Client #${entry.client_id}`;
    }
    return entry.label || entry.folder_id || 'Dossier';
  }

  function startEdit(u) {
    setEditing(u.id);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      permissions: [...(u.permissions || [])],
      drive_access: [...(u.drive_access || [])],
      employee_id: u.employee_id ? String(u.employee_id) : '',
      active: u.active,
    });
    setErr('');
    setMsg('');
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        permissions: form.role === 'admin' ? ['*'] : form.permissions,
        drive_access: form.role === 'admin' ? [] : form.drive_access,
        employee_id: form.employee_id ? Number(form.employee_id) : null,
        active: form.active,
      };
      if (form.password) payload.password = form.password;

      if (editing) {
        await api(`/users/${editing}`, { method: 'PUT', body: JSON.stringify(payload) });
        setMsg('Utilisateur mis à jour');
      } else {
        if (!form.password) throw new Error('Mot de passe requis pour un nouvel utilisateur');
        await api('/users', { method: 'POST', body: JSON.stringify({ ...payload, password: form.password }) });
        setMsg('Utilisateur créé');
      }
      cancelEdit();
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try {
      await api(`/users/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-6">
      {msg && <p className="text-sm text-green-700 bg-green-50 px-4 py-2 rounded-lg">{msg}</p>}
      {err && <p className="text-sm text-neya-error bg-red-50 px-4 py-2 rounded-lg">{err}</p>}

      <section className="card">
        <h2 className="font-heading text-lg mb-4">{editing ? 'Modifier utilisateur' : 'Nouvel utilisateur'}</h2>
        <form onSubmit={save} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Nom</label>
              <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="label">{editing ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'}</label>
              <input type="password" className="input" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} {...(editing ? {} : { required: true, minLength: 10 })} />
            </div>
            <div>
              <label className="label">Rôle</label>
              <select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="member">Utilisateur</option>
                <option value="admin">Administrateur (accès complet)</option>
              </select>
            </div>
            {form.role !== 'admin' && employees.length > 0 && (
              <div>
                <label className="label">Profil atelier (congés, shifts)</label>
                <select className="input" value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
                  <option value="">— Aucun —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {form.role !== 'admin' && (
            <div>
              <p className="label mb-2">Accès autorisés</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {groups.map(group => (
                  <div key={group} className="border border-neya-border rounded-lg p-3">
                    <p className="text-xs font-semibold text-neya-ink mb-2">{group}</p>
                    <div className="space-y-1.5">
                      {Object.entries(PERMISSION_AREAS)
                        .filter(([, meta]) => meta.group === group)
                        .map(([key, meta]) => (
                          <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={form.permissions.includes(key)}
                              onChange={() => togglePerm(key)}
                              className="rounded border-neya-border"
                            />
                            <span>{meta.label}</span>
                          </label>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {form.role !== 'admin' && form.permissions.includes('drive') && (
            <div className="border border-neya-border rounded-lg p-4 space-y-4">
              <div>
                <p className="label mb-1">Dossiers Drive autorisés</p>
                <p className="text-xs text-neya-muted mb-3">
                  Laissez vide pour un accès à tout le Drive. Sinon, limitez aux projets, clients ou dossiers choisis.
                </p>
              </div>

              {form.drive_access.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {form.drive_access.map((entry, i) => (
                    <li key={i} className="inline-flex items-center gap-1 text-xs bg-neya-surface border border-neya-border rounded-full px-3 py-1">
                      <span>{driveEntryLabel(entry)}</span>
                      <button type="button" onClick={() => removeDriveEntry(i)} className="text-neya-error hover:underline">×</button>
                    </li>
                  ))}
                </ul>
              )}

              {driveOptions.projects.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-neya-ink mb-2">Par projet</p>
                  <div className="grid sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                    {driveOptions.projects.map(p => (
                      <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.drive_access.some(a => a.project_id === p.id)}
                          onChange={() => toggleDriveProject(p.id)}
                          className="rounded border-neya-border"
                        />
                        <span className="truncate">
                          {p.name}
                          {p.client_name ? ` (${p.client_name})` : ''}
                          {!p.drive_folder_id && <span className="text-neya-muted"> — pas de dossier</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {driveOptions.clients.some(c => c.drive_folder_id) && (
                <div>
                  <p className="text-xs font-semibold text-neya-ink mb-2">Par client</p>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {driveOptions.clients.filter(c => c.drive_folder_id).map(c => (
                      <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.drive_access.some(a => a.client_id === c.id)}
                          onChange={() => toggleDriveClient(c.id)}
                          className="rounded border-neya-border"
                        />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={addCustomFolder} className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[140px]">
                  <label className="label text-xs">ID dossier Drive (optionnel)</label>
                  <input className="input text-sm" placeholder="ID Google Drive" value={customFolderId} onChange={e => setCustomFolderId(e.target.value)} />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="label text-xs">Libellé</label>
                  <input className="input text-sm" placeholder="Ex. Archives 2025" value={customFolderLabel} onChange={e => setCustomFolderLabel(e.target.value)} />
                </div>
                <button type="submit" className="btn-secondary text-sm">Ajouter dossier</button>
              </form>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
            Compte actif
          </label>

          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Enregistrement…' : editing ? 'Mettre à jour' : 'Créer l\'utilisateur'}
            </button>
            {editing && <button type="button" onClick={cancelEdit} className="btn-secondary">Annuler</button>}
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="font-heading text-lg mb-4">Utilisateurs ({users.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neya-muted border-b border-neya-border">
                <th className="pb-2 pr-3">Nom</th>
                <th className="pb-2 pr-3">Email</th>
                <th className="pb-2 pr-3">Rôle</th>
                <th className="pb-2 pr-3">Accès</th>
                <th className="pb-2 pr-3">Atelier</th>
                <th className="pb-2 pr-3">Drive</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neya-border">
              {users.map(u => (
                <tr key={u.id} className={!u.active ? 'opacity-50' : ''}>
                  <td className="py-2 pr-3 font-medium">{u.name}</td>
                  <td className="py-2 pr-3 text-neya-muted">{u.email}</td>
                  <td className="py-2 pr-3">{u.role === 'admin' ? 'Admin' : 'Utilisateur'}</td>
                  <td className="py-2 pr-3 text-xs text-neya-muted max-w-[200px] truncate">
                    {u.role === 'admin' ? 'Tout' : (u.permissions || []).join(', ') || '—'}
                  </td>
                  <td className="py-2 pr-3 text-xs text-neya-muted">
                    {u.employee_name || (u.employee_id ? `#${u.employee_id}` : '—')}
                  </td>
                  <td className="py-2 pr-3 text-xs text-neya-muted">
                    {u.role === 'admin' ? 'Tout' : (u.drive_access?.length ? `${u.drive_access.length} dossier(s)` : 'Tout Drive')}
                  </td>
                  <td className="py-2 text-right space-x-2">
                    <button type="button" onClick={() => startEdit(u)} className="text-neya-orange hover:underline text-xs">Modifier</button>
                    {u.id !== currentUser?.id && (
                      <button type="button" onClick={() => remove(u.id)} className="text-neya-error hover:underline text-xs">Suppr.</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
