import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pool from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initDb() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);

  await pool.query(`
    UPDATE tasks t SET sort_order = sub.rn
    FROM (
      SELECT id, (ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id)) - 1 AS rn
      FROM tasks
    ) sub
    WHERE t.id = sub.id
      AND t.project_id IN (
        SELECT project_id FROM tasks GROUP BY project_id
        HAVING COUNT(DISTINCT sort_order) = 1 AND MAX(sort_order) = 0
      )
  `);

  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', ['admin@neya.local']);
  const adminPassword = process.env.ADMIN_PASSWORD || 'neya2024';
  if (rows.length === 0) {
    const hash = await bcrypt.hash(adminPassword, 12);
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role, permissions) VALUES ($1, $2, $3, $4, $5)',
      ['Admin NEYA', 'admin@neya.local', hash, 'admin', JSON.stringify(['*'])]
    );
    console.log('Admin créé: admin@neya.local (mot de passe depuis ADMIN_PASSWORD)');
  } else if (process.env.RESET_ADMIN_PASSWORD === '1') {
    const hash = await bcrypt.hash(adminPassword, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1, role = 'admin', permissions = '["*"]', active = true WHERE email = 'admin@neya.local'`,
      [hash]
    );
    console.log('Mot de passe admin réinitialisé (RESET_ADMIN_PASSWORD=1)');
  }

  const { seedDefaultSkills } = await import('../services/assistant.js');
  await seedDefaultSkills();

  const { seedDefaultSettings } = await import('../services/settings.js');
  await seedDefaultSettings();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_orders (
      id SERIAL PRIMARY KEY,
      wp_order_id INT UNIQUE NOT NULL,
      order_number TEXT,
      status TEXT,
      total NUMERIC(12,2) DEFAULT 0,
      customer_name TEXT,
      customer_email TEXT,
      client_id INT REFERENCES clients(id) ON DELETE SET NULL,
      project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      line_items JSONB DEFAULT '[]',
      order_url TEXT,
      synced_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS wp_order_id INT UNIQUE');
  await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS wp_customer_id INT');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_todos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE dashboard_todos ADD COLUMN IF NOT EXISTS list_key TEXT NOT NULL DEFAULT 'main'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dashboard_todos_list ON dashboard_todos(list_key)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'gestion',
      status TEXT NOT NULL DEFAULT 'todo',
      due_date DATE,
      notes TEXT,
      link_href TEXT,
      source_key TEXT UNIQUE,
      sort_order INT NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1');
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS production_priority INT NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_folder_id TEXT');
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS drive_access JSONB NOT NULL DEFAULT '[]'`);
  await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS drive_folder_id TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id) ON DELETE SET NULL');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_off (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      all_day BOOLEAN NOT NULL DEFAULT true,
      type TEXT NOT NULL DEFAULT 'vacation',
      notes TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_scans (
      id SERIAL PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      receipt_url TEXT NOT NULL,
      drive_file_id TEXT,
      drive_link TEXT,
      vendor TEXT,
      amount NUMERIC(12,2),
      tax_tps NUMERIC(12,2),
      tax_tvq NUMERIC(12,2),
      category TEXT DEFAULT 'materiaux',
      description TEXT,
      purchase_date DATE,
      raw_text TEXT,
      parsed_json JSONB,
      confidence NUMERIC(4,3),
      project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`UPDATE users SET role = 'admin', permissions = '["*"]' WHERE email = 'admin@neya.local' AND (role IS NULL OR role = 'member' OR permissions = '[]'::jsonb)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_emails (
      id SERIAL PRIMARY KEY,
      project_id INT REFERENCES projects(id) ON DELETE CASCADE,
      gmail_message_id TEXT NOT NULL UNIQUE,
      thread_id TEXT,
      subject TEXT,
      from_email TEXT,
      snippet TEXT,
      linked_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_threads (
      id SERIAL PRIMARY KEY,
      gmail_thread_id TEXT NOT NULL UNIQUE,
      subject TEXT,
      participant_emails TEXT[],
      client_id INT REFERENCES clients(id) ON DELETE SET NULL,
      project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      link_source TEXT,
      link_confidence NUMERIC(4,3),
      status TEXT DEFAULT 'open',
      last_message_at TIMESTAMPTZ,
      message_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_messages (
      id SERIAL PRIMARY KEY,
      thread_id INT NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
      gmail_message_id TEXT NOT NULL UNIQUE,
      from_email TEXT,
      to_emails TEXT[],
      subject TEXT,
      snippet TEXT,
      body_text TEXT,
      sent_at TIMESTAMPTZ,
      is_outbound BOOLEAN DEFAULT false,
      labels JSONB DEFAULT '[]',
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_thread_syntheses (
      id SERIAL PRIMARY KEY,
      thread_id INT NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      key_points JSONB DEFAULT '[]',
      action_items JSONB DEFAULT '[]',
      sentiment TEXT,
      suggested_reply TEXT,
      client_intent TEXT,
      needs_response BOOLEAN DEFAULT false,
      model TEXT,
      message_count_at_synthesis INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_threads_client ON email_threads(client_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_threads_project ON email_threads(project_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_threads_last_msg ON email_threads(last_message_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON email_messages(thread_id)`);
  await pool.query(`ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS mail_category TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_threads_category ON email_threads(mail_category)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_tokens (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      account_email TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at TIMESTAMPTZ,
      scopes TEXT[],
      meta JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(provider, account_email)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_needs (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'consommable',
      quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'unité',
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'needed',
      inventory_item_id INT REFERENCES inventory_items(id) ON DELETE SET NULL,
      project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      ordered_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_invoice_emails (
      id SERIAL PRIMARY KEY,
      gmail_message_id TEXT NOT NULL UNIQUE,
      thread_id TEXT,
      subject TEXT,
      from_email TEXT,
      snippet TEXT,
      supplier_id TEXT NOT NULL DEFAULT 'other',
      supplier_label TEXT,
      keywords JSONB NOT NULL DEFAULT '[]',
      suggested_project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_routing_rules (
      id SERIAL PRIMARY KEY,
      supplier_id TEXT NOT NULL DEFAULT 'any',
      keyword_pattern TEXT NOT NULL,
      project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      hit_count INT NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(supplier_id, keyword_pattern)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cutting_plans (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Plan de coupe',
      project_label TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      plan_input JSONB NOT NULL DEFAULT '{}',
      result_cache JSONB,
      project_id INT REFERENCES projects(id) ON DELETE SET NULL,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE admin_tasks ADD COLUMN IF NOT EXISTS priority_tier TEXT NOT NULL DEFAULT 'p2'`);
  await pool.query(`ALTER TABLE assistant_memories ADD COLUMN IF NOT EXISTS client_id INT REFERENCES clients(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE assistant_memories ADD COLUMN IF NOT EXISTS quote_id INT REFERENCES quotes(id) ON DELETE CASCADE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_memories_client ON assistant_memories(client_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_memories_quote ON assistant_memories(quote_id)`);
  await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS title TEXT`);
  await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS reference TEXT`);
  await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_until DATE`);
  await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS additional_notes TEXT`);
  await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS acceptance_date DATE`);

  await seedV2Extensions();

  const { seedDefaultAdminTasks, seedPriorityTasks } = await import('../services/admin-task-sync.js');
  await seedDefaultAdminTasks();
  await seedPriorityTasks();
}

async function seedV2Extensions() {
  const team = [
    { name: 'Mehdi', role: 'artisan', hourly_rate: 23, skills: ['debitage', 'usinage', 'cnc', 'assemblage'], color: '#D86B30' },
    { name: 'Olive', role: 'artisan', hourly_rate: 19, skills: ['assemblage', 'finition', 'usinage'], color: '#6B8E6B' },
  ];

  for (const emp of team) {
    const { rows } = await pool.query('SELECT id FROM employees WHERE name = $1', [emp.name]);
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO employees (name, role, hourly_rate, skills, color) VALUES ($1, $2, $3, $4, $5)`,
        [emp.name, emp.role, emp.hourly_rate, JSON.stringify(emp.skills), emp.color]
      );
      console.log(`Employé(e) ${emp.name} ajouté(e) — ${emp.hourly_rate}$/h`);
    } else {
      await pool.query(
        'UPDATE employees SET hourly_rate = $1, role = $2, skills = $3, color = $4, active = true WHERE id = $5',
        [emp.hourly_rate, emp.role, JSON.stringify(emp.skills), emp.color, rows[0].id]
      );
      console.log(`Employé(e) ${emp.name} — taux ${emp.hourly_rate}$/h`);
    }
  }

  for (const emp of team) {
    const { rows: er } = await pool.query('SELECT id FROM employees WHERE name = $1', [emp.name]);
    if (!er[0]) continue;
    await pool.query(
      `UPDATE users SET employee_id = $1
       WHERE employee_id IS NULL AND (name ILIKE $2 OR email ILIKE $3)`,
      [er[0].id, `%${emp.name}%`, `%${emp.name.toLowerCase()}%`]
    );
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  initDb()
    .then(() => {
      console.log('Database initialized');
      process.exit(0);
    })
    .catch((err) => {
      console.error('DB init failed:', err.message);
      process.exit(1);
    });
}
