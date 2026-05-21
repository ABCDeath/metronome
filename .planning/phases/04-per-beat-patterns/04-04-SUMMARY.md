# Plan 04-04 Summary — App.svelte Beat Grid + Noise Slider

**Status:** Complete (human-verified)
**Commits:**
- `0d77246` feat(04-04): beat grid + noise slider — Pattern section, cycleBeatVoice, setNoiseGain wiring
- `ccb2f13` fix(04-04): rescale noise slider — 100% maps to gain 0.025 instead of 1.0
**Date:** 2026-05-21

## What Was Built

**src/App.svelte — six change sites:**

1. `noiseLevel = $state(0)` — new state for noise slider (0–100 integer)
2. `cycleBeatVoice(i)` — cycles beat voice 0→1→2→0 via direct Svelte 5 $state property mutation; triggers existing `$effect → engine.updatePattern()` automatically
3. `onNoiseInput(e)` — reads slider value, calls `engine.setNoiseGain(Math.round(noiseLevel * 0.25))` (maps 0–100 → 0–25 millis → gain 0.0–0.025)
4. Both `rebuildBeats()` call sites updated to pass `pattern.tracks[0].beats` as second arg — merge-preserving on time-sig/subdivision change
5. Pattern section (HTML) — beat grid with `{#each}` over beats, per-beat class/label/aria derived inline, `cycleBeatVoice(i)` on click
6. Noise section (HTML) — range input 0–100 + `{noiseLevel}%` readout

**CSS added:** `.beat-grid`, `.beat-cell`, `.beat-cell-normal/accent/silent` (with hover states), `.noise-slider`, `.noise-value`

## Human Verify Results

All 6 checks passed:
- Beat cycling: N → A → — → N ✓
- Assignment persistence across time-sig/subdivision changes ✓
- Noise slider before Play: no TypeError ✓
- Noise slider during Play: audible, no distortion ✓
- 100% noise + accent: no clipping ✓
- Noise on silent beat: audible (noise is unconditional) ✓

**Post-approval fix:** Noise gain rescaled from ×10 (max 1.0) to ×0.25 (max 0.025) — 100% slider is now perceptibly subtle rather than overwhelming.
