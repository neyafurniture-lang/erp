import pool from '../db/pool.js';

let ready = false;

/** Garantit shift_id / source sur time_entries même si initDb a échoué plus tôt. */
export async function ensureTimeEntriesColumns() {
  if (ready) return;
  await pool.query('ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS shift_id INT REFERENCES shifts(id) ON DELETE SET NULL');
  await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
  await pool.query('ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()');
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_shift_unique
    ON time_entries(shift_id) WHERE shift_id IS NOT NULL
  `);
  ready = true;
}
