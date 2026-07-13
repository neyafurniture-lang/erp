import pool from '../db/pool.js';

/** Calcule le coût de revient et la rentabilité d'un projet en temps réel */
export async function computeProjectCosts(projectId) {
  const { rows: projects } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  const project = projects[0];
  if (!project) return null;

  const [
    materials,
    expenses,
    labor,
    invoices,
    quotes,
  ] = await Promise.all([
    pool.query(
      'SELECT COALESCE(SUM(quantity * unit_cost), 0)::float AS total FROM project_materials WHERE project_id = $1',
      [projectId]
    ),
    pool.query(
      'SELECT COALESCE(SUM(amount), 0)::float AS total FROM expenses WHERE project_id = $1',
      [projectId]
    ),
    pool.query(`
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (COALESCE(te.ended_at, te.started_at) - te.started_at)) / 3600.0 * e.hourly_rate
      ), 0)::float AS total
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      WHERE te.project_id = $1
    `, [projectId]).catch(() => ({ rows: [{ total: 0 }] })),
    pool.query(
      `SELECT COALESCE(SUM(total), 0)::float AS total, COALESCE(SUM(amount_paid), 0)::float AS paid
       FROM invoices WHERE project_id = $1 AND status != 'draft'`,
      [projectId]
    ),
    pool.query(
      'SELECT COALESCE(SUM(total), 0)::float AS total FROM quotes WHERE project_id = $1 AND status = \'accepted\'',
      [projectId]
    ),
  ]);

  const materialsCost = materials.rows[0]?.total || 0;
  const expensesCost = expenses.rows[0]?.total || 0;
  const laborCost = labor.rows[0]?.total || 0;
  const costTotal = materialsCost + expensesCost + laborCost + Number(project.budget_real || 0);

  const salePrice = Number(project.sale_price || 0)
    || Number(invoices.rows[0]?.total || 0)
    || Number(quotes.rows[0]?.total || 0)
    || Number(project.budget_estimated || 0);

  const margin = salePrice - costTotal;
  const marginPct = salePrice > 0 ? (margin / salePrice) * 100 : 0;

  const { rows: tasks } = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'done')::int AS done,
      COALESCE(SUM(estimated_minutes) FILTER (WHERE estimated_minutes IS NOT NULL), 0)::int AS minutes_estimated,
      COALESCE(SUM(actual_minutes) FILTER (WHERE actual_minutes IS NOT NULL), 0)::int AS minutes_actual
     FROM tasks WHERE project_id = $1`,
    [projectId]
  );

  const t = tasks[0] || {};
  const progressPct = t.total ? Math.round((t.done / t.total) * 100) : 0;

  return {
    project_id: projectId,
    materials: materialsCost,
    expenses: expensesCost,
    labor: laborCost,
    cost_total: costTotal,
    sale_price: salePrice,
    margin,
    margin_pct: Math.round(marginPct * 10) / 10,
    profit_estimated: margin,
    minutes_estimated: t.minutes_estimated,
    minutes_actual: t.minutes_actual,
    progress_pct: progressPct,
    tasks_done: t.done,
    tasks_total: t.total,
  };
}

export async function computeProjectCostsBatch(projectIds) {
  const results = {};
  for (const id of projectIds) {
    results[id] = await computeProjectCosts(id);
  }
  return results;
}
