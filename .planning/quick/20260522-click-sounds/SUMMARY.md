---
status: complete
date: 2026-05-22
---

# Quick Task: Multiple click sounds (Beep / Woodblock / Sticks)

## What was built

Global sound picker with three synthesized click types:
- **Beep** (default): triangle wave, 1000/1400 Hz, 12ms decay — unchanged
- **Woodblock**: sine wave, 600/900 Hz, 7ms decay — hollow, punchy
- **Sticks**: 30% high-freq triangle (3000 Hz) + 70% noise burst, 5ms decay — sharp crack

## Files changed

- `rust/src/lib.rs` — CLICK_SOUND static, set_click_sound() export, sine_sample(), wood/stick decay coefficients, match-based synthesis dispatch in fill_output_buffer
- `public/worklet/processor.js` — set-click-sound message handler
- `src/lib/audio-engine.ts` — setClickSound() method
- `src/App.svelte` — Sound picker section (reuses subdiv-group CSS)

## Verification

- `cargo test`: 20/20 pass
- `cargo xtask build`: WASM compiled successfully
- `npx vitest run`: 27/27 pass
