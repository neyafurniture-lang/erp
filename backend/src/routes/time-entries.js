import { Router } from 'express';
import pool from '../db/pool.js';
import {
  canAccessHours,
  canEditTimeEntry,
  canManageTeamCalendar,
  getUserAccount,
} from '../services/user-account.js';
import { ensureTimeEntriesColumns } from '../services/time-entries-schema.js';

const router = Router();

function parseIso(val) {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function hoursBetween(startIso, endIso) {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 3600000) * 100) / 100;
}

async function fetchEntry(id) {
  const { rows } = await pool.query(`
    SELECT te.*,
           e.name AS employee_name, e.color AS employee_color,
           p.name AS project_name,
           sh.start_at AS shift_start_at, sh.end_at AS shift_end_at
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN shifts sh ON sh.id = te.shift_id
    WHERE te.id = $1
  `, [id]);
  return rows[0] || null;
}

router.use(async (req, res, next) => {
  try {
    await ensureTimeEntriesColumns();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  try {
    req.account = await getUserAccount(req);
    if (!canAccessHours(req.account)) {
      return res.status(403).json({ error: 'Accès aux heures / shifts requis' });
    }
    next();
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const user = req.account;
    const { from, to, employee_id, project_id } = req.query;
    let q = `
      SELECT te.*,
             e.name AS employee_name, e.color AS employee_color,
             p.name AS project_name,
             EXTRACT(EPOCH FROM (COALESCE(te.ended_at, te.started_at) - te.started_at)) / 3600.0 AS hours
      FROM time_entries te
      JOIN employees e ON e.id = te.employee_id
      LEFT JOIN projects p ON p.id = te.project_id
      WHERE 1=1
    `;
    const params = [];

    if (!canManageTeamCalendar(user)) {
      if (!user.employee_id) {
        return res.status(400).json({
          error: 'Votre compte n\'est pas lié à un profil employé — demandez à un admin dans Paramètres → Utilisateurs.',
        });
      }
      params.push(Number(user.employee_id));
      q += ` AND te.employee_id = $${params.length}`;
    } else if (employee_id) {
      params.push(Number(employee_id));
      q += ` AND te.employee_id = $${params.length}`;
    }

    if (from) { params.push(from); q += ` AND COALESCE(te.ended_at, te.started_at) >= $${params.length}`; }
    if (to) { params.push(to); q += ` AND te.started_at <= $${params.length}`; }
    if (project_id) { params.push(Number(project_id)); q += ` AND te.project_id = $${params.length}`; }

    q += ' ORDER BY te.started_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows.map(r => ({ ...r, hours: Number(r.hours) || 0 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Shifts planifiés sans pointage associé (à confirmer / inscrire). */
router.get('/pending-shifts', async (req, res) => {
  try {
    const user = req.account;
    const { from, to, employee_id } = req.query;
    let q = `
      SELECT sh.*, e.name AS employee_name, e.color, p.name AS project_name,
             EXTRACT(EPOCH FROM (sh.end_at - sh.start_at)) / 3600.0 AS planned_hours
      FROM shifts sh
      JOIN employees e ON e.id = sh.employee_id
      LEFT JOIN projects p ON p.id = sh.project_id
      WHERE NOT EXISTS (
        SELECT 1 FROM time_entries te WHERE te.shift_id = sh.id
      )
    `;
    const params = [];

    if (!canManageTeamCalendar(user)) {
      if (!user.employee_id) {
        return res.status(400).json({
          error: 'Votre compte n\'est pas lié à un profil employé — demandez à un admin dans Paramètres → Utilisateurs.',
        });
      }
      params.push(Number(user.employee_id));
      q += ` AND sh.employee_id = $${params.length}`;
    } else if (employee_id) {
      params.push(Number(employee_id));
      q += ` AND sh.employee_id = $${params.length}`;
    }

    if (from) { params.push(from); q += ` AND sh.end_at >= $${params.length}`; }
    if (to) { params.push(to); q += ` AND sh.start_at <= $${params.length}`; }

    q += ' ORDER BY sh.start_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows.map(r => ({ ...r, planned_hours: Number(r.planned_hours) || 0 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await fetchEntry(req.params.id);
    if (!row) return res.status(404).json({ error: 'Entrée introuvable' });
    if (!canEditTimeEntry(req.account, row) && !canManageTeamCalendar(req.account)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    res.json({ ...row, hours: hoursBetween(row.started_at, row.ended_at || row.started_at) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const user = req.account;
    const startedAt = parseIso(req.body.started_at);
    const endedAt = parseIso(req.body.ended_at);
    if (!startedAt) return res.status(400).json({ error: 'Heure de début requise' });
    if (!endedAt) return res.status(400).json({ error: 'Heure de fin requise' });
    if (new Date(endedAt) <= new Date(startedAt)) {
      return res.status(400).json({ error: 'La fin doit être après le début' });
    }

    let employeeId = req.body.employee_id ? Number(req.body.employee_id) : null;
    if (canManageTeamCalendar(user) && employeeId) {
      // ok
    } else if (user.employee_id) {
      employeeId = Number(user.employee_id);
    } else {
      return res.status(400).json({
        error: 'Votre compte n\'est pas lié à un profil employé — demandez à un admin dans Paramètres → Utilisateurs.',
      });
    }

    let shiftId = req.body.shift_id ? Number(req.body.shift_id) : null;
    let projectId = req.body.project_id !== undefined && req.body.project_id !== ''
      ? Number(req.body.project_id)
      : null;
    let notes = req.body.notes || null;

    if (shiftId) {
      const { rows: shifts } = await pool.query('SELECT * FROM shifts WHERE id = $1', [shiftId]);
      const shift = shifts[0];
      if (!shift) return res.status(404).json({ error: 'Shift introuvable' });
      if (!canManageTeamCalendar(user) && Number(shift.employee_id) !== employeeId) {
        return res.status(403).json({ error: 'Ce shift ne vous appartient pas' });
      }
      const { rows: existing } = await pool.query(
        'SELECT id FROM time_entries WHERE shift_id = $1 LIMIT 1',
        [shiftId]
      );
      if (existing[0]) {
        return res.status(409).json({ error: 'Ce shift est déjà inscrit', time_entry_id: existing[0].id });
      }
      employeeId = Number(shift.employee_id);
      if (projectId == null) projectId = shift.project_id;
      if (!notes && shift.notes) notes = shift.notes;
    }

    const source = shiftId ? 'shift' : (req.body.source || 'manual');

    const { rows } = await pool.query(
      `INSERT INTO time_entries (employee_id, project_id, task_id, started_at, ended_at, notes, shift_id, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        employeeId,
        projectId || null,
        req.body.task_id ? Number(req.body.task_id) : null,
        startedAt,
        endedAt,
        notes,
        shiftId,
        source,
        user.id,
      ]
    );

    const full = await fetchEntry(rows[0].id);
    res.status(201).json({ ...full, hours: hoursBetween(full.started_at, full.ended_at) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await fetchEntry(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Entrée introuvable' });
    if (!canEditTimeEntry(req.account, existing)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const startedAt = req.body.started_at !== undefined
      ? parseIso(req.body.started_at)
      : existing.started_at;
    const endedAt = req.body.ended_at !== undefined
      ? parseIso(req.body.ended_at)
      : existing.ended_at;

    if (!startedAt || !endedAt) return res.status(400).json({ error: 'Début et fin requis' });
    if (new Date(endedAt) <= new Date(startedAt)) {
      return res.status(400).json({ error: 'La fin doit être après le début' });
    }

    let employeeId = existing.employee_id;
    if (canManageTeamCalendar(req.account) && req.body.employee_id) {
      employeeId = Number(req.body.employee_id);
    }

    const projectId = req.body.project_id !== undefined
      ? (req.body.project_id ? Number(req.body.project_id) : null)
      : existing.project_id;

    await pool.query(
      `UPDATE time_entries
       SET employee_id=$1, project_id=$2, started_at=$3, ended_at=$4, notes=$5
       WHERE id=$6`,
      [
        employeeId,
        projectId,
        startedAt,
        endedAt,
        req.body.notes !== undefined ? (req.body.notes || null) : existing.notes,
        req.params.id,
      ]
    );

    const full = await fetchEntry(req.params.id);
    res.json({ ...full, hours: hoursBetween(full.started_at, full.ended_at) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await fetchEntry(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Entrée introuvable' });
    if (!canEditTimeEntry(req.account, existing)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    await pool.query('DELETE FROM time_entries WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
