---
name: muller-brockmann-grid
description: >-
  Build editorial/magazine/report webpages on a GENUINE Müller-Brockmann modular
  grid (International Typographic Style). Use for magazine spreads, Swiss design,
  editorial layouts, grid overlay toggles, and verifiable column/baseline alignment.
  Prevents overlay-misaligned and display-ink-off-grid failure modes.
---

# Müller-Brockmann Grid Systems — built real, visible, and verified

Josef Müller-Brockmann (1914–1996), Zurich; *Grid Systems in Graphic Design* (1981).
The grid is an ethic, not decoration.

> Two review notes this skill prevents:
> 1. *"the grid is just slapped on top and misaligned"* → overlay wasn't in the same content box (§2.2).
> 2. *"the H in the headline is off the grid"* → BOX on grid, INK not; side-bearing (§2.6). **Box-on-grid ≠ ink-on-grid.**

## When to use

Editorial / magazine / report / longform pages that must read as rigorously grid-aligned Swiss ITS. Triggers: « magazine spread », « grid system », « Swiss design », « editorial layout », « show the grid ».

## Part 1 — Discipline

- Modular grid: columns + rows, gutters, margins. Web default: **12-col + 8px baseline**.
- Baseline: leading = whole multiple of baseline; every element snaps.
- Type: grotesque sans (Archivo / Helvetica Now — prefer Archivo over Inter in this repo). Flush-left, ragged-right. Large numerals.
- Palette: white `#fff`, ink `#111`, accent Swiss red `#e4002b`. No cream Claude look; no blue/purple gradients.
- Generous white space + asymmetry held by the grid.

## Part 2 — Make the grid real

1. One `:root` source of truth: `--cols, --gutter, --margin, --bl, --lh, --maxw`.
2. Overlay `.guides` **inside** the same `.wrap` as content (not a full-width sibling).
3. Subgrid `.band` — place children by column line (`grid-column: 1 / 6`).
4. Vertical rhythm: px line-heights multiples of `--bl`; media heights multiples of `--lh`.
5. Toggle: button + `G` key → `body.grid-on`.
6. Optical alignment JS: nudge display type so **ink** lands on the column line.

## Part 3 — Verify

```bash
python3 .cursor/skills/muller-brockmann-grid/scripts/grid_tokens.py --scaffold > /tmp/mb.html
CHROME=… PUP=… node .cursor/skills/muller-brockmann-grid/scripts/verify_grid.js file:///tmp/mb.html --widths=1440,1180,900
```

Target: `col=0px overlay=0px baseline≤4px ink=0px` → `GRID VERIFY: PASS`.

## Scripts

- `scripts/grid_tokens.py` — scaffold generator (`--scaffold`, `--cols`, `--baseline`, …)
- `scripts/verify_grid.js` — Puppeteer harness (env `CHROME`, `PUP`)

## Creed

A grid you can't toggle on and measure is a mood board, not a system. Build from one source of truth, prove at 0px, align the **ink**.
