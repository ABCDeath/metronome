# Phase 6: Training Mode - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-29
**Phase:** 6-training-mode
**Areas discussed:** Scheduler integration, Bar indicator UI

---

## Scheduler Integration

### Where should training-mode awareness live in the engine?

| Option | Description | Selected |
|--------|-------------|----------|
| All in AudioEngine | AudioEngine gains `_barCount`, training config, `_altBeats[]`. Bar-type derived from `_barCount` at each bar boundary. Self-contained, consistent with engine owning `_beats[]`. | ✓ |
| Thin config object passed in | `TrainingConfig` passed via `setTrainingConfig()`. Keeps training concept separate from engine core. | |

**User's choice:** All in AudioEngine
**Notes:** Mirrors the existing architecture — engine already owns `_beats[]`, `_stepInterval`, `_barStep`. Training config is just more of the same internal state.

---

### How should silent bars be handled in the scheduler?

| Option | Description | Selected |
|--------|-------------|----------|
| Write nothing to the ring | Skip all ring writes for steps in a silent bar. Worklet produces silence by default. Zero ring traffic. | ✓ |
| Write voice=2 (Silent) for every step | Write a silent-voice event per step. Consistent with per-beat voice model but adds unnecessary ring writes. | |

**User's choice:** Write nothing to the ring
**Notes:** Cleanest path — no events = no clicks. Avoids ring noise during silent bars.

---

### How should AudioEngine notify the UI of the current bar type?

| Option | Description | Selected |
|--------|-------------|----------|
| New callback: onBarTypeChange | `_onBarTypeChange(type, barIndex)` fired at each bar boundary. Mirrors `_onStateChange` pattern. | ✓ |
| Polling via a public getter | Expose `engine.currentBarType`. App.svelte polls it. Simpler but less reactive. | |

**User's choice:** `onBarTypeChange(type, barIndex)` callback
**Notes:** Consistent with the existing `_onStateChange` constructor-injection pattern.

---

## Bar Indicator UI

### How should the training mode bar indicator look?

| Option | Description | Selected |
|--------|-------------|----------|
| Cycle strip | Row of small blocks `[N] [N] [S] [S]` with current highlighted. Shows position-in-cycle at a glance. | ✓ |
| Text label only | Simple text: "Normal ▶ bar 2 of 4". Minimal footprint. | |

**User's choice:** Cycle strip (`[N] [N] [S] [S]` with current highlighted)
**Notes:** User confirmed the mockup preview. The strip is the primary feedback mechanism — seeing position in cycle matters more than just knowing the type.

---

### Where does the skips pattern beat grid appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Inside the training panel | Collapsible "Skips pattern" sub-section within the Training section. Normal pattern editing stays in its own section. | ✓ |
| Tab switcher in Pattern section | Pattern section gets "Normal" / "Skips" tabs. Training controls live elsewhere. | |

**User's choice:** Inside the training panel
**Notes:** Keeps the skips configuration co-located with the training mode controls. Main pattern section is unaffected.

---

## Claude's Discretion

None — user made explicit choices for all areas presented.

## Deferred Ideas

- All three bar types in one cycle (normal + silent + skips simultaneously) — user's "silent/skips" phrasing implies picking one; supporting all three is a future enhancement.
- Per-bar-type click sound selection — future settings panel (already in MEMORY.md deferred list).
- Visual beat position indicator (flashing active beat) — separate v2 roadmap item.
