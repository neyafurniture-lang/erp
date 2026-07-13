import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getAllSettings } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = JSON.parse(readFileSync(path.join(__dirname, '../config/company.json'), 'utf8'));

let cache = null;
let cacheAt = 0;

/** Config entreprise fusionnée : company.json + paramètres ERP */
export async function getCompanyConfig() {
  if (cache && Date.now() - cacheAt < 30_000) return cache;
  const s = await getAllSettings();
  cache = {
    ...BASE,
    tradeName: s.company_name || BASE.tradeName,
    email: s.company_email || BASE.email,
    phone: s.company_phone || BASE.phone,
    website: s.wordpress_url || BASE.website,
  };
  cacheAt = Date.now();
  return cache;
}

export function clearCompanyCache() {
  cache = null;
}
