/** Helpers aperçu Drive (sans React) — tableurs / Google Workspace. */

export const GOOGLE_APP_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
]);

export const OFFICE_SHEET_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

export function googleEmbedUrl(file) {
  if (!file?.id) return '';
  const mime = file.mimeType || '';
  if (mime === 'application/vnd.google-apps.spreadsheet') {
    return `https://docs.google.com/spreadsheets/d/${file.id}/preview`;
  }
  if (mime === 'application/vnd.google-apps.document') {
    return `https://docs.google.com/document/d/${file.id}/preview`;
  }
  if (mime === 'application/vnd.google-apps.presentation') {
    return `https://docs.google.com/presentation/d/${file.id}/embed?start=false&loop=false&delayms=3000`;
  }
  if (mime === 'application/vnd.google-apps.drawing') {
    return `https://docs.google.com/drawings/d/${file.id}/preview`;
  }
  return `https://drive.google.com/file/d/${file.id}/preview`;
}

export function driveFilePreviewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function isSpreadsheetMime(mime = '', name = '') {
  const m = String(mime).toLowerCase();
  const n = String(name).toLowerCase();
  return (
    m.includes('spreadsheet')
    || m.includes('excel')
    || OFFICE_SHEET_TYPES.has(m)
    || /\.(xlsx|xls|ods|csv)$/i.test(n)
  );
}

export function getPreviewMode(file) {
  if (!file || file.isFolder) return null;
  const mime = file.mimeType || '';
  const name = file.name || '';
  if (GOOGLE_APP_TYPES.has(mime)) return 'google';
  if (OFFICE_SHEET_TYPES.has(mime) || /\.(xlsx|xls|ods)$/i.test(name)) return 'office';
  if (mime === 'text/csv' || /\.csv$/i.test(name)) return 'csv';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return 'text';
  return null;
}

export function canPreview(file) {
  return !!getPreviewMode(file);
}

export function parseCsvPreview(text, maxRows = 200, maxCols = 40) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text || '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(cell);
      cell = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      if (ch === '\r') i++;
      if (rows.length >= maxRows) break;
      continue;
    }
    if (ch === '\r') {
      row.push(cell);
      cell = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      if (rows.length >= maxRows) break;
      continue;
    }
    cell += ch;
  }
  if (rows.length < maxRows) {
    row.push(cell);
    if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  }

  return rows.map((r) => r.slice(0, maxCols));
}
