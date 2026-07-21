-- NEYA ERP — Schema PostgreSQL complet

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USERS & AUTH
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Admin',
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  permissions JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT true,
  drive_access JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CLIENTS
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS city TEXT;

-- STANDARDS (templates fabrication)
CREATE TABLE IF NOT EXISTS standards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  product_type TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE standards ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';

-- PROJECTS
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  deadline DATE,
  budget_estimated NUMERIC(12,2) DEFAULT 0,
  budget_real NUMERIC(12,2) DEFAULT 0,
  standard_id INT REFERENCES standards(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS wp_order_id INT UNIQUE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS wp_customer_id INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS production_priority INT NOT NULL DEFAULT 0;

-- COMMANDES WEB (WooCommerce)
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
);

-- TASKS
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE CASCADE,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  related_project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'admin',
  status TEXT NOT NULL DEFAULT 'todo',
  assigned_to TEXT,
  estimated_minutes INT DEFAULT 60,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
-- Soft-contexte : admin hors checklist projet, mais lien client / projet d'origine conservé
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_id INT REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS related_project_id INT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_related_project ON tasks(related_project_id);

-- QUOTES (devis)
CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  quote_number TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  lines JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  tax_rate NUMERIC(5,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_until DATE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS additional_notes TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS acceptance_date DATE;

-- INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  quote_id INT REFERENCES quotes(id) ON DELETE SET NULL,
  invoice_number TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  lines JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  tax_rate NUMERIC(5,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  amount_paid NUMERIC(12,2) DEFAULT 0,
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtitle TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS terms TEXT DEFAULT 'Net 30';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_summary TEXT;
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INT REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  method TEXT DEFAULT 'transfer',
  notes TEXT,
  date TIMESTAMPTZ DEFAULT NOW()
);

-- EXPENSES
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  category TEXT NOT NULL DEFAULT 'materiaux',
  description TEXT,
  receipt_url TEXT,
  date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
);

