import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateSecurityConfig } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { erpActivityMiddleware } from './middleware/erp-activity.js';
import { securityHeaders, uploadAuth, rateLimit } from './middleware/security.js';
import { initDb } from './db/init.js';
import { getVersionInfo } from './version.js';
import { getDeployCapabilities } from './services/deploy-diagnostics.js';

import authRoutes from './routes/auth.js';
import clientsRoutes from './routes/clients.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import invoicesRoutes from './routes/invoices.js';
import paymentsRoutes from './routes/payments.js';
import expensesRoutes from './routes/expenses.js';
import standardsRoutes from './routes/standards.js';
import dashboardRoutes from './routes/dashboard.js';
import assistantRoutes from './routes/assistant.js';
import settingsRoutes from './routes/settings.js';
import wordpressRoutes from './routes/wordpress.js';
import productionRoutes from './routes/production.js';
import modulesRoutes from './routes/modules.js';
import inventoryRoutes from './routes/inventory.js';
import suppliersRoutes from './routes/suppliers.js';
import purchasesRoutes from './routes/purchases.js';
import employeesRoutes from './routes/employees.js';
import shiftsRoutes from './routes/shifts.js';
import analyticsRoutes from './routes/analytics.js';
import usersRoutes from './routes/users.js';
import adminTasksRoutes from './routes/admin-tasks.js';
import supplierInvoicesRoutes from './routes/supplier-invoices.js';
import receiptsRoutes from './routes/receipts.js';
import uiRoutes from './routes/ui.js';
import cursorAgentRoutes from './routes/cursor-agent.js';
import manualRoutes from './routes/manual.js';
import atelierHabitsRoutes from './routes/atelier-habits.js';
import integrationsRoutes, { handleGoogleCallback, handleMetaCallback, handlePinterestCallback } from './routes/integrations.js';
import googleDriveRoutes from './routes/google-drive.js';
import googleGmailRoutes from './routes/google-gmail.js';
import emailThreadsRoutes from './routes/email-threads.js';
import deployRoutes from './routes/deploy.js';
import timeOffRoutes from './routes/time-off.js';
import timeEntriesRoutes from './routes/time-entries.js';
import financeSyncRoutes from './routes/finance-sync.js';
import saunaCloudRoutes from './routes/sauna-cloud.js';
import cuttingPlansRoutes from './routes/cutting-plans.js';
import marketplaceRoutes from './routes/marketplace.js';
import socialRoutes from './routes/social.js';
import payrollRoutes from './routes/payroll.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4001;

validateSecurityConfig();

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors({
  origin(origin, cb) {
    // Same-origin / apps natives / reverse proxy : pas d'Origin ou Origin autorisée
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // Autoriser aussi si l'Origin correspond à l'hôte FRONTEND_URL (http/https)
    try {
      const originHost = new URL(origin).host;
      const ok = allowedOrigins.some((o) => {
        try { return new URL(o).host === originHost; } catch { return false; }
      });
      if (ok) return cb(null, true);
    } catch { /* ignore */ }
    return cb(new Error('Origine non autorisée'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 200 }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'NEYA ERP API',
    ...getVersionInfo(),
    capabilities: getDeployCapabilities(),
  });
});

// Fichiers uploadés — accès authentifié uniquement
app.use('/uploads', uploadAuth, express.static(path.join(__dirname, '../uploads'), {
  dotfiles: 'deny',
  index: false,
}));

app.use('/api/auth', authRoutes);

// OAuth Google / Meta / Pinterest — callbacks publics (sans JWT)
app.get('/api/integrations/google/callback', handleGoogleCallback);
app.get('/api/integrations/meta/callback', handleMetaCallback);
app.get('/api/integrations/pinterest/callback', handlePinterestCallback);

const protectedRouter = express.Router();
protectedRouter.use(authMiddleware);
protectedRouter.use(erpActivityMiddleware);
protectedRouter.use('/clients', clientsRoutes);
protectedRouter.use('/projects', projectsRoutes);
protectedRouter.use('/tasks', tasksRoutes);
protectedRouter.use('/invoices', invoicesRoutes);
protectedRouter.use('/payments', paymentsRoutes);
protectedRouter.use('/expenses', expensesRoutes);
protectedRouter.use('/standards', standardsRoutes);
protectedRouter.use('/dashboard', dashboardRoutes);
protectedRouter.use('/assistant', assistantRoutes);
protectedRouter.use('/settings', settingsRoutes);
protectedRouter.use('/wordpress', wordpressRoutes);
protectedRouter.use('/production', productionRoutes);
protectedRouter.use('/modules', modulesRoutes);
protectedRouter.use('/inventory', inventoryRoutes);
protectedRouter.use('/suppliers', suppliersRoutes);
protectedRouter.use('/purchases', purchasesRoutes);
protectedRouter.use('/employees', employeesRoutes);
protectedRouter.use('/shifts', shiftsRoutes);
protectedRouter.use('/time-off', timeOffRoutes);
protectedRouter.use('/time-entries', timeEntriesRoutes);
protectedRouter.use('/finance-sync', financeSyncRoutes);
protectedRouter.use('/analytics', analyticsRoutes);
protectedRouter.use('/integrations', integrationsRoutes);
protectedRouter.use('/drive', googleDriveRoutes);
protectedRouter.use('/gmail', googleGmailRoutes);
protectedRouter.use('/email-threads', emailThreadsRoutes);
protectedRouter.use('/users', usersRoutes);
protectedRouter.use('/admin-tasks', adminTasksRoutes);
protectedRouter.use('/supplier-invoices', supplierInvoicesRoutes);
protectedRouter.use('/receipts', receiptsRoutes);
protectedRouter.use('/deploy', deployRoutes);
protectedRouter.use('/ui', uiRoutes);
protectedRouter.use('/cursor-agent', cursorAgentRoutes);
protectedRouter.use('/manual', manualRoutes);
protectedRouter.use('/habits', atelierHabitsRoutes);
protectedRouter.use('/sauna-cloud', saunaCloudRoutes);
protectedRouter.use('/cutting-plans', cuttingPlansRoutes);
protectedRouter.use('/marketplace', marketplaceRoutes);
protectedRouter.use('/social', socialRoutes);
protectedRouter.use('/payroll', payrollRoutes);

app.use('/api', protectedRouter);

app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Fichier trop volumineux' });
  }
  if (err?.message?.includes('non autorisé') || err?.message?.includes('non supporté')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.use((err, _req, res, _next) => {
  if (err.message === 'Origine non autorisée') {
    return res.status(403).json({ error: 'Accès refusé (CORS)' });
  }
  console.error(err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Erreur serveur' : err.message,
  });
});

async function start() {
  try {
    await initDb();
    console.log('Database initialized');
  } catch (err) {
    console.warn('DB init warning:', err.message);
  }
  app.listen(PORT, () => console.log(`NEYA ERP API → http://localhost:${PORT}`));
}

start();
