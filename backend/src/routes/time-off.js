import { Router } from 'express';
import pool from '../db/pool.js';
import {
  canAccessCalendar,
  canEditTimeOff,
  canManageTeamCalendar,
  getUserAccount,
} from '../services/user-account.js';

const router = Router();

const TIME_OFF_TYPES = new Set(['vacation', 'sick', 'personal', 'other']);

function parseDateOnly(val) {
  if (!val) return null;
  const m = String(val).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function allDayRange(startDate, endDate) {
  const endExclusive = new Date(`${endDate}T12:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return {
    start_at: new Date(`${startDate}T00:00:00`).toISOString(),
    end_at: new Date(`${endExclusive.toISOString().slice(0, 10)}T00:00:00`).toISOString(),
  };
}

function toFormDates(row) {
  const start = row.start_at ? new Date(row.start_at) : null;
  const end = row.end_at ? new Date(row.end_at) : null;
  if (!start || !end) return { start_date: '', end_date: '' };
  const startStr = start.toISOString().slice(0, 10);
  const endInclusive = new Date(end);
  endInclusive.setDate(endInclusive.getDate() - 1);
  return { start_date: startStr, end_date: endInclusive.toISOString().slice(0, 10) };
}

router.use(async (req, res, next) => {
  try {
    req.account = await getUserAccount(req);
    if (!canAccessCalendar(req.account)) {
      return res.status(403).json({ error: 'Permission calendrier requise' });
    }
    next();
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { from, to, employee_id } = req.query;
    let q = `
      SELECT t.*, e.name AS employee_name, e.color
      FROM time_off t
      JOIN employees e ON e.id = t.employee_id
      WHERE 1=1
    `;
    const params = [];
    if (from) { params.push(from); q += ` AND t.end_at >= $${params.length}`; }
    if (to) { params.push(to); q += ` AND t.start_at <= $${params.length}`; }
    if (employee_id) { params.push(employee_id); q += ` AND t.employee_id = $${params.length}`; }
    q += ' ORDER BY t.start_at';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.*, e.name AS employee_name, e.color
      FROM time_off t
      JOIN employees e ON e.id = t.employee_id
      WHERE t.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Congé introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const user = req.account;
    const startDate = parseDateOnly(req.body.start_date);
    const endDate = parseDateOnly(req.body.end_date) || startDate;
    if (!startDate) return res.status(400).json({ error: 'Date de début requise' });
    if (endDate < startDate) return res.status(400).json({ error: 'La date de fin doit être après le début' });

    let employeeId = req.body.employee_id ? Number(req.body.employee_id) : null;
    if (canManageTeamCalendar(user) && employeeId) {
      // admin / team manager peut choisir l'employé
    } else if (user.employee_id) {
      employeeId = Number(user.employee_id);
    } else {
      return res.status(400).json({
        error: 'Votre compte n\'est pas lié à un profil employé — demandez à un admin dans Paramètres → Utilisateurs.',
      });
    }

    const type = TIME_OFF_TYPES.has(req.body.type) ? req.body.type : 'vacation';
    const range = allDayRange(startDate, endDate);

    const { rows } = await pool.query(
      `INSERT INTO time_off (employee_id, start_at, end_at, all_day, type, notes, created_by)
       VALUES ($1, $2, $3, true, $4, $5, $6) RETURNING *`,
      [employeeId, range.start_at, range.end_at, type, req.body.notes || null, user.id]
    );

    const { rows: full } = await pool.query(`
      SELECT t.*, e.name AS employee_name, e.color
      FROM time_off t JOIN employees e ON e.id = t.employee_id WHERE t.id = $1
    `, [rows[0].id]);
    res.status(201).json(full[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const user = req.account;
    const { rows: existing } = await pool.query('SELECT * FROM time_off WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Congé introuvable' });
    if (!canEditTimeOff(user, existing[0])) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres congés' });
    }

    const row = existing[0];
    const startDate = parseDateOnly(req.body.start_date) || toFormDates(row).start_date;
    const endDate = parseDateOnly(req.body.end_date) || toFormDates(row).end_date;
    const range = allDayRange(startDate, endDate);

    let employeeId = row.employee_id;
    if (canManageTeamCalendar(user) && req.body.employee_id) {
      employeeId = Number(req.body.employee_id);
    }

    const type = req.body.type && TIME_OFF_TYPES.has(req.body.type) ? req.body.type : row.type;

    const { rows } = await pool.query(
      `UPDATE time_off SET employee_id=$1, start_at=$2, end_at=$3, type=$4, notes=$5
       WHERE id=$6 RETURNING *`,
      [
        employeeId,
        range.start_at,
        range.end_at,
        type,
        req.body.notes !== undefined ? req.body.notes : row.notes,
        req.params.id,
      ]
    );

    const { rows: full } = await pool.query(`
      SELECT t.*, e.name AS employee_name, e.color
      FROM time_off t JOIN employees e ON e.id = t.employee_id WHERE t.id = $1
    `, [rows[0].id]);
    res.json(full[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const user = req.account;
    const { rows } = await pool.query('SELECT * FROM time_off WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Congé introuvable' });
    if (!canEditTimeOff(user, rows[0])) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres congés' });
    }
    await pool.query('DELETE FROM time_off WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
