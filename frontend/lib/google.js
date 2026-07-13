import { api, getApiUrl, getToken } from './api';

export async function getGoogleStatus() {
  return api('/integrations/status');
}

export async function connectGoogle() {
  const { url } = await api('/integrations/google/authorize');
  window.location.href = url;
}

export async function disconnectGoogle() {
  return api('/integrations/google/disconnect', { method: 'POST' });
}

export function driveDownloadUrl(fileId) {
  return `${getApiUrl()}/drive/files/${fileId}/download?access_token=${encodeURIComponent(getToken() || '')}`;
}
