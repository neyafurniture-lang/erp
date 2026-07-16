/**
 * Optimiseur de plans de coupe NEYA
 * - Planches 1D (ex. 2×4 × 8 pi = 96")
 * - Feuilles 2D (ex. 4×8 pi = 48" × 96")
 */

export const BOARD_LENGTH_IN = 96; // 8 pi
export const SHEET_W_IN = 48; // 4 pi
export const SHEET_L_IN = 96; // 8 pi
export const DEFAULT_KERF = 0.125; // 1/8"
export const DEFAULT_MARGIN = 0.12;

const LENGTH_COLORS = {
  37: '#D97706',
  33: '#2563EB',
  26: '#059669',
  22: '#7C3AED',
  20: '#DC2626',
  13: '#64748B',
};

export function colorForLength(inches) {
  const key = Math.round(Number(inches));
  if (LENGTH_COLORS[key]) return LENGTH_COLORS[key];
  // hash for unknown lengths
  const hues = [15, 40, 160, 200, 260, 320];
  return `hsl(${hues[key % hues.length]} 55% 42%)`;
}

/** Développe la nomenclature : SKUs → liste de pièces 1D nécessaires. */
export function expandBom(skus = []) {
  const pieces = [];
  for (const sku of skus) {
    const qty = Math.max(0, Number(sku.qty) || 0);
    if (!qty) continue;
    const longs = Number(sku.long_in) || 0;
    const shorts = Number(sku.short_in) || 0;
    const longCount = Number(sku.long_count ?? 2);
    const shortCount = Number(sku.short_count ?? 2);
    const traverses = Number(sku.traverse_in) || 0;
    const traverseCount = Number(sku.traverse_count ?? 0);

    for (let i = 0; i < qty; i++) {
      for (let j = 0; j < longCount; j++) {
        if (longs > 0) pieces.push({ length: longs, role: 'long', sku: sku.sku, stock: 'structural' });
      }
      for (let j = 0; j < shortCount; j++) {
        if (shorts > 0) pieces.push({ length: shorts, role: 'short', sku: sku.sku, stock: 'structural' });
      }
      for (let j = 0; j < traverseCount; j++) {
        if (traverses > 0) pieces.push({ length: traverses, role: 'traverse', sku: sku.sku, stock: 'traverse' });
      }
      // Pièces libres (liste)
      for (const p of sku.pieces || []) {
        const n = Math.max(0, Number(p.qty) || 1);
        for (let k = 0; k < n; k++) {
          pieces.push({
            length: Number(p.length_in) || 0,
            role: p.role || 'part',
            sku: sku.sku,
            stock: p.stock || 'structural',
          });
        }
      }
    }
  }
  return pieces.filter(p => p.length > 0);
}

/** Soustrait le stock atelier (pièces déjà coupées ou à longueur). */
export function applyExistingStock(pieces, stock = []) {
  const remaining = pieces.map(p => ({ ...p }));
  const used = [];
  for (const s of stock) {
    let qty = Math.max(0, Number(s.qty) || 0);
    const length = Number(s.length_in) || 0;
    const ripFactor = Math.max(1, Number(s.rip_factor) || 1); // 2 = refendu en 2
    const equivalent = qty * ripFactor;
    let left = equivalent;
    const stockRole = s.stock || 'structural';
    for (let i = 0; i < remaining.length && left > 0; i++) {
      if (remaining[i]._used) continue;
      if (remaining[i].stock !== stockRole) continue;
      if (Math.abs(remaining[i].length - length) > 0.05) continue;
      remaining[i]._used = true;
      left -= 1;
    }
    used.push({
      length_in: length,
      qty_on_hand: qty,
      rip_factor: ripFactor,
      equivalent,
      used: equivalent - left,
      stock: stockRole,
      note: s.note || '',
    });
  }
  return {
    remaining: remaining.filter(p => !p._used),
    usedStock: used,
  };
}

