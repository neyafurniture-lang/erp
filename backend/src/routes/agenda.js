import { Router } from 'express';
import pool from '../db/pool.js';
import { applyHoursLogbookToMeta } from '../services/hours-logbook.js';
import {
  assembleAgendaBlocks,
  buildLogbookWithAppendedRow,
  buildLogbookWithoutRow,
  buildLogbookWithRowPatch,
  findLogbookLink,
  hoursBetweenHm,
  hmToMinutes,
  parseProjectMeta,
  rowMatchesPerson,
} from '../services/agenda-blocks.js';
import { ensureTimeEntriesColumns } from '../services/time-entries-schema.js';
import {
  canEditTimeEntry,
  canManageTeamCalendar,
  getUserAccount,
} from '../services/user-account.js';

const router = Router();

function parseIso(val) {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseBlockId(id) {
  const log = String(id || '').match(/^log:(\d+):(\d+)$/);
  if (log) return { kind: 'log', projectId: Number(log[1]), rowIndex: Number(log[2]) };
  const entry = String(id || '').match(/^entry:(\d+)$/);
  if (entry) return { kind: 'entry', entryId: Number(entry[1]) };
  return null;
}

function readSlot(body) {
  const date = String(body?.date || '').slice(0, 10);
  const start = String(body?.start || '').slice(0, 5);
  const end = String(body?.end || '').slice(0, 5);
  const startedAt = parseIso(body?.started_at);
  const endedAt = parseIso(body?.ended_at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'Date requise' };
  }
  if (hmToMinutes(start) == null || hmToMinutes(end) == null || hoursBetweenHm(start, end) <= 0) {
    return { error: 'Le créneau doit avoir une fin après le début' };
  }
  if (!startedAt || !endedAt || new Date(endedAt) <= new Date(startedAt)) {
    return { error: 'Horodatage de début et de fin requis' };
  }
  return {
    date,
    start,
    end,
    startedAt,
    endedAt,
    hours: hoursBetweenHm(start, end),
    label: body?.label != null ? String(body.label) : '',
    notes: body?.notes != null ? String(body.notes) : '',
    projectId: body?.project_id ? Number(body.project_id) : null,
  };
}