-- APP SETTINGS (paramètres ERP / API / assistant)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'null',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ASSISTANT SKILLS (capacités du chatbox)
CREATE TABLE IF NOT EXISTS assistant_skills (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  trigger_patterns JSONB NOT NULL DEFAULT '[]',
  action_type TEXT NOT NULL,
  action_config JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ASSISTANT MESSAGES (historique chat)
CREATE TABLE IF NOT EXISTS assistant_messages (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  actions_taken JSONB DEFAULT '[]',
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';

-- ADMIN TASKS (suivi tâches administratives — marchés, factures, site, pub, etc.)
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
  priority_tier TEXT NOT NULL DEFAULT 'p2',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_tasks_category ON admin_tasks(category);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_status ON admin_tasks(status);

-- DASHBOARD TODOS (liste à cocher — disparaît 2 jours après complétion)
CREATE TABLE IF NOT EXISTS dashboard_todos (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ MODULES & EXTENSIONS v2 ═══

CREATE TABLE IF NOT EXISTS modules_config (
  id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_minutes INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on INT[];

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  phone TEXT,
  lead_days INT DEFAULT 7,
  notes TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_slug ON suppliers(slug) WHERE slug IS NOT NULL;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier_id);

CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'materiaux',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'unité',
  unit_cost NUMERIC(12,2) DEFAULT 0,
  location TEXT,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  min_level NUMERIC(12,3) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  title TEXT,
  notes TEXT,
  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  total NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INT REFERENCES purchase_orders(id) ON DELETE CASCADE,
  inventory_item_id INT REFERENCES inventory_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_cost NUMERIC(12,2) DEFAULT 0,
  received BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS project_materials (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE CASCADE,
  inventory_item_id INT REFERENCES inventory_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'unité',
  unit_cost NUMERIC(12,2) DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'artisan',
  hourly_rate NUMERIC(10,2) DEFAULT 25,
  skills JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  color TEXT DEFAULT '#D86B30',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  task_id INT REFERENCES tasks(id) ON DELETE SET NULL,
  shift_id INT REFERENCES shifts(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  notes TEXT,
  source TEXT DEFAULT 'manual',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_shift_unique
  ON time_entries(shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_time_entries_employee_started
  ON time_entries(employee_id, started_at DESC);

CREATE TABLE IF NOT EXISTS assistant_memories (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'preference',
  content TEXT NOT NULL,
  source TEXT DEFAULT 'user',
  project_id INT REFERENCES projects(id) ON DELETE CASCADE,
  client_id INT REFERENCES clients(id) ON DELETE CASCADE,
  quote_id INT REFERENCES quotes(id) ON DELETE CASCADE,
  confidence NUMERIC(3,2) DEFAULT 0.8,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assistant_feedback (
  id SERIAL PRIMARY KEY,
  message_id INT REFERENCES assistant_messages(id) ON DELETE CASCADE,
  rating INT,
  correction TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_audit_log (
  id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'general',
  action TEXT NOT NULL,
  resource TEXT,
  details JSONB DEFAULT '{}',
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  requires_confirm BOOLEAN DEFAULT false,
  confirmed BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS project_emails (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL UNIQUE,
  thread_id TEXT,
  subject TEXT,
  from_email TEXT,
  snippet TEXT,
  linked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_emails_project ON project_emails(project_id);

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
  mail_category TEXT,
  last_message_at TIMESTAMPTZ,
  message_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_email_threads_client ON email_threads(client_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_project ON email_threads(project_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_last_msg ON email_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_threads_category ON email_threads(mail_category);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON email_messages(thread_id);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_schedule ON tasks(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchase_orders(status);

-- Besoins d'achat atelier (consommables manquants, etc.)
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
);

CREATE INDEX IF NOT EXISTS idx_purchase_needs_status ON purchase_needs(status);
CREATE INDEX IF NOT EXISTS idx_purchase_needs_category ON purchase_needs(category);

-- Factures fournisseurs reçues par courriel (Home Depot, Rona, etc.)
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
  received_at TIMESTAMPTZ,
  suggested_amount NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_routing_rules (
  id SERIAL PRIMARY KEY,
  supplier_id TEXT NOT NULL DEFAULT 'any',
  keyword_pattern TEXT NOT NULL,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hit_count INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(supplier_id, keyword_pattern)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status ON supplier_invoice_emails(status);

-- Marketplace : ventes canaux (Etsy, FB Marketplace, Kijiji, site…)
CREATE TABLE IF NOT EXISTS marketplace_sales (
  id SERIAL PRIMARY KEY,
  sold_at DATE NOT NULL DEFAULT CURRENT_DATE,
  channel TEXT NOT NULL DEFAULT 'autre',
  product_name TEXT NOT NULL,
  buyer_name TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CAD',
  order_ref TEXT,
  notes TEXT,
  payment_method TEXT,
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  invoice_id INT REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id INT REFERENCES payments(id) ON DELETE SET NULL,
  expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_sales_sold_at ON marketplace_sales(sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_sales_channel ON marketplace_sales(channel);
ALTER TABLE marketplace_sales ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE marketplace_sales ADD COLUMN IF NOT EXISTS invoice_id INT REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE marketplace_sales ADD COLUMN IF NOT EXISTS payment_id INT REFERENCES payments(id) ON DELETE SET NULL;
ALTER TABLE marketplace_sales ADD COLUMN IF NOT EXISTS expense_id INT REFERENCES expenses(id) ON DELETE SET NULL;

-- Réseaux sociaux : calendrier éditorial cross-platform
CREATE TABLE IF NOT EXISTS social_posts (
  id SERIAL PRIMARY KEY,
  title TEXT,
  caption TEXT NOT NULL DEFAULT '',
  platforms TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  media JSONB NOT NULL DEFAULT '[]',
  metrics JSONB NOT NULL DEFAULT '{}',
  source TEXT DEFAULT 'manual',
  external_ids JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_at);

-- Paie (aperçu QuickBooks : périodes, lignes, tâches)
CREATE TABLE IF NOT EXISTS payroll_periods (
  id SERIAL PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (start_date, end_date)
);
CREATE TABLE IF NOT EXISTS payroll_lines (
  id SERIAL PRIMARY KEY,
  period_id INT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  hours_worked NUMERIC(10,2) NOT NULL DEFAULT 0,
  hours_scheduled NUMERIC(10,2) NOT NULL DEFAULT 0,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  advances NUMERIC(12,2) NOT NULL DEFAULT 0,
  net NUMERIC(12,2) NOT NULL DEFAULT 0,
  source_breakdown JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  UNIQUE (period_id, employee_id)
);
CREATE TABLE IF NOT EXISTS payroll_todos (
  id SERIAL PRIMARY KEY,
  period_id INT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  due_date DATE,
  link_href TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_todos_period ON payroll_todos(period_id);

CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_shifts_employee ON shifts(employee_id, start_at);
CREATE INDEX IF NOT EXISTS idx_memories_project ON assistant_memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_client ON assistant_memories(client_id);
CREATE INDEX IF NOT EXISTS idx_memories_quote ON assistant_memories(quote_id);

-- Admin créé au démarrage via init.js (ADMIN_PASSWORD)

-- SEED: default assistant skills
INSERT INTO assistant_skills (name, description, trigger_patterns, action_type, action_config) VALUES
  ('create_task', 'Créer une tâche de production', '["créer tâche", "ajouter tâche", "nouvelle tâche", "task"]', 'create_task', '{}'),
  ('create_project', 'Créer un nouveau projet', '["créer projet", "nouveau projet", "project"]', 'create_project', '{}'),
  ('schedule_task', 'Planifier une tâche au calendrier', '["planifier", "programmer", "calendrier", "demain", "lundi"]', 'schedule_task', '{}'),
  ('create_expense', 'Enregistrer une dépense', '["dépense", "acheté", "payé pour"]', 'create_expense', '{}'),
  ('list_today', 'Voir les tâches du jour', '["aujourd''hui", "tâches du jour", "planning jour"]', 'list_today', '{}'),
  ('create_client', 'Ajouter un client', '["nouveau client", "ajouter client", "client"]', 'create_client', '{}'),
  ('complete_task', 'Marquer tâche terminée', '["cocher", "marquer fait", "terminé", "complété", "fait"]', 'complete_task', '{}'),
  ('update_task', 'Modifier une tâche', '["modifier tâche", "renommer tâche", "mettre à jour tâche"]', 'update_task', '{}'),
  ('delete_task', 'Supprimer une tâche', '["supprimer tâche", "retirer tâche", "effacer tâche"]', 'delete_task', '{}'),
  ('list_project_tasks', 'Lister tâches du projet', '["liste tâches", "tâches du projet", "voir tâches"]', 'list_project_tasks', '{}'),
  ('update_project', 'Modifier le projet', '["modifier projet", "deadline", "budget projet", "statut projet"]', 'update_project', '{}'),
  ('update_client', 'Modifier le client', '["modifier client", "email client", "téléphone client"]', 'update_client', '{}'),
  ('list_projects', 'Lister les projets', '["liste projets", "mes projets", "voir projets"]', 'list_projects', '{}'),
  ('list_clients', 'Lister les clients', '["liste clients", "voir clients"]', 'list_clients', '{}'),
  ('list_expenses', 'Lister les dépenses', '["liste dépenses", "dépenses du projet", "voir dépenses"]', 'list_expenses', '{}'),
  ('list_skills', 'Lister les skills', '["liste skills", "capacités", "commandes disponibles", "skills"]', 'list_skills', '{}'),
  ('create_skill', 'Créer une skill', '["ajouter skill", "nouvelle skill", "nouvelle capacité"]', 'create_skill', '{}'),
  ('update_skill', 'Modifier une skill', '["activer skill", "désactiver skill", "modifier skill"]', 'update_skill', '{}')
ON CONFLICT (name) DO NOTHING;

-- SEED: standards importés via npm run db:seed-standards (fiches fabrication v1.1)
