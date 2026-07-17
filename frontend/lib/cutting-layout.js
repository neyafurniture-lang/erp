/** Helpers layout plan de coupe (planches 1D + panneaux 2D). */

export const BOARD_LEN = 96;
export const SHEET_W = 96;
export const SHEET_H = 48;
export const DEFAULT_KERF = 0.125;

const PALETTE = [
  '#D97706', '#2563EB', '#059669', '#7C3AED', '#DC2626',
  '#0891B2', '#CA8A04', '#DB2777', '#4F46E5', '#16A34A',
];

let _seq = 0;
export function uid(prefix = 'p') {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq}`;
}

export function colorForKey(key) {
  const s = String(key ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function trimNum(n) {
  const x = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(x)) return '0';
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

export function emptyLinearPart(partial = {}) {
  return {
    id: uid('lin'),
    label: '',
    length: 24,
    qty: 1,
    color: colorForKey(partial.length || 24),
    ...partial,
  };
}

export function emptyPanelPart(partial = {}) {
  return {
    id: uid('pan'),
    label: '',
    w: 24,
    h: 18,
    qty: 1,
    color: colorForKey(`${partial.w || 24}x${partial.h || 18}`),
    ...partial,
  };
}

export function emptyBoard(partial = {}) {
  return {
    id: uid('board'),
    label: 'Planche 8 pi',
    length: BOARD_LEN,
    material: '2×4',
    segments: [],
    ...partial,
  };
}

export function emptySheet(partial = {}) {
  return {
    id: uid('sheet'),
    label: 'Panneau 4×8',
    width: SHEET_W,
    height: SHEET_H,
    material: 'contreplaqué',
    rects: [],
    ...partial,
  };
}

export function boardUsed(board, kerf = DEFAULT_KERF) {
  const segs = board.segments || [];
  if (!segs.length) return 0;
  const sum = segs.reduce((s, seg) => s + Number(seg.length || 0), 0);
  return sum + Math.max(0, segs.length - 1) * kerf;
}

export function boardWaste(board, kerf = DEFAULT_KERF) {
  return Math.max(0, Number(board.length || BOARD_LEN) - boardUsed(board, kerf));
}

export function sheetUsedArea(sheet) {
  return (sheet.rects || []).reduce((s, r) => s + Number(r.w || 0) * Number(r.h || 0), 0);
}

export function layoutStats(layout, kerf = DEFAULT_KERF) {
  const boards = layout.boards || [];
  const sheets = layout.sheets || [];
  const boardLen = boards.reduce((s, b) => s + Number(b.length || BOARD_LEN), 0);
  const boardUse = boards.reduce((s, b) => s + boardUsed(b, kerf), 0);
  const sheetArea = sheets.reduce((s, sh) => s + Number(sh.width || SHEET_W) * Number(sh.height || SHEET_H), 0);
  const sheetUse = sheets.reduce((s, sh) => s + sheetUsedArea(sh), 0);
  const segmentCount = boards.reduce((s, b) => s + (b.segments?.length || 0), 0);
  const rectCount = sheets.reduce((s, sh) => s + (sh.rects?.length || 0), 0);
  return {
    boards: boards.length,
    sheets: sheets.length,
    segments: segmentCount,
    rects: rectCount,
    boardYield: boardLen ? boardUse / boardLen : 0,
    boardWasteIn: Math.max(0, boardLen - boardUse),
    sheetYield: sheetArea ? sheetUse / sheetArea : 0,
    sheetWasteArea: Math.max(0, sheetArea - sheetUse),
  };
}

/** Expand qty → individual instances for packing. */
export function expandLinearDemand(parts) {
  const out = [];
  for (const p of parts || []) {
    const n = Math.max(0, Math.floor(Number(p.qty) || 0));
    for (let i = 0; i < n; i++) {
      out.push({
        id: uid('seg'),
        partId: p.id,
        label: p.label || `${trimNum(p.length)}"`,
        length: Number(p.length) || 0,
        color: p.color || colorForKey(p.length),
      });
    }
  }
  return out.filter((x) => x.length > 0);
}

export function expandPanelDemand(parts) {
  const out = [];
  for (const p of parts || []) {
    const n = Math.max(0, Math.floor(Number(p.qty) || 0));
    for (let i = 0; i < n; i++) {
      out.push({
        id: uid('rect'),
        partId: p.id,
        label: p.label || `${trimNum(p.w)}×${trimNum(p.h)}`,
        w: Number(p.w) || 0,
        h: Number(p.h) || 0,
        color: p.color || colorForKey(`${p.w}x${p.h}`),
      });
    }
  }
  return out.filter((x) => x.w > 0 && x.h > 0);
}

