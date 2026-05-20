---
phase: 3
slug: timing-controls
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-20
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Rust)** | `cargo test` (built-in) |
| **Config file (Rust)** | `#[cfg(test)] mod tests` in `rust/src/lib.rs` |
| **Quick run command** | `cargo test --manifest-path rust/Cargo.toml` |
| **Full suite command** | `cargo test --manifest-path rust/Cargo.toml && npx vitest run` |
| **Framework (TS)** | Vitest 3.x — **NOT YET INSTALLED** (Wave 0 gap) |
| **Config file (TS)** | `vitest.config.ts` — Wave 0 creates this |
| **Estimated runtime** | ~10 seconds (cargo) + ~5 seconds (Vitest after install) |

---

## Sampling Rate

- **After every task commit:** Run `cargo test --manifest-path rust/Cargo.toml`
- **After Wave 0 (test scaffold):** Run `cargo test && npx vitest run` — both green before Wave 1 starts
- **After Wave 1 (Rust DSP):** Full suite + manual accent listening test
- **After Wave 2 (Scheduler):** Full suite + BPM change mid-playback manual test
- **After Wave 3 (Svelte UI):** Full suite + browser integration tests
- **Before `/gsd:verify-work`:** Full suite must be green + all manual checks done

---

## Wave 0: Test Scaffold

> Install test infrastructure before writing implementation code.

**Skip if:** Vitest already installed and `vitest.config.ts` exists.

### Tasks

- [ ] `npm install --save-dev vitest` — install Vitest 3.x
- [ ] `vitest.config.ts` — minimal config: `{ test: { include: ['src/**/*.test.ts'] } }`
- [ ] `src/lib/pattern.test.ts` — placeholder tests for `defaultPatternState`, `rebuildBeats`, BPM clamping
- [ ] Rust: add placeholder test stubs in `rust/src/lib.rs` for `step_interval_formula`, `accent_amplitude_differs`, `phase_inc_reset_on_normal`

### Gate

```bash
cargo test --manifest-path rust/Cargo.toml 2>&1 | grep -q "test result: ok" && echo "CARGO PASS"
npx vitest run 2>&1 | grep -q "passed" && echo "VITEST PASS"
```

---

## Dimension 1: Unit Tests (DSP Logic — cargo test)

**Coverage target:** Rust accent DSP + step interval formula

### Tests Required

| Test | What it proves | Command |
|------|---------------|---------|
| `step_interval_formula` | (60/120)×(4/4)/1 = 0.5, (60/120)×(4/8)/1 = 0.25, (60/100)×(4/4)/1 = 0.6 | `cargo test step_interval` |
| `accent_amplitude_differs` | `fill_output_buffer(0, 1, 0.0)` peak amplitude > `fill_output_buffer(0, 0, 0.0)` peak | `cargo test accent_amplitude` |
| `accent_pitch_differs` | After voice=1 trigger: PHASE_INC ≈ 1400/sample_rate; after voice=0 trigger: PHASE_INC ≈ 1000/sample_rate | `cargo test accent_pitch` |
| `phase_inc_reset_on_normal` | Trigger accent then normal: PHASE_INC returns to 1000/sample_rate (Pitfall P3-03) | `cargo test phase_inc_reset` |
| `set_accent_params_roundtrip` | Call `set_accent_params(1400.0, 1.3)` → ACCENT_FREQ=1400, ACCENT_AMP=1.3 | `cargo test set_accent` |
| `bar_step_cycling` | `barStep % stepCount` wraps correctly across multiple bars | `cargo test bar_step` |

### Acceptance

All cargo tests pass: `cargo test --manifest-path rust/Cargo.toml 2>&1 | grep "test result: ok"`

---

## Dimension 2: Unit Tests (TypeScript — Vitest)

**Coverage target:** PatternState shape + BPM clamping + beats rebuild logic

### Tests Required

| Test | What it proves | Command |
|------|---------------|---------|
| `defaultPatternState` | `beats[0].voice === 1`, `beats[1..3].voice === 0`, `stepCount === 4`, `bpm === 120` | `npx vitest run pattern` |
| `rebuildBeats(stepCount)` | Returns exactly `stepCount` elements, `[0].voice === 1`, rest `voice === 0` | `npx vitest run pattern` |
| `BPM clamping` | Values < 20 clamped to 20, values > 300 clamped to 300, non-numeric rejected | `npx vitest run pattern` |
| `stepCount formula` | `4 × 1 = 4`, `4 × 2 = 8`, `3 × 3 = 9`, `7 × 1 = 7` for all subdivision multipliers | `npx vitest run pattern` |

