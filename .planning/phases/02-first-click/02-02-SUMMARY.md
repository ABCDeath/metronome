---
phase: 02-first-click
plan: "02"
subsystem: audio-scheduling
tags: [scheduler, ring-buffer, spsc, audioworklet, wasm, typescript]
dependency_graph:
  requires: [02-01]
  provides: [lookahead-scheduler, ring-consumer, audible-clicks-120bpm]
  affects: [src/lib/audio-engine.ts, public/worklet/processor.js]
tech_stack:
  added: []
  patterns:
    - "setInterval 25ms lookahead scheduler with 100ms window — main thread beat producer"
    - "SPSC ring Atomics.store/load — zero-copy beat event transfer across thread boundary"
    - "u32 event encoding: bits 0-6 sampleOffset, 7-11 voice, 12-31 quantumIndex"
    - "(currentFrame / 128) | 0 — integer truncation for quantum matching, no Math.floor"
    - "Stale event drain: evQuantum < myQuantum consumed to prevent ring stall"
key_files:
  created: []
  modified:
    - src/lib/audio-engine.ts
    - public/worklet/processor.js
decisions:
  - "nextBeatTime seeded to audioCtx.currentTime on start() — not 0.0 — prevents ring flood on first tick (RESEARCH Pitfall 2, T-02-06)"
  - "clearInterval + Atomics.store ring reset in stop() before suspend() — prevents stale events on Play/Stop/Play cycle (RESEARCH Pitfall 4, T-02-04)"
  - "Stale event drain added (evQuantum < myQuantum path) — PATTERNS.md noted it as optional; added as correctness requirement to prevent ring stall after timing skew"
metrics:
  duration: "~20 min"
  completed: "2026-05-19"
  tasks_completed: 2
  files_modified: 2
---

# Phase 2 Plan 2: Scheduler + Ring Consumer Summary

**One-liner:** Lookahead scheduler (25ms interval, 100ms window) writing u32 beat events to SPSC ring; AudioWorklet ring consumer with quantum matching calls WASM fill_output_buffer at 120 BPM.

## What Was Built

### `src/lib/audio-engine.ts`

Added 4 private fields:
- `_schedulerIntervalId: ReturnType<typeof setInterval> | null` — holds the interval handle
- `_nextBeatTime: number` — wall-clock time of the next beat to schedule
- `_controlRingIndices: Int32Array | null` — producer-side view of ring read/write indices
- `_controlRingData: Uint32Array | null` — producer-side view of ring event slots

`start()` extended:
- Creates `Int32Array` and `Uint32Array` views over `_controlRingSAB` immediately after SAB allocation
- Seeds `_nextBeatTime = audioCtx.currentTime` (not 0 — Pitfall 2)
- Starts `setInterval(() => this._schedulerTick(), 25)`

`stop()` extended (before `suspend()`):
- `clearInterval(_schedulerIntervalId)` + null reset
- `Atomics.store(_controlRingIndices, 0, 0)` + `Atomics.store(_controlRingIndices, 1, 0)` — ring clear

`_schedulerTick()` new method:
- 100ms lookahead window
- Computes `quantumIndex = Math.floor(beatSampleAbs / 128)`
- Packs `event = (sampleOffset & 0x7F) | (quantumIndex << 12)`
- SPSC write with full-check: `nextWrite !== readIdx` before committing
- Advances `_nextBeatTime += 60.0 / 120` (fixed 120 BPM)

### `public/worklet/processor.js`

`process()` updated:
- Reads ring: `Atomics.load(this._ringIndices, 0/1)` — no allocation
- Decodes event: `evOffset = event & 0x7F`, `evVoice = (event >> 7) & 0x1F`, `evQuantum = (event >> 12) | 0`
- Quantum match: `myQuantum = (currentFrame / 128) | 0`
- Consumes matching events (advance readIdx via `Atomics.store`)
- Drains stale events (`evQuantum < myQuantum`)
- Updates `fill_output_buffer` call to 3-arg form: `(sampleOffset, voice, 0.0)` per D-05
- Zero allocations — no `new`, no object literals, no string ops inside `process()`

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 5a955b8 | feat | Wire lookahead scheduler and ring buffer consumer for audible clicks |

## Verification

```
npm run typecheck: exit 0 (tsc --noEmit passes)
cargo xtask build: exit 0 (WASM compiled with 3-arg fill_output_buffer signature)
Manual browser verification (macOS Chrome): APPROVED by user
- Audible click at ~120 BPM (2 clicks/second, percussive woodblock character)
- 60-second sustained test: evenly spaced, no audible drift, no gaps, no double-clicks
- Stop: audio silences immediately
- Play/Stop/Play cycle: resumes correctly, no stale event burst on restart
- Console: "[AudioEngine] AudioWorklet ready", no errors
- crossOriginIsolated === true confirmed in Chrome DevTools
- Chrome Performance tab: no GC spikes aligned with audio callbacks (zero allocations confirmed)
```

## Deviations from Plan

### Auto-added functionality

**1. [Rule 2 - Missing Critical Functionality] Stale event drain path**
- **Found during:** Task 1 implementation
- **Issue:** PATTERNS.md noted the `evQuantum < myQuantum` drain as "add else branch if needed" (optional). Without it, a stale event permanently occupies the ring head, blocking all subsequent beats from being consumed — the consumer would see `readIdx !== writeIdx` but always skip (evQuantum > myQuantum never fires on new events either if head is stuck).
- **Fix:** Added `else if (evQuantum < myQuantum)` branch that consumes stale events via `Atomics.store` advance.
- **Files modified:** `public/worklet/processor.js`

## Known Stubs

None. The scheduler is fully wired: Play → scheduler → ring → worklet → WASM fill_output_buffer → audio output. BPM is fixed at 120 (Phase 3 will wire it to UI state).

## Threat Flags

No new threat surface beyond the plan's threat model. All T-02-03 through T-02-06 mitigations implemented as specified.

## Self-Check: PASSED

- [x] `src/lib/audio-engine.ts` modified — contains `_schedulerIntervalId`, `_nextBeatTime`, `_controlRingIndices`, `_controlRingData`
- [x] `_schedulerTick()` method present with `while (this._nextBeatTime`
- [x] `start()` seeds `_nextBeatTime = this._audioCtx!.currentTime`
- [x] `start()` contains `setInterval`
- [x] `stop()` contains `clearInterval` before `suspend()`
- [x] `stop()` contains `Atomics.store` (ring clear)
- [x] `processor.js` contains `Atomics.load(this._ringIndices, 0)` (ring read)
- [x] `processor.js` contains `(currentFrame / 128) | 0` (quantum matching)
- [x] `processor.js` contains `fill_output_buffer(sampleOffset, voice, 0.0)` (3-arg)
- [x] `processor.js` does NOT contain `new ` inside `process()`
- [x] `npm run typecheck` exits 0
- [x] `cargo xtask build` exits 0
- [x] Commit 5a955b8 exists in git log
- [x] User approved macOS Chrome browser verification (Task 2 checkpoint)
