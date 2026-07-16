/**
 * PDF Cutting Plan — style Sierra (barres colorées, BOM, coûts).
 */
import PDFDocument from 'pdfkit';
import { optimizeCuttingPlan } from './cutting-optimizer.js';

const COLORS = {
  header: '#1a1a2e',
  accent: '#0f766e',
  muted: '#64748b',
  line: '#e2e8f0',
  waste: '#e5e5e5',
};

function drawHeader(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 52).fill(COLORS.header);
  doc.fillColor('#fff').fontSize(16).font('Helvetica-Bold')
    .text(title, 40, 14, { width: doc.page.width - 80 });
  if (subtitle) {
    doc.fontSize(9).font('Helvetica').fillColor('#94a3b8')
      .text(subtitle, 40, 34, { width: doc.page.width - 80 });
  }
  doc.fillColor('#000').font('Helvetica');
}

function drawFooter(doc, pageNum) {
  const y = doc.page.height - 30;
  doc.fontSize(8).fillColor(COLORS.muted)
    .text(`NEYA ERP — Cutting Plan  ·  Page ${pageNum}`, 40, y, {
      width: doc.page.width - 80,
      align: 'center',
    });
}

function tableRow(doc, cols, y, opts = {}) {
  const { bold = false, fill = null, fontSize = 8 } = opts;
  const x0 = 40;
  if (fill) {
    doc.rect(x0, y - 2, doc.page.width - 80, 16).fill(fill);
  }
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#111');
  let x = x0;
  for (const c of cols) {
    doc.text(String(c.text ?? ''), x + 2, y, { width: c.w - 4, align: c.align || 'left' });
    x += c.w;
  }
  return y + 16;
}

function drawBoardPattern(doc, pattern, x, y, maxW, boardLen = 96) {
  const h = 22;
  const scale = maxW / boardLen;
  doc.roundedRect(x, y, maxW, h, 3).fillAndStroke('#f8fafc', '#94a3b8');

  let cursor = 0;
  for (const seg of pattern.segments || []) {
    const w = Math.max(2, seg.length * scale);
    doc.rect(x + cursor * scale, y, w, h).fill(seg.color || '#94a3b8');
    if (w > 18) {
      doc.fillColor('#fff').fontSize(7).font('Helvetica-Bold')
        .text(String(seg.label || seg.length), x + cursor * scale, y + 7, {
          width: w,
          align: 'center',
        });
    }
    cursor += seg.length;
  }
  if (pattern.wasteSegment && pattern.wasteSegment.length > 0.5) {
    const wasteW = pattern.wasteSegment.length * scale;
    doc.rect(x + cursor * scale, y, wasteW, h).fill(COLORS.waste);
  }
  doc.fillColor('#000').font('Helvetica');
  return y + h;
}

function drawSheet(doc, sheet, x, y, boxW, boxH) {
  const sheetW = sheet.width || 48;
  const sheetL = sheet.length || 96;
  const scale = Math.min(boxW / sheetW, boxH / sheetL);
  const w = sheetW * scale;
  const h = sheetL * scale;
  doc.rect(x, y, w, h).fillAndStroke('#f1f5f9', '#64748b');
  for (const shelf of sheet.shelves || []) {
    for (const p of shelf.parts || []) {
      doc.rect(x + p.x * scale, y + p.y * scale, p.w * scale, p.h * scale)
        .fillAndStroke('#0ea5e9', '#0f172a');
      if (p.w * scale > 20 && p.h * scale > 12) {
        doc.fillColor('#fff').fontSize(6)
          .text(p.label || `${p.w}×${p.h}`, x + p.x * scale + 2, y + p.y * scale + 2, {
            width: p.w * scale - 4,
          });
      }
    }
  }
  doc.fillColor('#000');
  return { w, h };
}

/**
 * @param {object} planInput
 * @param {object} [optimized]
 * @returns {Promise<Buffer>}
 */
