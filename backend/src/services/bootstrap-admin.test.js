import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('bootstrap-admin module', () => {
  it('exporte needsAdminSetup et bootstrapFirstAdmin', async () => {
    const src = readFileSync(path.join(__dirname, 'bootstrap-admin.js'), 'utf8');
    assert.match(src, /export async function needsAdminSetup/);
    assert.match(src, /export async function bootstrapFirstAdmin/);
    assert.match(src, /pg_advisory_xact_lock/);
    assert.match(src, /role = 'admin'/);
  });

  it('refuse un setup si un admin existe déjà (garde dans le code)', () => {
    const src = readFileSync(path.join(__dirname, 'bootstrap-admin.js'), 'utf8');
    assert.match(src, /Un administrateur existe déjà/);
  });

  it('route auth expose setup-status et setup', () => {
    const src = readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
    assert.match(src, /\/setup-status/);
    assert.match(src, /\/setup/);
    assert.match(src, /bootstrapFirstAdmin/);
  });
});
