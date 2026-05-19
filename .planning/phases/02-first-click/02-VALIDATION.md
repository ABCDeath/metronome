---
phase: 2
slug: first-click
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-19
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test` (Rust DSP unit tests) + manual browser verification |
| **Config file** | `rust/Cargo.toml` |
| **Quick run command** | `cargo test -p metronome-engine` |
| **Full suite command** | `cargo test -p metronome-engine && npm run typecheck` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p metronome-engine`
- **After Wave 1 (Rust DSP):** Run full suite + manual browser click verification
- **After Wave 2 (Scheduler):** Full suite + 60-second drift check in Chrome DevTools

---

## Wave 0: Test Scaffold

> Install test infrastructure before writing implementation code.

**Skip if:** Test infrastructure already exists.

### Tasks

- [ ] Verify `cargo test` runs in `rust/` directory
- [ ] Add `#[cfg(test)] mod tests` block to `rust/src/lib.rs`
- [ ] Add at least one placeholder test: `assert!(true)` to confirm test runner works

### Gate

```bash
cargo test -p metronome-engine 2>&1 | grep -q "test result: ok" && echo "PASS"
```

---

## Dimension 1: Unit Tests (DSP Logic)

**Coverage target:** Triangle wave generation + exponential decay envelope in Rust

### Tests Required

| Test | What it proves | Command |
|------|---------------|---------|
| `test_triangle_wave_at_zero` | Phase 0.0 → output 0.0 | `cargo test test_triangle` |
| `test_triangle_wave_at_quarter` | Phase 0.25 → output 1.0 (peak) | `cargo test test_triangle` |
| `test_triangle_wave_at_half` | Phase 0.5 → output 0.0 (zero crossing) | `cargo test test_triangle` |
| `test_triangle_wave_at_three_quarters` | Phase 0.75 → output -1.0 (trough) | `cargo test test_triangle` |
| `test_decay_starts_at_one` | At trigger, envelope gain = 1.0 | `cargo test test_decay` |
| `test_decay_after_529_samples` | After ~12ms (529 samples @ 44100Hz), gain ≈ 0.368 | `cargo test test_decay` |
| `test_no_trigger_produces_silence` | sample_offset=255 → all 128 output samples = 0.0 | `cargo test test_silence` |
| `test_sample_rate_agnostic` | Decay at 48000Hz: 576 samples yields gain ≈ 0.368 | `cargo test test_decay` |

### Acceptance

All 8 tests pass on `cargo test -p metronome-engine`.

---

## Dimension 2: Integration (AudioWorklet ↔ WASM)

**Coverage target:** Ring buffer read in process(), sample-accurate synthesis trigger

### Manual Verification Steps

1. Open Chrome DevTools → Console
2. Press Play
3. Verify "AudioWorklet ready" appears in console
4. Verify audible click sound (triangle wave woodblock character)
5. Open DevTools → Performance → record 10 seconds
6. Verify no GC spikes aligned with audio callbacks (zero allocations in process())

---

## Dimension 3: Timing (Drift-free 60 seconds)

**Coverage target:** TIMING-04 — scheduler writes events with <1ms jitter over 60 seconds

### Verification Method

1. Expose `audioCtx.currentTime` to console via a debug property on AudioEngine
2. Compare expected beat times vs. actual `currentTime` at each scheduler tick
3. After 60 seconds at 120 BPM (7200 beats), max drift should be < 10ms

### Automated Proxy

```bash
# TypeScript compiles without error (no type regressions in scheduler)
npm run typecheck 2>&1 | grep -q "error TS" && echo "FAIL" || echo "PASS"
```

---

## Dimension 4: Platform (PLATFORM-01)

**Coverage target:** macOS Chrome — Safari is explicitly deferred (D-09 from CONTEXT.md)

### Checklist

- [ ] macOS Chrome 120+: audible click, no console errors
- [ ] `crossOriginIsolated === true` logged in console (SharedArrayBuffer available)
- [ ] AudioContext created only on button click (no autoplay policy violation)

---

## Dimension 5: Security (STRIDE)

**Coverage target:** STRIDE threat mitigations from PLAN.md threat model

| Threat | Mitigation | Verification |
|--------|-----------|-------------|
| T-02-01: ring buffer data race | `Atomics.store`/`Atomics.load` only | Code review |
| T-02-02: fill_output_buffer unsafe | `static mut` with single-threaded access in WASM | Code review |
| T-02-03: process() allocation | No `new` in hot path | Code review + DevTools Memory tab |

---

## Nyquist Coverage Gaps

> Items that cannot be auto-tested and require manual sign-off:

1. **Audible click character** — Triangle wave woodblock-style sound requires human listening test. Cannot be automated.
2. **60-second drift** — Requires browser runtime; cannot be tested in `cargo test`.
3. **AudioContext gesture gate** — Browser policy enforcement; requires real user click event.

---

*Phase: 02-first-click*
*Validation created: 2026-05-19*