### Acceptance

`npx vitest run 2>&1 | grep -q "passed"` — all tests green.

---

## Dimension 3: Integration (Browser Manual)

**Coverage target:** Real-time playback correctness under parameter changes

### Manual Verification Steps

| Test | Steps | Pass condition |
|------|-------|---------------|
| BPM change mid-playback | Start at 120 BPM, change to 200 BPM while playing | No burst of extra clicks, no skipped beat; tempo stabilizes within 100ms |
| Time-sig change | Play 4/4, change to 3/4 | Accent immediately returns to beat 1 of each 3-beat bar |
| Subdivision change | Change from quarter to 16th notes | Click rate quadruples; all clicks audible without clipping |
| BPM extremes | Play at 20 BPM, then 300 BPM, 60 seconds each | No audible drift |
| Play/Stop/Play | Change BPM while stopped, press Play | New tempo applies immediately; no event flood |

---

## Dimension 4: Nyquist Gaps (Human Listening Required)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Accent pitch audibly distinct | PATTERN-02 | Frequency difference (1400 vs 1000 Hz) requires human ear | Play at 120 BPM 4/4; confirm beat 1 sounds higher than other beats |
| Accent amplitude audibly distinct | PATTERN-02 | Amplitude difference (1.3× default) requires human perception | Confirm beat 1 is perceptibly louder at default accent amplitude setting |
| No audio artifacts at 300 BPM 16th | TIMING-01 | Stress test (1200 clicks/s) requires human quality check | Play 300 BPM 16th notes for 10 seconds; confirm no dropouts, pops, or ring overflow |
| Smooth BPM change feel | TIMING-01 | Musical naturalness requires human judgment | Change BPM mid-play; confirm no jarring tempo jump |

---

## Per-Task Verification Map

| Task | Plan | Wave | Requirement | Test Type | Command | File Exists | Status |
|------|------|------|-------------|-----------|---------|-------------|--------|
| Install Vitest | W0 | 0 | — | infra | `npx vitest run` | ❌ Wave 0 | ⬜ pending |
| Rust accent statics | 01 | 1 | PATTERN-02 | unit | `cargo test accent_amplitude` | ❌ Wave 0 | ⬜ pending |
| set_accent_params export | 01 | 1 | PATTERN-02 | unit | `cargo test set_accent` | ❌ Wave 0 | ⬜ pending |
| fill_output_buffer voice branch | 01 | 1 | PATTERN-02 | unit | `cargo test accent_pitch` | ❌ Wave 0 | ⬜ pending |
| Pitfall P3-03 (PHASE_INC reset) | 01 | 1 | PATTERN-02 | unit | `cargo test phase_inc_reset` | ❌ Wave 0 | ⬜ pending |
| updatePattern() + _stepInterval | 02 | 2 | TIMING-01 | unit | `cargo test step_interval` | ❌ Wave 0 | ⬜ pending |
| _barStep cycling + voice writes | 02 | 2 | TIMING-01/02/03 | unit | `cargo test bar_step` | ❌ Wave 0 | ⬜ pending |
| paramSAB slot 2/3 writes | 02 | 2 | PATTERN-02 | manual | Browser console check | — | ⬜ pending |
| PatternState $state + $effect | 03 | 3 | TIMING-01/02/03 | unit+manual | `npx vitest run` + browser | ❌ Wave 0 | ⬜ pending |
| BPM UI widget | 03 | 3 | TIMING-01 | manual | Browser: slider, ±1/±5, input | — | ⬜ pending |
| Time-sig + subdivision UI | 03 | 3 | TIMING-02/03 | manual | Browser: change time sig, hear pattern | — | ⬜ pending |
| Accent settings UI | 03 | 3 | PATTERN-02 | Nyquist | Browser: listen to beat 1 | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Validation Sign-Off

- [ ] All cargo tests pass (6 new test functions)
- [ ] Vitest installed and all TS unit tests pass (4 test functions)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 installs Vitest before Wave 1 DSP tasks begin
- [ ] All 4 manual integration tests checked
- [ ] All 4 Nyquist listening tests checked by user
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
