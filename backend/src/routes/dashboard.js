import { Router } from 'express';
import pool from '../db/pool.js';
import { getWebStatus } from '../services/wordpress.js';
import { computeProjectCostsBatch } from '../services/project-costs.js';
import { syncAdminTasksFromModules } from '../services/admin-task-sync.js';
import { scanInboxForSupplierInvoices } from '../services/invoice-email-router.js';

const router = Router();

async function purgeExpiredTodos() {
  await pool.query(`
    DELETE FROM dashboard_todos
    WHERE done = TRUE AND completed_at IS NOT NULL
      AND completed_at < NOW() - INTERVAL '2 days'
  `);
}

async function listVisibleTodos(listKey = null) {
  await purgeExpiredTodos();
  if (listKey) {
    const { rows } = await pool.query(`
      SELECT * FROM dashboard_todos
      WHERE list_key = $1
        AND (NOT done OR completed_at IS NULL OR completed_at >= NOW() - INTERVAL '2 days')
      ORDER BY done ASC, sort_order ASC, created_at ASC
    `, [listKey]);
    return rows;
  }
  const { rows } = await pool.query(`
    SELECT * FROM dashboard_todos
    WHERE NOT done OR completed_at IS NULL OR completed_at >= NOW() - INTERVAL '2 days'
    ORDER BY list_key ASC, done ASC, sort_order ASC, created_at ASC
  `);
  return rows;
}

