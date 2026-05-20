---
phase: 03-timing-controls
plan: "03"
subsystem: audio-engine
tags: [audio-worklet, scheduler, pattern-state, accent, shared-array-buffer, wasm]

# Dependency graph
requires:
  - phase: 03-timing-controls
    plan: "01"
    provides: PatternState types and SUBDIV_MULT from src/lib/pattern.ts
  - phase: 03-timing-controls
    plan: "02"
    provides: set_accent_params WASM export and voice-branching in fill_output_buffer
provides:
  - AudioEngine.updatePattern() method wired to PatternState
  - Dynamic _stepInterval computed from D-08 formula (BPM / denominator / subdivMult)
  - Voice encoding in ring events (_beats[stepIndex].voice bits 7-11)
  - _barStep cycling with reset on stepCount change (P3-02)
  - paramSAB slots 2 and 3 written with accentFreqHz and accentAmpMillis
  - Worklet calls set_accent_params at WASM init and on 'update-accent' messages
affects:
  - 03-04-PLAN.md (App.svelte wires PatternState $state to engine.updatePattern via $effect)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "updatePattern() computes stepInterval = (60/bpm) * (4/denominator) / subdivMult (D-08)"
    - "barStep reset on stepCount change guards against OOB index (Pitfall P3-02)"
    - "_paramBuffer null-guard before Atomics.store (Pitfall P3-04)"
    - "Worklet reads paramSAB slots at WASM init; falls back to 1400 Hz / 1.3x safe defaults"
    - "Dual-path accent update: paramSAB write + postMessage 'update-accent' for immediate effect"

key-files:
  created: []
  modified:
    - src/lib/audio-engine.ts
    - public/worklet/processor.js

key-decisions:
  - "PatternState types imported from ./pattern.js; SUBDIV_MULT used for subdivision multiplier lookup"
  - "updatePattern() does NOT modify _nextBeatTime (Pitfall P3-01: would reset scheduler clock)"
  - "Both paramSAB write AND postMessage sent in updatePattern() — paramSAB for init-time priming, postMessage for live updates when already running"
  - "Worklet falls back to 1400 Hz / 1.3x defaults if _paramBuffer is null at WASM init time (race condition safety)"

patterns-established:
  - "Pattern 1: Dual-path accent update — Atomics.store for persistence + postMessage for immediacy"
  - "Pattern 2: stepIndex = _barStep % _stepCount; voice = _beats[stepIndex]?.voice ?? 0 (safe OOB)"
  - "Pattern 3: set_accent_params called unconditionally at worklet init with defaults if SAB not yet ready"

requirements-completed: [TIMING-01, TIMING-02, TIMING-03, PATTERN-02]

# Metrics
duration: ~12min
completed: 2026-05-20
---

# Phase 3 Plan 03: Scheduler Extension and paramSAB Accent Wiring Summary

**AudioEngine extended with updatePattern() using D-08 step interval formula, voice-encoded ring events cycling through _beats[], and dual-path accent param propagation to WASM via paramSAB + postMessage.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-20T08:44:16Z
- **Completed:** 2026-05-20T08:56:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `AudioEngine.updatePattern(state: PatternState)` computes `_stepInterval` via D-08 formula, updates `_beats` and `_stepCount`, resets `_barStep` on stepCount change (P3-02), writes accent params to paramSAB slots 2/3 (null-guarded), and sends `update-accent` postMessage to worklet
- `_schedulerTick()` now computes `stepIndex = _barStep % _stepCount`, reads `voice = _beats[stepIndex]?.voice ?? 0`, encodes voice bits 7-11 in ring events, uses `_stepInterval` (not hardcoded 60/120), and increments `_barStep`
- `stop()` resets `_barStep = 0` so playback restarts from beat 0
- Worklet calls `set_accent_params` at WASM init (reads paramSAB if available, falls back to 1400 Hz / 1.3x) and handles `update-accent` messages in `port.onmessage`; `process()` unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add updatePattern(), new fields, voice encoding in AudioEngine** - `bb02696` (feat)
2. **Task 2: Wire worklet to call set_accent_params at init and on accent update** - `7f43e35` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/lib/audio-engine.ts` - Added imports from pattern.js, 5 new private fields, _paramBuffer view in start(), _barStep reset in stop(), updatePattern() method, voice encoding and _stepInterval usage in _schedulerTick()
- `public/worklet/processor.js` - Added set_accent_params call after init(sampleRate) in WASM instantiation callback (with paramSAB read + fallback), added 'update-accent' branch in port.onmessage handler

## Decisions Made

- `updatePattern()` imports `SUBDIV_MULT` from `./pattern.js` rather than inlining the map — consistent with the single source of truth established in Plan 01
- Both `Atomics.store` to paramSAB AND `postMessage` are sent in `updatePattern()`: paramSAB persists the value for the worklet's init-time read, while postMessage provides immediate WASM update when the engine is already running
- Worklet falls back to `set_accent_params(1400.0, 1.3)` if `_paramBuffer` is null at WASM init — handles the race where `init-buffers` message hasn't arrived yet
- `_barStep` is reset in `stop()` so that every Play press starts from beat 0 (the accent beat)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `cargo test` showed test state contamination during git stash investigation (false failure) — tests pass cleanly in normal execution; all 16 cargo tests confirmed passing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 2 complete: `AudioEngine.updatePattern()` exists and is fully wired; worklet calls `set_accent_params` at init and on message
- Plan 03-04 (App.svelte UI) can import `PatternState`, `defaultPatternState` from `./lib/pattern.js` and call `engine.updatePattern(pattern)` via Svelte `$effect`
- The full data flow is: App.svelte `$state<PatternState>` → `updatePattern()` → paramSAB + postMessage → worklet `set_accent_params` → WASM ACCENT_FREQ/ACCENT_AMP statics

## Known Stubs

None — all wiring is real. Accent is not yet audible until Plan 03-04 ships App.svelte controls that set voice=1 patterns; the infrastructure is in place.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or trust boundaries. postMessage carries only same-origin accent params (f32); values are UI-clamped at the source.

---

## Self-Check: PASSED

- [x] `src/lib/audio-engine.ts` exists and contains `updatePattern`, `_stepInterval`, `_barStep`, `_paramBuffer`
- [x] `public/worklet/processor.js` contains 4 occurrences of `set_accent_params` (init read-from-SAB path, init fallback path, update-accent handler)
- [x] Commit `bb02696` exists (feat Task 1)
- [x] Commit `7f43e35` exists (feat Task 2)
- [x] `npx tsc --noEmit -p tsconfig.app.json` exits 0
- [x] `cargo build --target wasm32-unknown-unknown --release` exits 0
- [x] All 16 `cargo test` pass

*Phase: 03-timing-controls*
*Completed: 2026-05-20*
