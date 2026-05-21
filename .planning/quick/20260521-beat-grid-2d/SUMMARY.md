---
status: complete
date: 2026-05-21
---

# Quick Task: Beat grid 2D layout for subdivisions

## What was built

Beat grid now renders as a 2D CSS grid when a subdivision is active:
- Columns = beats (numerator)
- Rows = subdivisions per beat (2 for 8th, 3 for triplet, 4 for 16th)
- Beat index mapping: cell at (col, row) = col * subdivPerBeat + row

Quarter notes keep the existing single-row layout. Column gap (10px) is
larger than row gap (4px) to visually distinguish beat boundaries.

## Files changed

- `src/App.svelte` — added `subdivPerBeat` $derived, conditional 2D grid template, `.beat-grid-2d` CSS class

## Verification

- `npx vitest run`: 27/27 pass
