---
status: complete
date: 2026-10-08
---

# Fix metronome silence after timestamp rollover

## Root cause

Beat events encode quantum indices modulo 2^20, but the worklet compared them with an increasing, signed 32-bit truncated AudioContext quantum. At the first 20-bit rollover (about 46.6 minutes at 48 kHz), current and future beats were discarded as stale. Stop/Play retained the context clock and could not recover clicks.

## Changes

- `public/worklet/processor.js`: compare signed modular distance in the existing 20-bit timestamp range. Current events trigger, stale events are discarded, and future events remain queued across rollover. The callback retains zero allocations.
- `src/lib/audio-engine.ts`: document the timestamp wrap and consumer comparison in the producer's event layout.
- `src/lib/worklet-processor.test.ts`: 17 regression tests execute the real processor script using simulated audio globals and a stub WASM renderer. They cover rollover, future/stale event ordering, repeated rollover, two days of audio time, clocks beyond signed/unsigned 32-bit quantum ranges, and ring reset with a retained clock. No generated WASM asset is required by the JS suite.

## Verification

- Before the fix, 12 of the 17 new tests failed with the original processor.
- After the fix, the full Vitest suite passed: 62 tests across three files.
- `npm run typecheck`: passed.
- Production build to `/private/tmp/metronome-rollover-fix-build-20261008`: passed.
- Real Rust WASM integration: 24 clock/sample-rate combinations passed at 44.1, 48, 96, and 192 kHz, including rollover and long-lived clocks.
- The built worklet matches the corrected source, and its content revision is present in the generated service worker manifest.

## Limits and follow-up

Modular event ordering requires event distance to be less than 2^19 quanta. The scheduler's normal 100 ms lookahead is well within this range. Very long main-thread stalls still need explicit queue resynchronization in follow-up scheduling work. Browser/device soak testing was not performed; clocks were advanced in a Node AudioWorklet harness. Lifecycle serialization, processor error recovery, audio-thread sequencing, and cache restructuring remain separate follow-ups.
