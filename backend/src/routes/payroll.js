import { Router } from 'express';
import pool from '../db/pool.js';
import { isAdmin, hasPermission } from '../config/permissions.js';
import {
  computePayrollOverview,
  updatePayrollLine,
  setPayrollPeriodStatus,
  togglePayrollTodo,
  addPayrollTodo,
  resolvePayPeriod,
  shiftPeriod,
} from '../services/payroll.js';

const router = Router();

async function loadUser(req) {
  const { rows } = await pool.query(
    'SELECT id, role, permissions, active FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0] || rows[0].active === false) throw new Error('Compte désactivé');
  return rows[0];
}

router.use(async (req, res, next) => {
  try {
    const user = await loadUser(req);
    req.account = user;
    if (
      isAdmin(user)
      || hasPermission(user, 'finance')
      || hasPermission(user, 'team')
      || hasPermission(user, 'payroll')
    ) {
      return next();
    }
    return res.status(403).json({ error: 'Accès paie requis (finance ou équipe)' });
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
});

router.get('/period', async (req, res) => {
  try {
    let start = req.query.start;
    let end = req.query.end;
    if (!start || !end) {
      const p = resolvePayPeriod(req.query.date ? new Date(req.query.date) : new Date());
      start = p.start;
      end = p.end;
    }
    const data = await computePayrollOverview({ start, end });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/period/navigate', async (req, res) => {
  try {
    const dir = Number(req.query.dir) || -1;
    const start = req.query.start || resolvePayPeriod().start;
    const next = shiftPeriod(start, dir);
    const data = await computePayrollOverview({ start: next.start, end: next.end });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/periods/:id/status', async (req, res) => {
  try {
    const period = await setPayrollPeriodStatus(Number(req.params.id), req.body.status);
    res.json(period);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/lines/:periodId/:employeeId', async (req, res) => {
  try {
    const line = await updatePayrollLine(
      Number(req.params.periodId),
      Number(req.params.employeeId),
      req.body || {}
    );
    res.json(line);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/todos/:id', async (req, res) => {
  try {
    const todo = await togglePayrollTodo(Number(req.params.id), req.body.done);
    res.json(todo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/todos', async (req, res) => {
  try {
    const todo = await addPayrollTodo(Number(req.body.period_id), req.body);
    res.status(201).json(todo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
