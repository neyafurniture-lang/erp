import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleAgendaBlocks,
  blocksFromProjects,
  buildLogbookWithAppendedRow,
  buildLogbookWithoutRow,
  buildLogbookWithRowPatch,
  dateKeyOf,
  hoursBetweenHm,
  isLogbookRowLinked,
  placeLogbookRows,
  projectLaborUsesLogbook,
  rowMatchesPerson,
} from './agenda-blocks.js';

describe('agenda-blocks', () => {
  const projects = [
    {
      id: 4,
      name: 'Table Haltigan',
      meta: {
        hours_logbook: {
          people: ['Mehdi'],
          rows: [
            { dateKey: '2026-07-20', label: 'assemblage', hours: { Mehdi: 5 }, notes: 'atelier' },
            { dateKey: '2026-07-21', label: 'finition', start: '13:00', end: '16:00', hours: { Mehdi: 3 } },
            { dateKey: '20/07/2026', label: 'doublon fr', hours: { Mehdi: 1 } },
          ],
        },
      },
    },
    {
      id: 9,
      name: 'Banc Olive',
      meta: {
        hours_logbook: {
          people: ['Olive'],
          rows: [
            { dateKey: '2026-07-20', label: 'débitage', hours: { Olive: 2 } },
          ],
        },
      },
    },
  ];

  it('place toutes les dates enregistrées sans en perdre', () => {
    const blocks = blocksFromProjects(projects, { from: '2026-07-01', to: '2026-07-31' });
    const ids = blocks.map(b => b.id).sort();
    assert.deepEqual(ids, ['log:4:0', 'log:4:1', 'log:4:2', 'log:9:0']);
    const finition = blocks.find(b => b.id === 'log:4:1');
    assert.equal(finition.inferred, false);
    assert.equal(finition.start_hm, '13:00');
    assert.equal(finition.end_hm, '16:00');
    const loose = blocks.find(b => b.id === 'log:4:0');
    assert.equal(loose.inferred, true);
    assert.equal(loose.date, '2026-07-20');
    assert.equal(loose.hours, 5);
    assert.equal(dateKeyOf({ dateKey: '20/07/2026' }), '2026-07-20');
  });

  it('empile les durées après les créneaux explicites du même jour', () => {
    const placed = placeLogbookRows([
      { row: { start: '09:00', end: '11:00', hours: { Mehdi: 2 }, label: 'fixe' }, index: 0, project: { id: 1, name: 'A' } },
      { row: { hours: { Mehdi: 1.5 }, label: 'libre' }, index: 1, project: { id: 1, name: 'A' } },
    ]);
    assert.equal(placed.length, 2);
    assert.equal(placed[0].start_hm, '09:00');
    assert.equal(placed[1].start_hm, '11:15');
    assert.equal(placed[1].end_hm, '12:45');
    assert.equal(placed[1].inferred, true);
  });

  it('filtre par personne sans effacer les lignes des autres', () => {
    assert.equal(rowMatchesPerson({ hours: { Mehdi: 4 } }, ['Mehdi', 'Olive'], 'Mehdi'), true);
    assert.equal(rowMatchesPerson({ hours: { Olive: 2 } }, ['Mehdi', 'Olive'], 'Mehdi'), false);
    const mine = blocksFromProjects(projects, { from: '2026-07-20', to: '2026-07-20', person: 'Mehdi' });
    assert.ok(mine.every(b => b.project_id === 4));
    assert.equal(blocksFromProjects(projects).length, 4);
  });

  it('ajoute un bloc sans retirer les heures déjà enregistrées', () => {
    const meta = projects[0].meta;
    const next = buildLogbookWithAppendedRow(meta, {
      dateKey: '2026-09-29',
      start: '09:00',
      end: '12:00',
      label: 'agenda',
      hours_value: 3,
      time_entry_id: 15,
      placed_from: 'agenda',
    }, 'Mehdi');
    assert.equal(next.rows.length, 4);
    assert.equal(next.rows[0].hours.Mehdi, 5);
    assert.equal(next.rows[0].label, 'assemblage');
    assert.equal(next.rows[3].time_entry_id, 15);
    assert.equal(next.rows[3].hours.Mehdi, 3);
    assert.equal(next.rows[3].placed_from, 'agenda');
    assert.equal(isLogbookRowLinked(next.rows[3]), true);
    assert.equal(isLogbookRowLinked(next.rows[0]), false);
  });

  it('déplace une seule ligne et conserve les autres', () => {
    const patched = buildLogbookWithRowPatch(projects[0].meta, 0, {
      dateKey: '2026-08-01',
      start: '08:00',
      end: '13:00',
      preserveHours: true,
    });
    assert.equal(patched.ok, true);
    assert.equal(patched.logbook.rows[0].dateKey, '2026-08-01');
    assert.equal(patched.logbook.rows[0].hours.Mehdi, 5);
    assert.equal(patched.logbook.rows[1].dateKey, '2026-07-21');
    assert.equal(patched.logbook.rows.length, 3);
  });

  it('retire seulement le bloc déplacé', () => {
    const removed = buildLogbookWithoutRow({
      hours_logbook: {
        people: ['Mehdi'],
        rows: [
          { dateKey: '2026-07-20', hours: { Mehdi: 5 } },
          { dateKey: '2026-09-29', placed_from: 'agenda', hours: { Mehdi: 2 } },
        ],
      },
    }, 1);
    assert.equal(removed.ok, true);
    assert.equal(removed.emptied, false);
    assert.equal(removed.logbook.rows.length, 1);
    assert.equal(removed.logbook.rows[0].dateKey, '2026-07-20');
  });

  it('n’affiche qu’une fois un pointage déjà lié au carnet', () => {
    const meta = buildLogbookWithAppendedRow(projects[0].meta, {
      dateKey: '2026-09-29',
      start: '09:00',
      end: '12:00',
      hours_value: 3,
      time_entry_id: 15,
      placed_from: 'agenda',
    }, 'Mehdi');
    const blocks = assembleAgendaBlocks({
      projects: [{ id: 4, name: 'Table Haltigan', meta: { hours_logbook: meta } }],
      entries: [
        {
          id: 15,
          project_id: 4,
          project_name: 'Table Haltigan',
          employee_name: 'Mehdi',
          started_at: '2026-09-29T13:00:00.000Z',
          ended_at: '2026-09-29T16:00:00.000Z',
          hours: 3,
          source: 'agenda',
        },
        {
          id: 8,
          project_id: null,
          project_name: null,
          employee_name: 'Mehdi',
          started_at: '2026-09-28T12:00:00.000Z',
          ended_at: '2026-09-28T20:00:00.000Z',
          hours: 8,
          source: 'manual',
        },
      ],
      from: '2026-09-01',
      to: '2026-09-30',
    });
    assert.equal(blocks.filter(b => b.time_entry_id === 15).length, 1);
    assert.equal(blocks.find(b => b.time_entry_id === 15).kind, 'linked');
    assert.equal(blocks.find(b => b.id === 'entry:8').kind, 'time_entry');
  });

  it('évite de basculer le coût projet quand le carnet ne contient que des blocs liés', () => {
    assert.equal(projectLaborUsesLogbook(6), true);
    assert.equal(projectLaborUsesLogbook(0), false);
    assert.equal(hoursBetweenHm('09:00', '12:30'), 3.5);
  });
});
