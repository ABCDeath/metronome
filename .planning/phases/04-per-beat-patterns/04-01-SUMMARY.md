---
phase: 04-per-beat-patterns
plan: "01"
subsystem: rust-dsp
tags: [wasm, rust, dsp, noise, prng, xorshift32, silent-voice, clamp]
dependency_graph:
  requires: []
  provides:
    - PRNG_STATE static + xorshift32_next() noise generator
    - voice==2 silent branch in fill_output_buffer
    - per-sample noise mixing + unconditional clamp
  affects:
    - rust/src/lib.rs (audio DSP engine — all WASM callers)
tech_stack:
  added: []
  patterns:
    - xorshift32 PRNG using addr_of_mut! static write pattern
    - unconditional per-sample noise mixing (no branch in hot path)
    - .clamp(-1.0_f32, 1.0_f32) intrinsic for clipping prevention
key_files:
  created: []
  modified:
    - rust/src/lib.rs
decisions:
  - "PRNG runs unconditionally every sample; noise_gain=0.0 produces exact 0.0 via IEEE 754 (no hot-path branch)"
  - "voice==2 silent branch is an empty block — ACTIVE never set, noise path runs outside trigger block"
  - "Clamp is mandatory per T-04-02: accent peak ~1.3 + 100% noise peak ~1.0 = ~2.3 before clamp"
metrics:
  duration: "~8 min"
  completed: "2026-05-21"
  tasks: 2
  files: 1
---

# Phase 4 Plan 01: PRNG xorshift32, Silent Voice, Noise Mixing + Clamp — Summary

**One-liner:** xorshift32 Marsaglia (13,17,5) white noise with voice==2 silent branch and mandatory per-sample clamp(-1.0, 1.0) in the Rust WASM DSP engine.

## What Was Built

Extended `rust/src/lib.rs` with three changes that complete the lowest-level Phase 4 DSP work:

1. **PRNG_STATE static + xorshift32_next()** — A `static mut PRNG_STATE: u32 = 12345` provides the non-zero seed required by xorshift32. The `xorshift32_next()` inline unsafe function implements the canonical Marsaglia shift triple (<<13, >>17, <<5) using the established `addr_of!`/`addr_of_mut!` static read/write pattern. The PRNG is called unconditionally on every sample in the output loop.

2. **voice==2 silent branch** — The trigger block in `fill_output_buffer` now has three branches: voice==2 (empty — no click, ACTIVE not set), voice==1 (accent), else voice==0 (normal). The noise mixing path is outside the trigger block and runs unconditionally regardless of voice.

3. **Per-sample noise mixing + clamp** — After computing `click_sample`, each iteration calls `xorshift32_next()`, converts `raw_noise as i32 as f32 / 2147483648.0 * noise_gain`, adds to the click sample, and clamps the result to `[-1.0_f32, 1.0_f32]`. The `noise_gain` parameter was renamed from `_noise_gain` (now active).

Four new cargo tests were added: `test_silent_voice_no_click`, `test_noise_produces_output`, `test_noise_zero_gain`, `test_clamp_prevents_clipping`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | PRNG_STATE + xorshift32_next() + voice==2 + noise mixing + clamp | 06cda80 | rust/src/lib.rs |
| 2 | Four cargo tests for new DSP paths | 06cda80 | rust/src/lib.rs |

## Verification

```
cargo build --manifest-path rust/Cargo.toml --target wasm32-unknown-unknown
# Finished dev profile — 0 errors, 0 warnings

cargo test --manifest-path rust/Cargo.toml -- --test-threads=1
# test result: ok. 20 passed; 0 failed
```

All four new tests pass. All 16 prior tests continue to pass.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. `noise_gain` is now a live parameter; it is passed from the worklet as `0.0` until Plan 04-02 wires paramSAB slot 4. This is intentional: the value `0.0` produces exact digital silence via IEEE 754 multiplication, so the stub produces correct behavior until the slot is wired.

## Threat Flags

None. All threat register entries for this plan were addressed:
- T-04-01 (PRNG_STATE tampering): accepted — non-cryptographic audio PRNG in single-threaded WASM.
- T-04-02 (fill_output_buffer clipping): mitigated — `.clamp(-1.0_f32, 1.0_f32)` applied per sample, verified by `test_clamp_prevents_clipping`.

## Self-Check: PASSED

- rust/src/lib.rs: FOUND (modified)
- Commit 06cda80: FOUND in git log
- PRNG_STATE static: FOUND at line 15
- xorshift32_next() fn: FOUND at lines 43-50
- voice==2 branch: FOUND at lines 65-68
- noise mixing + clamp: FOUND at lines 115-119
- 20/20 cargo tests pass