async function writeLogbook(client, projectId, incoming, { allowClear = false } = {}) {
  const { rows } = await client.query(
    'SELECT id, meta FROM projects WHERE id = $1 FOR UPDATE',
    [projectId]
  );
  if (!rows[0]) {
    const err = new Error('Projet introuvable');
    err.status = 404;
    throw err;
  }
  const applied = applyHoursLogbookToMeta(rows[0].meta, incoming, { allowClear });
  if (applied.blocked) {
    const err = new Error(`Refus d’effacer le carnet d’heures (${applied.existing_count} ligne(s)).`);
    err.status = 409;
    throw err;
  }
  const logbook = applied.meta.hours_logbook || null;
  const prev = Object.prototype.hasOwnProperty.call(applied.meta, 'hours_logbook_prev')
    ? applied.meta.hours_logbook_prev
    : undefined;
  const patch = { hours_logbook: logbook };
  if (prev !== undefined) patch.hours_logbook_prev = prev;
  await client.query(
    `UPDATE projects SET meta = COALESCE(meta, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
    [JSON.stringify(patch), projectId]
  );
  return logbook;
}

async function resolveEmployee(client, user, requestedId) {
  let employeeId = requestedId ? Number(requestedId) : null;
  if (canManageTeamCalendar(user) && employeeId) {
    // choix explicite
  } else if (user.employee_id) {
    employeeId = Number(user.employee_id);
  } else {
    const err = new Error('Votre compte n’est pas lié à un profil employé — demandez à un admin dans Paramètres → Utilisateurs.');
    err.status = 400;
    throw err;
  }
  const { rows } = await client.query('SELECT id, name FROM employees WHERE id = $1', [employeeId]);
  if (!rows[0]) {
    const err = new Error('Employé introuvable');
    err.status = 400;
    throw err;
  }
  return rows[0];
}

function entryNotes(label, notes) {
  const text = [label, notes].map(s => String(s || '').trim()).filter(Boolean).join(' — ');
  return text || null;
}

router.use(async (req, res, next) => {
  try {
    await ensureTimeEntriesColumns();
    req.account = await getUserAccount(req);
    next();
  } catch (err) {
    const status = /introuvable|désactivé|desactive/i.test(err.message || '') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const manage = canManageTeamCalendar(req.account);
    const person = manage
      ? (req.query.person ? String(req.query.person) : null)
      : (req.account.employee_name || req.account.name || null);

    const { rows: projects } = await pool.query('SELECT id, name, meta FROM projects');

    let entries = [];
    if (manage || req.account.employee_id) {
      const params = [];
      let q = `
        SELECT te.*, e.name AS employee_name, p.name AS project_name,
               EXTRACT(EPOCH FROM (COALESCE(te.ended_at, te.started_at) - te.started_at)) / 3600.0 AS hours
        FROM time_entries te
        JOIN employees e ON e.id = te.employee_id
        LEFT JOIN projects p ON p.id = te.project_id
        WHERE 1=1
      `;
      if (!manage) {
        params.push(Number(req.account.employee_id));
        q += ` AND te.employee_id = $${params.length}`;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        params.push(from);
        q += ` AND COALESCE(te.ended_at, te.started_at) >= ($${params.length}::date - interval '1 day')`;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        params.push(to);
        q += ` AND te.started_at < ($${params.length}::date + interval '2 day')`;
      }
      const result = await pool.query(q, params);
      entries = result.rows.map(r => ({ ...r, hours: Number(r.hours) || 0 }));
    }

    const blocks = assembleAgendaBlocks({
      projects,
      entries,
      from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
      to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null,
      person,
    });

    res.json({
      blocks,
      summary: {
        total: blocks.length,
        logbook: blocks.filter(b => b.kind === 'logbook').length,
        linked: blocks.filter(b => b.kind === 'linked').length,
        time_entries: blocks.filter(b => b.kind === 'time_entry').length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/blocks', async (req, res) => {
  const slot = readSlot(req.body);
  if (slot.error) return res.status(400).json({ error: slot.error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const employee = await resolveEmployee(client, req.account, req.body.employee_id);
    if (slot.projectId) {
      const { rows: proj } = await client.query('SELECT id FROM projects WHERE id = $1', [slot.projectId]);
      if (!proj[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Projet introuvable' });
      }
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO time_entries (employee_id, project_id, started_at, ended_at, notes, source, created_by)
       VALUES ($1, $2, $3, $4, $5, 'agenda', $6) RETURNING id`,
      [
        employee.id,
        slot.projectId,
        slot.startedAt,
        slot.endedAt,
        entryNotes(slot.label, slot.notes),
        req.account.id,
      ]
    );
    const entryId = inserted[0].id;

    if (slot.projectId) {
      const { rows: proj } = await client.query(
        'SELECT id, meta FROM projects WHERE id = $1 FOR UPDATE',
        [slot.projectId]
      );
      const logbook = buildLogbookWithAppendedRow(proj[0].meta, {
        dateKey: slot.date,
        start: slot.start,
        end: slot.end,
        label: slot.label,
        notes: slot.notes,
        hours_value: slot.hours,
        time_entry_id: entryId,
        placed_from: 'agenda',
      }, employee.name);
      await writeLogbook(client, slot.projectId, logbook);
    }

    await client.query('COMMIT');
    res.status(201).json({
      ok: true,
      id: slot.projectId ? null : `entry:${entryId}`,
      time_entry_id: entryId,
      project_id: slot.projectId,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/blocks', async (req, res) => {
  const parsed = parseBlockId(req.body?.id);
  if (!parsed) return res.status(400).json({ error: 'Bloc introuvable' });
  const slot = readSlot(req.body);
  if (slot.error) return res.status(400).json({ error: slot.error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const manage = canManageTeamCalendar(req.account);

    if (parsed.kind === 'entry') {
      const { rows: existingRows } = await client.query(
        `SELECT te.*, e.name AS employee_name
         FROM time_entries te
         JOIN employees e ON e.id = te.employee_id
         WHERE te.id = $1 FOR UPDATE`,
        [parsed.entryId]
      );
      const existing = existingRows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Inscription introuvable' });
      }
      if (!canEditTimeEntry(req.account, existing)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Accès refusé' });
      }

      await client.query(
        `UPDATE time_entries
         SET project_id = $1, started_at = $2, ended_at = $3, notes = $4
         WHERE id = $5`,
        [slot.projectId, slot.startedAt, slot.endedAt, entryNotes(slot.label, slot.notes), existing.id]
      );

      const { rows: projects } = await client.query('SELECT id, name, meta FROM projects');
      const link = findLogbookLink(projects, existing.id);
      if (slot.projectId) {
        if (link && link.projectId === slot.projectId) {
          const patched = buildLogbookWithRowPatch(
            projects.find(p => p.id === link.projectId).meta,
            link.index,
            {
              dateKey: slot.date,
              start: slot.start,
              end: slot.end,
              label: slot.label,
              notes: slot.notes,
              preserveHours: link.row.placed_from !== 'agenda',
              personHours: { name: existing.employee_name, value: slot.hours },
            }
          );
          if (!patched.ok) {
            const err = new Error(patched.error);
            err.status = 404;
            throw err;
          }
          await writeLogbook(client, link.projectId, patched.logbook);
        } else if (link && link.row.placed_from !== 'agenda') {
          const err = new Error('Cette inscription est déjà liée à une ligne historique du carnet. Elle reste dans son projet.');
          err.status = 409;
          throw err;
        } else {
          if (link) {
            const source = projects.find(p => p.id === link.projectId);
            const removed = buildLogbookWithoutRow(source.meta, link.index);
            await writeLogbook(client, link.projectId, removed.logbook, {
              allowClear: removed.emptied && removed.removed?.placed_from === 'agenda',
            });
          }
          const dest = projects.find(p => Number(p.id) === slot.projectId);
          if (!dest) {
            const err = new Error('Projet introuvable');
            err.status = 404;
            throw err;
          }
          const { rows: fresh } = await client.query('SELECT meta FROM projects WHERE id = $1', [slot.projectId]);
          const logbook = buildLogbookWithAppendedRow(fresh[0]?.meta || dest.meta, {
            dateKey: slot.date,
            start: slot.start,
            end: slot.end,
            label: slot.label,
            notes: slot.notes,
            hours_value: slot.hours,
            time_entry_id: existing.id,
            placed_from: 'agenda',
          }, existing.employee_name);
          await writeLogbook(client, slot.projectId, logbook);
        }
      } else if (link && link.row.placed_from === 'agenda') {
        const source = projects.find(p => p.id === link.projectId);
        const removed = buildLogbookWithoutRow(source.meta, link.index);
        await writeLogbook(client, link.projectId, removed.logbook, {
          allowClear: removed.emptied && removed.removed?.placed_from === 'agenda',
        });
      }

      await client.query('COMMIT');
      return res.json({ ok: true, time_entry_id: existing.id, project_id: slot.projectId });
    }

    const { rows: projRows } = await client.query(
      'SELECT id, name, meta FROM projects WHERE id = $1 FOR UPDATE',
      [parsed.projectId]
    );
    if (!projRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Projet introuvable' });
    }
    const log = parseProjectMeta(projRows[0].meta).hours_logbook;
    const row = log?.rows?.[parsed.rowIndex];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ligne du carnet introuvable' });
    }
    if (!manage && !rowMatchesPerson(row, log.people, req.account.employee_name || req.account.name)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const movingProject = slot.projectId && slot.projectId !== parsed.projectId;
    if (movingProject && row.placed_from !== 'agenda') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Ces heures restent dans leur projet. Le créneau peut changer de jour, pas de projet.',
      });
    }

    let employeeName = req.account.employee_name || req.account.name || null;
    if (row.time_entry_id) {
      const { rows: entryRows } = await client.query(
        `SELECT te.*, e.name AS employee_name
         FROM time_entries te JOIN employees e ON e.id = te.employee_id
         WHERE te.id = $1`,
        [row.time_entry_id]
      );
      if (entryRows[0]) {
        if (!canEditTimeEntry(req.account, entryRows[0])) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Accès refusé' });
        }
        employeeName = entryRows[0].employee_name || employeeName;
        const nextProject = movingProject ? slot.projectId : parsed.projectId;
        await client.query(
          `UPDATE time_entries
           SET project_id = $1, started_at = $2, ended_at = $3, notes = $4
           WHERE id = $5`,
          [nextProject, slot.startedAt, slot.endedAt, entryNotes(slot.label, slot.notes), row.time_entry_id]
        );
      }
    }

    if (movingProject) {
      const removed = buildLogbookWithoutRow(projRows[0].meta, parsed.rowIndex);
      await writeLogbook(client, parsed.projectId, removed.logbook, {
        allowClear: removed.emptied && removed.removed?.placed_from === 'agenda',
      });
      const { rows: destRows } = await client.query('SELECT meta FROM projects WHERE id = $1', [slot.projectId]);
      if (!destRows[0]) {
        const err = new Error('Projet introuvable');
        err.status = 404;
        throw err;
      }
      const logbook = buildLogbookWithAppendedRow(destRows[0].meta, {
        dateKey: slot.date,
        start: slot.start,
        end: slot.end,
        label: slot.label,
        notes: slot.notes,
        hours_value: slot.hours,
        time_entry_id: row.time_entry_id || null,
        placed_from: 'agenda',
      }, employeeName);
      await writeLogbook(client, slot.projectId, logbook);
    } else {
      const patched = buildLogbookWithRowPatch(projRows[0].meta, parsed.rowIndex, {
        dateKey: slot.date,
        start: slot.start,
        end: slot.end,
        label: slot.label,
        notes: slot.notes,
        preserveHours: row.placed_from !== 'agenda',
        personHours: { name: employeeName, value: slot.hours },
      });
      if (!patched.ok) {
        const err = new Error(patched.error);
        err.status = 404;
        throw err;
      }
      await writeLogbook(client, parsed.projectId, patched.logbook);
    }

    await client.query('COMMIT');
    res.json({ ok: true, project_id: movingProject ? slot.projectId : parsed.projectId });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