/** Pack 1D FFD into editable boards (one rip-length per board visually). */
export function packLinearLocal(parts, { boardLength = BOARD_LEN, kerf = DEFAULT_KERF, material = '2×4' } = {}) {
  const items = expandLinearDemand(parts).sort((a, b) => b.length - a.length);
  const boards = [];

  function place(item) {
    for (const board of boards) {
      const used = boardUsed(board, kerf);
      const need = board.segments.length ? item.length + kerf : item.length;
      if (used + need <= boardLength + 1e-6) {
        board.segments.push({ ...item, id: uid('seg') });
        return;
      }
    }
    boards.push(emptyBoard({
      material,
      length: boardLength,
      label: `Planche ${boards.length + 1}`,
      segments: [{ ...item, id: uid('seg') }],
    }));
  }

  for (const item of items) place(item);
  if (!boards.length) boards.push(emptyBoard({ material, length: boardLength, label: 'Planche 1' }));
  return boards;
}

/** Simple shelf pack for panels → editable sheets. */
export function packPanelsLocal(parts, {
  sheetW = SHEET_W,
  sheetH = SHEET_H,
  kerf = DEFAULT_KERF,
  material = 'contreplaqué',
} = {}) {
  const items = expandPanelDemand(parts).sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const sheets = [];

  function newSheet() {
    const s = emptySheet({
      width: sheetW,
      height: sheetH,
      material,
      label: `Panneau ${sheets.length + 1}`,
      rects: [],
      _shelves: [],
    });
    sheets.push(s);
    return s;
  }

  for (const item of items) {
    let placed = false;
    let w = item.w;
    let h = item.h;
    // try rotate if fits better later — try both orientations
    const orientations = [
      { w: item.w, h: item.h },
      { w: item.h, h: item.w },
    ].filter((o) => o.w <= sheetW && o.h <= sheetH);

    for (const sheet of sheets) {
      for (const orient of orientations) {
        for (const shelf of sheet._shelves) {
          if (orient.h <= shelf.height + 1e-6 && shelf.x + orient.w <= sheetW + 1e-6) {
            sheet.rects.push({
              ...item,
              id: uid('rect'),
              w: orient.w,
              h: orient.h,
              x: shelf.x,
              y: shelf.y,
            });
            shelf.x += orient.w + kerf;
            placed = true;
            break;
          }
        }
        if (placed) break;
        const y = sheet._shelves.reduce((max, s) => Math.max(max, s.y + s.height + kerf), 0);
        if (y + orient.h <= sheetH + 1e-6 && orient.w <= sheetW + 1e-6) {
          sheet._shelves.push({
            y,
            height: orient.h,
            x: orient.w + kerf,
          });
          sheet.rects.push({
            ...item,
            id: uid('rect'),
            w: orient.w,
            h: orient.h,
            x: 0,
            y,
          });
          placed = true;
          break;
        }
      }
      if (placed) break;
    }

    if (!placed) {
      const sheet = newSheet();
      const orient = orientations[0] || { w: item.w, h: item.h };
      sheet._shelves.push({ y: 0, height: orient.h, x: orient.w + kerf });
      sheet.rects.push({
        ...item,
        id: uid('rect'),
        w: orient.w,
        h: orient.h,
        x: 0,
        y: 0,
      });
    }
  }

  for (const s of sheets) delete s._shelves;
  if (!sheets.length) sheets.push(emptySheet({ width: sheetW, height: sheetH, material, label: 'Panneau 1' }));
  return sheets;
}

export function demoLayout() {
  const linearParts = [
    emptyLinearPart({ label: 'Long 37"', length: 37, qty: 10, color: '#D97706' }),
    emptyLinearPart({ label: 'Long 33"', length: 33, qty: 10, color: '#2563EB' }),
    emptyLinearPart({ label: 'Montant 26"', length: 26, qty: 30, color: '#059669' }),
    emptyLinearPart({ label: 'Court 20"', length: 20, qty: 40, color: '#DC2626' }),
    emptyLinearPart({ label: 'Court 13"', length: 13, qty: 20, color: '#64748B' }),
  ];
  const panelParts = [
    emptyPanelPart({ label: 'Étagère', w: 36, h: 14, qty: 4, color: '#0891B2' }),
    emptyPanelPart({ label: 'Côté', w: 24, h: 30, qty: 4, color: '#7C3AED' }),
    emptyPanelPart({ label: 'Fond', w: 36, h: 24, qty: 2, color: '#CA8A04' }),
  ];
  return {
    title: 'Studio coupe — démo',
    project_label: '',
    notes: '',
    kerf: DEFAULT_KERF,
    boardLength: BOARD_LEN,
    sheetW: SHEET_W,
    sheetH: SHEET_H,
    linearParts,
    panelParts,
    boards: packLinearLocal(linearParts),
    sheets: packPanelsLocal(panelParts),
  };
}