export async function generateCuttingPlanPdf(planInput, optimized = null) {
  const result = optimized || optimizeCuttingPlan(planInput);
  const title = result.title || 'Cutting Plan';
  const subtitle = [result.project_label, result.date].filter(Boolean).join(' · ');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40, autoFirstPage: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let pageNum = 0;
    const boardLen = result.settings?.boardLength || 96;

    // ── Page 1: Purchase + stock + BOM ──
    doc.addPage();
    pageNum++;
    drawHeader(doc, title, subtitle);

    let y = 68;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.accent)
      .text('1. Material to purchase', 40, y);
    y += 18;

    const p = result.purchase;
    y = tableRow(doc, [
      { text: 'Item', w: 220 },
      { text: 'Qty', w: 50, align: 'right' },
      { text: 'Unit $', w: 70, align: 'right' },
      { text: 'Line', w: 80, align: 'right' },
    ], y, { bold: true, fill: '#e2e8f0' });

    const buyRows = [
      {
        label: '2×4 × 8 ft (structural + traverses)',
        qty: p.board_2x4_qty,
        unit: p.board_2x4_price,
      },
      {
        label: '1×6 × 8 ft',
        qty: p.board_1x6_qty,
        unit: p.board_1x6_price,
      },
    ];
    if (p.sheet_qty > 0) {
      buyRows.push({ label: 'Sheet 4×8 ft', qty: p.sheet_qty, unit: p.sheet_price });
    }
    for (const row of buyRows) {
      if (!row.qty) continue;
      const line = row.qty * row.unit;
      y = tableRow(doc, [
        { text: row.label, w: 220 },
        { text: row.qty, w: 50, align: 'right' },
        { text: `$${Number(row.unit).toFixed(2)}`, w: 70, align: 'right' },
        { text: `$${line.toFixed(2)}`, w: 80, align: 'right' },
      ], y);
    }

    y += 6;
    doc.fontSize(8).fillColor(COLORS.muted)
      .text(
        `Structural: ${result.structural.board_needed} boards (+${Math.round((result.structural.margin || 0) * 100)}% → ${result.structural.board_with_margin}) · `
        + `Traverses: ${result.traverse.board_needed} → ${result.traverse.board_with_margin} · Rip ${result.structural.rip_label}`,
        40,
        y,
        { width: 520 },
      );
    y += 20;

    if ((result.existing_stock || []).length) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.accent)
        .text('2. Existing stock used', 40, y);
      y += 18;
      y = tableRow(doc, [
        { text: 'Length', w: 60 },
        { text: 'On hand', w: 55, align: 'right' },
        { text: 'Rip', w: 40 },
        { text: 'Equiv.', w: 55, align: 'right' },
        { text: 'Used', w: 50, align: 'right' },
        { text: 'Stock', w: 80 },
        { text: 'Note', w: 120 },
      ], y, { bold: true, fill: '#e2e8f0' });
      for (const s of result.existing_stock) {
        y = tableRow(doc, [
          { text: `${s.length_in}"`, w: 60 },
          { text: s.qty_on_hand, w: 55, align: 'right' },
          { text: `×${s.rip_factor}`, w: 40 },
          { text: s.equivalent, w: 55, align: 'right' },
          { text: s.used, w: 50, align: 'right' },
          { text: s.stock || '', w: 80 },
          { text: s.note || '', w: 120 },
        ], y);
      }
      y += 12;
    }

    doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.accent)
      .text('3. Length legend & needs', 40, y);
    y += 18;

    // color legend
    for (const leg of result.legend || []) {
      doc.rect(40, y, 14, 12).fill(leg.color);
      doc.fillColor('#111').fontSize(8).font('Helvetica')
        .text(leg.label, 58, y + 1);
      y += 16;
    }
    y += 6;

    y = tableRow(doc, [
      { text: 'Stock', w: 90 },
      { text: 'Length', w: 70, align: 'right' },
      { text: 'Need (raw)', w: 80, align: 'right' },
      { text: 'After stock', w: 80, align: 'right' },
    ], y, { bold: true, fill: '#e2e8f0' });

    const remainingMap = new Map(
      (result.remaining_needs || []).map((n) => [`${n.stock}:${n.length}`, n.qty]),
    );
    for (const n of result.needs || []) {
      y = tableRow(doc, [
        { text: n.stock, w: 90 },
        { text: `${n.length}"`, w: 70, align: 'right' },
        { text: n.qty, w: 80, align: 'right' },
        { text: remainingMap.get(`${n.stock}:${n.length}`) || 0, w: 80, align: 'right' },
      ], y);
      if (y > 700) {
        drawFooter(doc, pageNum);
        doc.addPage();
        pageNum++;
        drawHeader(doc, title, 'Needs (continued)');
        y = 68;
      }
    }

    // SKU table
    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.accent)
      .text('4. Frame SKUs', 40, y);
    y += 18;
    y = tableRow(doc, [
      { text: 'SKU', w: 70 },
      { text: 'Label', w: 140 },
      { text: 'Qty', w: 40, align: 'right' },
      { text: 'Long', w: 50, align: 'right' },
      { text: 'Short', w: 50, align: 'right' },
      { text: 'Traverse', w: 70, align: 'right' },
    ], y, { bold: true, fill: '#e2e8f0' });
    for (const sku of result.skus || []) {
      y = tableRow(doc, [
        { text: sku.sku, w: 70 },
        { text: sku.label || '', w: 140 },
        { text: sku.qty, w: 40, align: 'right' },
        { text: sku.long_in || '—', w: 50, align: 'right' },
        { text: sku.short_in || '—', w: 50, align: 'right' },
        { text: sku.traverse_in ? `${sku.traverse_in}" ×${sku.traverse_count || 0}` : '—', w: 70, align: 'right' },
      ], y);
    }
    drawFooter(doc, pageNum);

    // ── Structural patterns ──
    const structPatterns = result.structural?.patterns || [];
    if (structPatterns.length) {
      doc.addPage();
      pageNum++;
      drawHeader(doc, title, `Structural patterns — 2×4 × 8 ft · rip ${result.structural.rip_label}`);
      y = 68;
      doc.fontSize(9).fillColor(COLORS.muted)
        .text('Each bar = one 96" rip length. Colors = cut lengths. Grey = waste/kerf remainder.', 40, y, { width: 520 });
      y += 18;
      for (const g of structPatterns) {
        if (y > 700) {
          drawFooter(doc, pageNum);
          doc.addPage();
          pageNum++;
          drawHeader(doc, title, 'Structural patterns (continued)');
          y = 68;
        }
        doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.header)
          .text(`${g.id}  ·  ×${g.count}  ·  waste ${Number(g.waste).toFixed(1)}"`, 40, y);
        y += 14;
        drawBoardPattern(doc, g, 40, y, 500, boardLen);
        y += 30;
      }
      drawFooter(doc, pageNum);
    }

    // ── Traverse patterns ──
    const travPatterns = result.traverse?.patterns || [];
    if (travPatterns.length) {
      doc.addPage();
      pageNum++;
      drawHeader(doc, title, `Traverse patterns — rip ${result.traverse.rip_label}`);
      y = 68;
      for (const g of travPatterns) {
        if (y > 700) {
          drawFooter(doc, pageNum);
          doc.addPage();
          pageNum++;
          drawHeader(doc, title, 'Traverse patterns (continued)');
          y = 68;
        }
        doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.header)
          .text(`${g.id}  ·  ×${g.count}  ·  waste ${Number(g.waste).toFixed(1)}"`, 40, y);
        y += 14;
        drawBoardPattern(doc, g, 40, y, 500, boardLen);
        y += 30;
      }
      drawFooter(doc, pageNum);
    }

    // ── Sheets ──
    const sheetList = result.sheets?.sheets || [];
    if (sheetList.length) {
      doc.addPage();
      pageNum++;
      drawHeader(doc, title, 'Sheet patterns — 4×8 ft');
      y = 68;
      let col = 0;
      for (const sp of sheetList) {
        if (y > 620 && col === 0) {
          drawFooter(doc, pageNum);
          doc.addPage();
          pageNum++;
          drawHeader(doc, title, 'Sheets (continued)');
          y = 68;
        }
        const x = 40 + col * 270;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.header)
          .text(`${sp.id} · waste ${sp.wastePct}%`, x, y);
        drawSheet(doc, sp, x, y + 14, 240, 160);
        col++;
        if (col >= 2) {
          col = 0;
          y += 190;
        }
      }
      drawFooter(doc, pageNum);
    }

    // ── Costs ──
    doc.addPage();
    pageNum++;
    drawHeader(doc, title, 'Cost estimate');
    y = 68;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.accent)
      .text('Cost breakdown', 40, y);
    y += 20;

    y = tableRow(doc, [
      { text: 'Item', w: 300 },
      { text: 'Amount', w: 100, align: 'right' },
    ], y, { bold: true, fill: '#e2e8f0' });

    if (p.board_2x4_qty) {
      y = tableRow(doc, [
        { text: `2×4 × 8 ft × ${p.board_2x4_qty} @ $${p.board_2x4_price}`, w: 300 },
        { text: `$${(p.board_2x4_qty * p.board_2x4_price).toFixed(2)}`, w: 100, align: 'right' },
      ], y);
    }
    if (p.board_1x6_qty) {
      y = tableRow(doc, [
        { text: `1×6 × 8 ft × ${p.board_1x6_qty} @ $${p.board_1x6_price}`, w: 300 },
        { text: `$${(p.board_1x6_qty * p.board_1x6_price).toFixed(2)}`, w: 100, align: 'right' },
      ], y);
    }
    if (p.sheet_qty) {
      y = tableRow(doc, [
        { text: `Sheet 4×8 × ${p.sheet_qty} @ $${p.sheet_price}`, w: 300 },
        { text: `$${(p.sheet_qty * p.sheet_price).toFixed(2)}`, w: 100, align: 'right' },
      ], y);
    }
    if (p.uhaul) {
      y = tableRow(doc, [
        { text: 'U-Haul', w: 300 },
        { text: `$${Number(p.uhaul).toFixed(2)}`, w: 100, align: 'right' },
      ], y);
    }
    if (p.gas) {
      y = tableRow(doc, [
        { text: 'Gas', w: 300 },
        { text: `$${Number(p.gas).toFixed(2)}`, w: 100, align: 'right' },
      ], y);
    }

    y += 8;
    doc.moveTo(40, y).lineTo(440, y).strokeColor(COLORS.line).stroke();
    y += 10;
    y = tableRow(doc, [
      { text: 'Wood subtotal (pre-tax)', w: 300 },
      { text: `$${p.wood_pretax.toFixed(2)}`, w: 100, align: 'right' },
    ], y, { bold: true });
    y = tableRow(doc, [
      { text: `Wood + tax (${(p.tax_rate * 100).toFixed(2)}%)`, w: 300 },
      { text: `$${p.wood_taxed.toFixed(2)}`, w: 100, align: 'right' },
    ], y);
    y = tableRow(doc, [
      { text: 'GRAND TOTAL (taxed wood + U-Haul tax + gas)', w: 300 },
      { text: `$${p.grand_taxed.toFixed(2)}`, w: 100, align: 'right' },
    ], y, { bold: true, fill: '#ccfbf1' });

    y += 28;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.header).text('Summary', 40, y);
    y += 16;
    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    doc.text(`2×4 boards to buy: ${p.board_2x4_qty}`, 40, y); y += 14;
    doc.text(`1×6 boards to buy: ${p.board_1x6_qty}`, 40, y); y += 14;
    doc.text(`Sheets to buy: ${p.sheet_qty}`, 40, y); y += 14;
    doc.text(`Structural lengths packed: ${result.structural.lengthCount} → ${result.structural.board_needed} boards`, 40, y); y += 14;
    doc.text(`Traverse lengths packed: ${result.traverse.lengthCount} → ${result.traverse.board_needed} boards`, 40, y); y += 20;

    if (result.notes) {
      doc.fontSize(9).fillColor(COLORS.muted).text(`Notes: ${result.notes}`, 40, y, { width: 520 });
    }

    drawFooter(doc, pageNum);
    doc.end();
  });
}
