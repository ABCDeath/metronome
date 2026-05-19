---
phase: 02-first-click
plan: "01"
subsystem: rust-dsp
tags: [rust, wasm, dsp, triangle-wave, envelope, tdd]
dependency_graph:
  requires: []
  provides: [fill_output_buffer-v2, triangle-wave-synthesis, exponential-decay-envelope]
  affects: [public/worklet/processor.js]
tech_stack:
  added: []
  patterns:
    - "triangle_sample as #[inline(always)] fn — extracted from fill_output_buffer hot path"
    - "static mut + addr_of!/addr_of_mut! for zero-allocation DSP state"
    - "exp(-1/decay_samples) for sample-rate-agnostic exponential decay coefficient"
    - "NO_BEAT_SENTINEL=0xFF — unambiguous sentinel for 7-bit sample_offset range"
key_files:
  created: []
  modified:
    - rust/src/lib.rs
decisions:
  - "triangle_sample formula: (phase - 0.5).abs() * 4.0 - 1.0 — phase=0.0 gives 1.0, phase=0.5 gives -1.0 (RESEARCH formula is authoritative; PLAN boundary table was inverted but formula is correct)"
  - "Phase wrap via subtraction (if new_phase >= 1.0 { new_phase -= 1.0 }) — avoids float division per RESEARCH.md anti-pattern"
  - "Envelope state (ACTIVE, ENVELOPE_GAIN, PHASE_ACCUM) persists across fill_output_buffer calls — required for cross-quantum decay tail"
metrics:
  duration: "~15 min"
  completed: "2026-05-19"
  tasks_completed: 1
  files_modified: 1
---

# Phase 2 Plan 1: Click DSP Synthesis Summary

**One-liner:** Triangle wave DSP synthesis (1000Hz, 12ms exponential decay) with 11 Rust unit tests covering boundary values, envelope math, sentinel silence, and cross-quantum decay persistence.

## What Was Built

Updated `rust/src/lib.rs` from the Phase 1 silence stub to a working click synthesizer:

- **`fill_output_buffer(sample_offset: u32, _voice: u32, _noise_gain: f32)`** — new 3-argument signature per D-05; replaces the Phase 1 2-argument stub
- **`triangle_sample(phase: f32) -> f32`** — `#[inline(always)]` DSP helper; maps `[0.0, 1.0)` → `[-1.0, 1.0]`
- **`init(sample_rate: f32)`** — extended to compute `PHASE_INC` and `DECAY_COEFF` from sample rate
- **5 new `static mut` statics:** `PHASE_ACCUM`, `PHASE_INC`, `ENVELOPE_GAIN`, `DECAY_COEFF`, `ACTIVE`
- **4 compile-time constants:** `CLICK_FREQ=1000.0`, `DECAY_MS=12.0`, `SILENCE_THRESHOLD=1e-4`, `NO_BEAT_SENTINEL=0xFF`
- **11 Rust unit tests** in `#[cfg(test)] mod tests` block

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | 58c2af0 | test(02-01): add failing tests — compile errors confirmed |
| GREEN + REFACTOR | 1218da0 | feat(02-01): implement DSP — 11/11 pass, no warnings |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 58c2af0 | test | RED: 11 failing tests for triangle wave + envelope DSP |
| 1218da0 | feat | GREEN+REFACTOR: full DSP implementation, all tests pass |

## Verification

```
cargo test -p metronome-engine: test result: ok. 11 passed; 0 failed
No heap allocations (grep Vec/Box/String: 0 matches in production code)
fill_output_buffer signature: (sample_offset: u32, _voice: u32, _noise_gain: f32) — confirmed
```

## Deviations from Plan

### Auto-noted differences

**1. [Clarification] Triangle wave boundary values differ from PLAN.md table**
- **Found during:** Writing RED tests for `triangle_wave_at_phase_0`
- **Issue:** PLAN.md frontmatter `truths` says `phase=0.0 → -1.0, phase=0.5 → 1.0`, but the RESEARCH.md formula `(phase - 0.5).abs() * 4.0 - 1.0` produces `phase=0.0 → 1.0, phase=0.5 → -1.0` (inverted). The RESEARCH document labels this formula "Verified Pattern" and both CONTEXT.md and PATTERNS.md cite it.
- **Resolution:** Used RESEARCH.md formula as authoritative (it is the formula that will actually run in WASM). Tests assert the formula's actual values. The boundary table in PLAN.md appears to have been written with an inverted polarity convention — both are valid triangle waves; only polarity differs, which is inaudible in practice.
- **Files modified:** None beyond normal — test assertions reflect the actual formula.

**2. [Rule 3 - Auto-fix] Redundant `unsafe` block warnings in tests**
- **Found during:** REFACTOR phase (GREEN cargo build showed 2 warnings)
- **Issue:** `init()` is not marked `unsafe` (it takes no unsafe actions from Rust's type system perspective — the `unsafe` is internal), so wrapping calls to it in `unsafe {}` produced `unused_unsafe` warnings.
- **Fix:** Removed the outer `unsafe {}` wrapper from `init(44100.0)` and `init(48000.0)` calls in the two decay coefficient tests.
- **Files modified:** `rust/src/lib.rs` (2 test lines)

## Known Stubs

None. The DSP synthesis is fully implemented. The `_voice` and `_noise_gain` parameters are intentionally ignored per the plan (voice accent = Phase 3 scope; noise mixing = Phase 3 scope).

## Threat Flags

No new threat surface introduced. T-02-01 mitigated: the `sample_offset == NO_BEAT_SENTINEL` check in the loop condition ensures samples before the trigger offset output 0.0, and the sentinel value 0xFF (255) is outside the valid 0–127 range, preventing OOB indexing.

## Self-Check: PASSED

- [x] `rust/src/lib.rs` exists and was modified
- [x] Commit 58c2af0 (RED) exists in git log
- [x] Commit 1218da0 (GREEN+REFACTOR) exists in git log
- [x] `cargo test -p metronome-engine` passes: 11/11
- [x] `fill_output_buffer` signature is `(sample_offset: u32, _voice: u32, _noise_gain: f32)`
- [x] No Vec, Box, String in production code
- [x] `triangle_sample` extracted as `#[inline(always)]`
- [x] DECAY_COEFF computed from SAMPLE_RATE at init time (sample-rate-agnostic)