router.get('/', async (req, res) => {
  try {
    const [
      projectStats,
      tasksToday,
      tasksWeek,
      unscheduled,
      pendingInvoices,
      invoiceDue,
      pendingQuotes,
      expensesMonth,
      clientsCount,
      urgentProjects,
      activeProjectsList,
      webOrdersRecent,
      webStatus,
      todos,
      tasksByStatus,
      adminTasks,
      adminTasksSummary,
      supplierInvoicesPending,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
          COUNT(*) FILTER (WHERE status = 'done')::int AS done,
          COUNT(*) FILTER (WHERE status = 'active' AND deadline IS NOT NULL AND deadline < CURRENT_DATE)::int AS overdue,
          COUNT(*) FILTER (WHERE status = 'active' AND deadline BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days')::int AS due_soon,
          COALESCE(SUM(budget_estimated) FILTER (WHERE status = 'active'), 0)::float AS budget_active
        FROM projects
      `),
      pool.query(`
        SELECT t.*, p.name AS project_name, p.id AS project_id
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE (DATE(t.start_time) = CURRENT_DATE OR (t.start_time IS NULL AND t.status != 'done'))
        ORDER BY t.start_time NULLS LAST, t.sort_order
        LIMIT 12
      `),
      pool.query(`
        SELECT t.*, p.name AS project_name
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.start_time IS NOT NULL
          AND t.start_time >= CURRENT_DATE
          AND t.start_time < CURRENT_DATE + INTERVAL '7 days'
          AND t.status != 'done'
        ORDER BY t.start_time
        LIMIT 15
      `),
      pool.query(`
        SELECT COUNT(*)::int AS count FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.start_time IS NULL AND t.status != 'done'
          AND (p.standard_id IS NOT NULL OR t.project_id IS NULL)
      `),
      pool.query(`
        SELECT i.*, c.name AS client_name
        FROM invoices i
        LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.status IN ('sent', 'partially_paid', 'overdue')
        ORDER BY i.due_date NULLS LAST, i.created_at DESC
        LIMIT 8
      `),
      pool.query(`
        SELECT COALESCE(SUM(total - amount_paid), 0)::float AS due
        FROM invoices
        WHERE status IN ('sent', 'partially_paid', 'overdue')
      `),
      pool.query(`
        SELECT q.*, c.name AS client_name
        FROM quotes q
        LEFT JOIN clients c ON c.id = q.client_id
        WHERE q.status IN ('draft', 'sent')
        ORDER BY q.created_at DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT COALESCE(SUM(amount), 0)::float AS total
        FROM expenses
        WHERE date >= date_trunc('month', CURRENT_DATE::timestamp)
      `),
      pool.query('SELECT COUNT(*)::int AS count FROM clients'),
      pool.query(`
        SELECT p.*, c.name AS client_name
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.status = 'active'
          AND p.deadline IS NOT NULL
          AND p.deadline <= CURRENT_DATE + INTERVAL '14 days'
        ORDER BY p.deadline
        LIMIT 8
      `),
      pool.query(`
        SELECT p.*, c.name AS client_name,
          (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status != 'done') AS tasks_open,
          (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id AND status = 'done') AS tasks_done
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.status = 'active'
        ORDER BY p.priority DESC, p.production_priority DESC, p.deadline NULLS LAST, p.created_at DESC
        LIMIT 12
      `),
      pool.query(`
        SELECT w.*, p.name AS project_name
        FROM web_orders w
        LEFT JOIN projects p ON p.id = w.project_id
        ORDER BY w.synced_at DESC
        LIMIT 4
      `).catch(() => ({ rows: [] })),
      getWebStatus().catch(() => null),
      listVisibleTodos(),
      pool.query(`
        SELECT status, COUNT(*)::int AS count
        FROM tasks
        WHERE status != 'done'
        GROUP BY status
      `),
      pool.query(`
        SELECT * FROM admin_tasks
        WHERE status != 'done'
        ORDER BY due_date NULLS LAST, sort_order ASC
        LIMIT 6
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status != 'done')::int AS open,
          COUNT(*) FILTER (WHERE status != 'done' AND due_date < CURRENT_DATE)::int AS overdue
        FROM admin_tasks
      `),
      pool.query(`
        SELECT COUNT(*)::int AS count FROM supplier_invoice_emails WHERE status = 'pending'
      `).catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    const ps = projectStats.rows[0];
    const projectIds = activeProjectsList.rows.map(p => p.id);
    const costsMap = projectIds.length ? await computeProjectCostsBatch(projectIds) : {};
    const projectCards = activeProjectsList.rows.map(p => ({
      ...p,
      costs: costsMap[p.id] || null,
      progress_pct: costsMap[p.id]?.progress_pct ?? (p.tasks_done + p.tasks_open
        ? Math.round((p.tasks_done / (p.tasks_done + p.tasks_open)) * 100) : 0),
    }));
    const alerts = [];
    if (ps.overdue > 0) alerts.push({ type: 'danger', text: `${ps.overdue} projet(s) en retard`, href: '/projects' });
    if (invoiceDue.rows[0].due > 0) alerts.push({ type: 'warning', text: `${Number(invoiceDue.rows[0].due).toFixed(0)} $ à recevoir`, href: '/invoices' });
    if (unscheduled.rows[0].count > 0) alerts.push({ type: 'info', text: `${unscheduled.rows[0].count} tâche(s) à planifier`, href: '/calendar' });
    if (pendingQuotes.rows.length > 0) alerts.push({ type: 'info', text: `${pendingQuotes.rows.length} devis en cours`, href: '/invoices' });
    const adminOpen = adminTasksSummary.rows[0]?.open || 0;
    const adminOverdue = adminTasksSummary.rows[0]?.overdue || 0;
    if (adminOverdue > 0) alerts.push({ type: 'warning', text: `${adminOverdue} tâche(s) admin en retard`, href: '/admin' });
    else if (adminOpen > 0) alerts.push({ type: 'info', text: `${adminOpen} tâche(s) admin à faire`, href: '/admin' });
    const supplierPending = supplierInvoicesPending.rows[0]?.count || 0;
    if (supplierPending > 0) alerts.push({ type: 'warning', text: `${supplierPending} facture(s) fournisseur à classer`, href: '/mail' });

    syncAdminTasksFromModules().catch(() => {});
    scanInboxForSupplierInvoices().catch(() => {});

    res.json({
      stats: {
        activeProjects: ps.active,
        pausedProjects: ps.paused,
        overdueProjects: ps.overdue,
        dueSoonProjects: ps.due_soon,
        budgetActive: ps.budget_active,
        clients: clientsCount.rows[0].count,
        unscheduledTasks: unscheduled.rows[0].count,
        invoicesDue: invoiceDue.rows[0].due,
        expensesMonth: expensesMonth.rows[0].total,
        todosPending: todos.filter(t => !t.done).length,
        adminTasksOpen: adminOpen,
        adminTasksOverdue: adminOverdue,
      },
      alerts,
      tasksToday: tasksToday.rows,
      tasksWeek: tasksWeek.rows,
      pendingInvoices: pendingInvoices.rows,
      pendingQuotes: pendingQuotes.rows,
      urgentProjects: urgentProjects.rows,
      activeProjects: projectCards,
      projectCards,
      webOrders: webOrdersRecent.rows,
      tasksByStatus: tasksByStatus.rows,
      web: webStatus,
      todos,
      adminTasks: adminTasks.rows,
      activeProjectsCount: ps.active,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/todos', async (req, res) => {
  try {
    res.json(await listVisibleTodos());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/todos', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const listKey = String(req.body.list_key || 'main').trim() || 'main';
    if (!title) return res.status(400).json({ error: 'Titre requis' });
    const { rows } = await pool.query(
      `INSERT INTO dashboard_todos (title, list_key, sort_order)
       VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM dashboard_todos WHERE list_key = $2), 0))
       RETURNING *`,
      [title, listKey]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/todos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { done, title } = req.body;

    if (typeof done === 'boolean') {
      const { rows } = await pool.query(
        `UPDATE dashboard_todos
         SET done = $1, completed_at = CASE WHEN $1 THEN NOW() ELSE NULL END
         WHERE id = $2 RETURNING *`,
        [done, id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Todo introuvable' });
      return res.json(rows[0]);
    }

    if (title !== undefined) {
      const trimmed = String(title).trim();
      if (!trimmed) return res.status(400).json({ error: 'Titre requis' });
      const { rows } = await pool.query(
        'UPDATE dashboard_todos SET title = $1 WHERE id = $2 RETURNING *',
        [trimmed, id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Todo introuvable' });
      return res.json(rows[0]);
    }

    res.status(400).json({ error: 'Aucune modification' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/todos/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM dashboard_todos WHERE id = $1', [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Todo introuvable' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