/**
 * Empilement First-Fit Decreasing sur planches de boardLength.
 * ripYield = nb de longueurs utiles par planche (2 si refendu en 2, 4 si en 4).
 */
export function packBoards(pieces, {
  boardLength = BOARD_LENGTH_IN,
  kerf = DEFAULT_KERF,
  ripYield = 2,
  stockKey = 'structural',
} = {}) {
  const lengths = pieces
    .filter(p => p.stock === stockKey)
    .map(p => Number(p.length))
    .filter(n => n > 0)
    .sort((a, b) => b - a);

  if (!lengths.length) {
    return { boards: [], patterns: [], boardCount: 0, lengthCount: 0, ripYield, boardLength };
  }

  // Chaque planche donne ripYield longueurs indépendantes
  const bins = []; // each bin = { cuts: number[], used: number }

  function place(len) {
    for (const bin of bins) {
      const need = bin.cuts.length === 0 ? len : len + kerf;
      if (bin.used + need <= boardLength + 1e-6) {
        bin.cuts.push(len);
        bin.used += need;
        return;
      }
    }
    bins.push({ cuts: [len], used: len });
  }

  for (const len of lengths) place(len);

  // Grouper patterns identiques
  const patternMap = new Map();
  for (const bin of bins) {
    const key = bin.cuts.map(c => c.toFixed(3)).join('+');
    if (!patternMap.has(key)) {
      patternMap.set(key, {
        cuts: [...bin.cuts],
        waste: Math.max(0, boardLength - bin.used),
        count: 0,
      });
    }
    patternMap.get(key).count += 1;
  }

  const patterns = [...patternMap.values()]
    .sort((a, b) => b.count - a.count || a.waste - b.waste)
    .map((p, i) => ({
      id: `P${i + 1}`,
      ...p,
      segments: p.cuts.map(c => ({
        length: c,
        color: colorForLength(c),
        label: `${trimNum(c)}"`,
      })),
      wasteSegment: p.waste > 0.05 ? {
        length: p.waste,
        color: '#E5E5E5',
        label: `${trimNum(p.waste)}"`,
      } : null,
    }));

  const lengthCount = bins.length;
  const boardCount = Math.ceil(lengthCount / ripYield);

  return {
    boards: bins,
    patterns,
    boardCount,
    lengthCount,
    ripYield,
    boardLength,
    totalWaste: bins.reduce((s, b) => s + Math.max(0, boardLength - b.used), 0),
  };
}

