#!/usr/bin/env node
/**
 * verify_grid.js — prove an editorial page sits on its Müller-Brockmann grid.
 * Env: CHROME (chrome binary), PUP (puppeteer-core module path)
 */
const puppeteer = require(process.env.PUP || 'puppeteer-core');
const path = require('path');

const args = process.argv.slice(2);
const url = (args.find(a => !a.startsWith('--')))
  || ('file://' + path.join(process.cwd(), 'index.html'));
const opt = k => {
  const a = args.find(x => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : null;
};
const widths = (opt('widths') || '1440,1180,900').split(',').map(Number);
const BL = Number(opt('baseline') || 8);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-gpu', '--disable-dbus',
      '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars',
    ],
  });
  const page = await browser.newPage();
  let failed = false;

  for (const W of widths) {
    await page.setViewport({ width: W, height: 1000, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'load', timeout: 25000 });
    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (_) {}
    await new Promise(r => setTimeout(r, 500));

    const res = await page.evaluate((BL) => {
      const OPT = '.masthead, .numeral, .shead h2, .h2b';
      const grid = document.querySelector('.grid');
      if (!grid) return { error: 'no .grid' };
      const cs = getComputedStyle(grid);
      const tracks = cs.gridTemplateColumns.split(' ').map(parseFloat);
      const gap = parseFloat(cs.columnGap);
      const gr = grid.getBoundingClientRect();
      const L = []; const R = [];
      let x = gr.left;
      for (let i = 0; i < tracks.length; i++) {
        L.push(x); x += tracks[i]; R.push(x);
        if (i < tracks.length - 1) x += gap;
      }
      const nr = (v, arr) => arr.reduce((m, e) => Math.min(m, Math.abs(e - v)), 1e9);
      const nearest = (v, arr) => arr.reduce((b, e) => Math.abs(e - v) < Math.abs(b - v) ? e : b, arr[0]);

      let colErr = 0; let worst = null;
      document.querySelectorAll('.band > *').forEach(el => {
        if (el.matches(OPT)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2) return;
        const e = Math.max(nr(r.left, L), nr(r.right, R));
        if (e > colErr) { colErr = e; worst = (el.className || el.tagName).toString().slice(0, 28); }
      });

      let ovErr = 0;
      document.querySelectorAll('.guides .cols .col').forEach((c, i) => {
        const r = c.getBoundingClientRect();
        if (L[i] != null) ovErr = Math.max(ovErr, Math.abs(r.left - L[i]));
        if (R[i] != null) ovErr = Math.max(ovErr, Math.abs(r.right - R[i]));
      });

      let baseErr = 0;
      document.querySelectorAll('.spread').forEach(sp => {
        const rowsEl = sp.querySelector('.guides .rows');
        if (!rowsEl) return;
        const top = rowsEl.getBoundingClientRect().top;
        sp.querySelectorAll('.body,.lede,.cap,.kicker').forEach(el => {
          const t = el.getBoundingClientRect().top - top;
          const m = ((t % BL) + BL) % BL;
          baseErr = Math.max(baseErr, Math.min(m, BL - m));
        });
      });

      const cvs = document.createElement('canvas');
      const ctx = cvs.getContext('2d');
      let inkErr = 0; let inkWorst = null;
      document.querySelectorAll(OPT).forEach(el => {
        const c = getComputedStyle(el);
        let ch = (el.textContent || '').trim().charAt(0);
        if (!ch) return;
        if (c.textTransform === 'uppercase') ch = ch.toUpperCase();
        ctx.font = `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
        ctx.textAlign = 'left';
        const abl = ctx.measureText(ch).actualBoundingBoxLeft;
        const box = el.getBoundingClientRect().left;
        const target = nearest(box, L);
        const ink = box - abl;
        const e = Math.abs(ink - target);
        if (e > inkErr) {
          inkErr = e;
          inkWorst = `${(el.className || '').toString().slice(0, 20)} "${ch}"`;
        }
      });

      return {
        track: +tracks[0].toFixed(1),
        maxColErrPx: +colErr.toFixed(2),
        worstCol: worst,
        overlayErrPx: +ovErr.toFixed(2),
        maxBaselineOffPx: +baseErr.toFixed(2),
        maxInkOffPx: +inkErr.toFixed(2),
        worstInk: inkWorst,
      };
    }, BL);

    if (res.error) {
      console.log(`[FAIL] vw=${W}  ${res.error}`);
      failed = true;
      continue;
    }

    const pass = res.maxColErrPx <= 0.5
      && res.overlayErrPx <= 0.5
      && res.maxBaselineOffPx <= (BL / 2)
      && res.maxInkOffPx <= 1.0;
    if (!pass) failed = true;
    console.log(
      `[${pass ? 'PASS' : 'FAIL'}] vw=${W}  col=${res.maxColErrPx}px overlay=${res.overlayErrPx}px `
      + `baseline=${res.maxBaselineOffPx}px ink=${res.maxInkOffPx}px`
    );
  }

  await browser.close();
  if (failed) { console.error('GRID VERIFY: FAIL'); process.exit(1); }
  console.log('GRID VERIFY: PASS');
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
