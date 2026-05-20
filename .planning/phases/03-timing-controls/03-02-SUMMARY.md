---
phase: 03-timing-controls
plan: "02"
subsystem: rust-dsp
tags: [accent, dsp, wasm, cargo-test, voice-branch]
dependency_graph:
  requires: [03-01]
  provides: [accent-dsp-layer]
  affects: [public/worklet/processor.js, src/lib/audio-engine.ts]
tech_stack:
  added: []
  patterns:
    - "voice-branching trigger block in fill_output_buffer"
    - "addr_of_mut! static write pattern for ACCENT_FREQ/ACCENT_AMP"
    - "C ABI export set_accent_params — no wasm-bindgen"
key_files:
  created: []
  modified:
    - rust/src/lib.rs
decisions:
  - "PHASE_INC set unconditionally on every trigger (both voice=0 and voice=1) to implement P3-03 fix"
  - "ENVELOPE_GAIN set to amp (not hardcoded 1.0) so accent amplitude multiplier takes effect"
  - "Invalid voice values (>1) fall through to else branch — normal click, safe by default (T-03-02)"
metrics:
  duration: "~4 minutes"
  completed: "2026-05-20"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
---

# Phase 3 Plan 02: Accent DSP Extension Summary

**One-liner:** WASM engine extended with ACCENT_FREQ/ACCENT_AMP statics, set_accent_params export, and voice-branching trigger block so voice=1 produces 1400 Hz / 1.3x amplitude accent clicks.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add accent statics, set_accent_params, voice branch | c55ce4d | rust/src/lib.rs |
| 2 | Replace placeholder test stubs with real assertions | d96d8c8 | rust/src/lib.rs |

## What Was Built

**Task 1 — Rust DSP changes to `rust/src/lib.rs`:**

- Added `static mut ACCENT_FREQ: f32 = 1400.0` and `static mut ACCENT_AMP: f32 = 1.3` statics after the existing static block (lines 13–14)
- Added `#[no_mangle] pub extern "C" fn set_accent_params(freq_hz: f32, amp: f32)` export between `init()` and the test module
- Renamed `_voice` parameter to `voice` in `fill_output_buffer` (parameter is now active)
- Replaced unconditional trigger block with voice-branching block:
  - `voice == 1`: reads ACCENT_FREQ/ACCENT_AMP statics
  - else: uses CLICK_FREQ (1000.0) / 1.0_f32
  - PHASE_INC set on EVERY trigger (P3-03 fix)
  - ENVELOPE_GAIN set to `amp` (not hardcoded 1.0)

**Task 2 — Test replacements:**

Replaced 4 `assert!(true)` placeholder stubs with real test implementations. All 16 `cargo test` suite passes.

| Test | What it verifies |
|------|-----------------|
| test_set_accent_params_roundtrip | ACCENT_FREQ/AMP statics updated by set_accent_params |
| test_accent_pitch_differs | PHASE_INC = 1400/SR for voice=1, 1000/SR for voice=0 |
| test_accent_amplitude_differs | Accent peak amplitude > normal peak (1.3 > 1.0) |
| test_phase_inc_reset_on_normal | P3-03: PHASE_INC restored to CLICK_FREQ/SR after accent→normal |
| test_bar_step_cycling | Unchanged — real modulo assertions from Wave 0 |

## Verification

```
cargo build --manifest-path rust/Cargo.toml --target wasm32-unknown-unknown --release
# → Finished `release` profile [optimized] target(s)

cargo test --manifest-path rust/Cargo.toml
# → test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None — all Phase 3 test stubs replaced with real assertions.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or trust boundaries introduced. Only pure Rust DSP static mutation inside single-threaded WASM.

## Self-Check: PASSED

- [x] `rust/src/lib.rs` exists and contains `ACCENT_FREQ`, `ACCENT_AMP`, `set_accent_params`
- [x] Commit `c55ce4d` exists (feat Task 1)
- [x] Commit `d96d8c8` exists (test Task 2)
- [x] No `assert!(true)` placeholder in Phase 3 stubs
- [x] All 16 cargo tests pass