function trimNum(n) {
  const x = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

/** Empilement étagères simple pour feuilles 4×8 (guillotine horizontale). */
export function packSheets(parts = [], {
  sheetW = SHEET_W_IN,
  sheetL = SHEET_L_IN,
  kerf = DEFAULT_KERF,
} = {}) {
  const items = [];
  for (const p of parts) {
    const qty = Math.max(0, Number(p.qty) || 0);
    const w = Number(p.w_in) || 0;
    const h = Number(p.h_in) || 0;
    if (!qty || !w || !h) continue;
    for (let i = 0; i < qty; i++) {
      // Orientation optimale : plus grand côté // longueur feuille
      const a = { w, h, label: p.label || `${w}×${h}`, sku: p.sku || null };
      const b = { w: h, h: w, label: a.label, sku: a.sku };
      const use = (w <= sheetW && h <= sheetL) ? a
        : (h <= sheetW && w <= sheetL) ? b
          : (a.w * a.h <= b.w * b.h ? a : b);
      items.push(use);
    }
  }
  items.sort((x, y) => (y.h * y.w) - (x.h * x.w));

  const sheets = [];
  function newSheet() {
    const s = { shelves: [], usedArea: 0 };
    sheets.push(s);
    return s;
  }

  for (const item of items) {
    let placed = false;
    for (const sheet of sheets) {
      for (const shelf of sheet.shelves) {
        if (item.h <= shelf.height + 1e-6 && shelf.x + item.w <= sheetW + 1e-6) {
          shelf.parts.push({ ...item, x: shelf.x, y: shelf.y });
          shelf.x += item.w + kerf;
          sheet.usedArea += item.w * item.h;
          placed = true;
          break;
        }
      }
      if (placed) break;
      // nouvelle étagère
      const y = sheet.shelves.reduce((max, s) => Math.max(max, s.y + s.height + kerf), 0);
      if (y + item.h <= sheetL + 1e-6 && item.w <= sheetW + 1e-6) {
        sheet.shelves.push({
          y,
          height: item.h,
          x: item.w + kerf,
          parts: [{ ...item, x: 0, y }],
        });
        sheet.usedArea += item.w * item.h;
        placed = true;
      }
    }
    if (!placed) {
      const sheet = newSheet();
      sheet.shelves.push({
        y: 0,
        height: item.h,
        x: item.w + kerf,
        parts: [{ ...item, x: 0, y: 0 }],
      });
      sheet.usedArea += item.w * item.h;
    }
  }

  const area = sheetW * sheetL;
  return {
    sheets: sheets.map((s, i) => ({
      id: `S${i + 1}`,
      width: sheetW,
      length: sheetL,
      shelves: s.shelves,
      usedArea: s.usedArea,
      wastePct: area ? Math.round((1 - s.usedArea / area) * 1000) / 10 : 0,
    })),
    sheetCount: sheets.length,
    sheetW,
    sheetL,
  };
}

export function summarizeNeeds(pieces) {
  const byLen = {};
  for (const p of pieces) {
    const key = `${p.stock}:${p.length}`;
    if (!byLen[key]) byLen[key] = { stock: p.stock, length: p.length, qty: 0 };
    byLen[key].qty += 1;
  }
  return Object.values(byLen).sort((a, b) => b.length - a.length);
}

/**
 * Calcule un plan de coupe complet.
 * planInput: { title, project_label, skus, existing_stock, sheet_parts, materials, margin, kerf }
 */
export function optimizeCuttingPlan(planInput = {}) {
  const margin = planInput.margin != null ? Number(planInput.margin) : DEFAULT_MARGIN;
  const kerf = planInput.kerf != null ? Number(planInput.kerf) : DEFAULT_KERF;
  const boardLength = Number(planInput.board_length_in) || BOARD_LENGTH_IN;

  const allPieces = expandBom(planInput.skus || []);
  const { remaining, usedStock } = applyExistingStock(allPieces, planInput.existing_stock || []);

  const structural = packBoards(remaining, {
    boardLength,
    kerf,
    ripYield: Number(planInput.structural_rip_yield) || 2,
    stockKey: 'structural',
  });
  const traverse = packBoards(remaining, {
    boardLength,
    kerf,
    ripYield: Number(planInput.traverse_rip_yield) || 4,
    stockKey: 'traverse',
  });

  const sheets = packSheets(planInput.sheet_parts || [], {
    sheetW: Number(planInput.sheet_w_in) || SHEET_W_IN,
    sheetL: Number(planInput.sheet_l_in) || SHEET_L_IN,
    kerf,
  });

  const structuralBuy = Math.ceil(structural.boardCount * (1 + margin));
  const traverseBuy = Math.ceil(traverse.boardCount * (1 + margin));
  const sheetBuy = Math.ceil(sheets.sheetCount * (1 + margin));

  const materials = planInput.materials || {};
  const board2x4Price = Number(materials.board_2x4_price) || 17.95;
  const board1x6Price = Number(materials.board_1x6_price) || 16.95;
  const sheetPrice = Number(materials.sheet_price) || 0;
  const taxRate = Number(materials.tax_rate) ?? 0.14975;
  const uhaul = Number(materials.uhaul) || 0;
  const gas = Number(materials.gas) || 0;
  const extra1x6 = Number(materials.extra_1x6_qty) || 0;

  const buy2x4 = structuralBuy + traverseBuy;
  const buy1x6 = extra1x6;
  const woodPretax = buy2x4 * board2x4Price + buy1x6 * board1x6Price + sheetBuy * sheetPrice;
  const woodTaxed = woodPretax * (1 + taxRate);
  const uhaulTaxed = uhaul * (1 + taxRate);
  const grandPretax = woodPretax + uhaul + gas;
  const grandTaxed = woodTaxed + uhaulTaxed + gas;

  const legendLengths = [...new Set([
    ...structural.patterns.flatMap(p => p.cuts),
    ...traverse.patterns.flatMap(p => p.cuts),
  ])].sort((a, b) => b - a);

  return {
    title: planInput.title || 'Plan de coupe',
    project_label: planInput.project_label || '',
    date: planInput.date || new Date().toISOString().slice(0, 10),
    notes: planInput.notes || '',
    skus: planInput.skus || [],
    existing_stock: usedStock,
    needs: summarizeNeeds(allPieces),
    remaining_needs: summarizeNeeds(remaining),
    structural: {
      ...structural,
      board_needed: structural.boardCount,
      board_with_margin: structuralBuy,
      margin,
      label: 'Structural',
      rip_label: `×${structural.ripYield} (longs + shorts)`,
    },
    traverse: {
      ...traverse,
      board_needed: traverse.boardCount,
      board_with_margin: traverseBuy,
      margin,
      label: 'Traverses',
      rip_label: `×${traverse.ripYield} (lattes)`,
    },
    sheets: {
      ...sheets,
      sheet_needed: sheets.sheetCount,
      sheet_with_margin: sheetBuy,
      margin,
    },
    legend: legendLengths.map(l => ({ length: l, color: colorForLength(l), label: `${trimNum(l)}"` })),
    purchase: {
      board_2x4_qty: buy2x4,
      board_1x6_qty: buy1x6,
      sheet_qty: sheetBuy,
      board_2x4_price: board2x4Price,
      board_1x6_price: board1x6Price,
      sheet_price: sheetPrice,
      tax_rate: taxRate,
      uhaul,
      gas,
      wood_pretax: round2(woodPretax),
      wood_taxed: round2(woodTaxed),
      grand_pretax: round2(grandPretax),
      grand_taxed: round2(grandTaxed),
    },
    settings: { boardLength, kerf, margin },
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Exemple Sierra Frames (plan type Cutting_Plan_Sierra). */
export function sierraFramesExample() {
  return {
    title: 'Cutting plan — Sierra Frames',
    project_label: 'Saunacloud · frames restantes',
    notes: 'Stock structurel refendu ×2 · Traverses refendues ×4. Planches 2×4 × 8 pi.',
    margin: 0.12,
    kerf: 0.125,
    structural_rip_yield: 2,
    traverse_rip_yield: 4,
    skus: [
      { sku: 'H2013', label: '20×13"', qty: 20, long_in: 13, short_in: 20, traverse_in: 20, traverse_count: 2 },
      { sku: 'H2026', label: '20×26"', qty: 10, long_in: 26, short_in: 20, traverse_in: 20, traverse_count: 4 },
      { sku: 'H2226', label: '22×26"', qty: 6, long_in: 26, short_in: 22, traverse_in: 22, traverse_count: 4 },
      { sku: 'H3313', label: '33×13"', qty: 10, long_in: 33, short_in: 13, traverse_in: 13, traverse_count: 2 },
      { sku: 'H3726', label: '37×26"', qty: 10, long_in: 37, short_in: 26, traverse_in: 26, traverse_count: 4 },
    ],
    existing_stock: [
      { length_in: 20, qty: 10, rip_factor: 2, stock: 'structural', note: 'non refendu' },
      { length_in: 33, qty: 5, rip_factor: 2, stock: 'structural', note: 'non refendu' },
    ],
    sheet_parts: [],
    materials: {
      board_2x4_price: 17.95,
      board_1x6_price: 16.95,
      extra_1x6_qty: 10,
      tax_rate: 0.14975,
      uhaul: 85,
      gas: 20,
    },
  };
}
