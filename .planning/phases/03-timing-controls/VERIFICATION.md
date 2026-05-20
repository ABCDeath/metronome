---
phase: 03-timing-controls
verified: 2026-05-20T22:35:00Z
status: gaps_found
score: 5/6 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Rust tests all pass (cargo test)"
    status: failed
    reason: "test_phase_inc_reset_on_normal fails in parallel test run due to static mut data races across concurrent tests. The test passes in isolation but fails when the full suite runs concurrently. The production code path is correct; the test fixture does not use --test-threads=1 or per-test init guards."
    artifacts:
      - path: "rust/src/lib.rs"
        issue: "Tests share static mut globals (PHASE_INC, ACCENT_FREQ, ACCENT_AMP, SAMPLE_RATE). test_phase_inc_reset_on_normal reads PHASE_INC = 0.022675738 (CLICK_FREQ/SR, the init() default) after calling fill_output_buffer(0, 1, 0.0) for an accent trigger, because a concurrent test called init() and reset PHASE_INC between the trigger write and the assertion read. The Rust test harness runs tests in parallel by default; shared statics are not protected."
    missing:
      - "Add #[serial_test::serial] or equivalent to all tests that touch global statics, or restructure tests to not share mutable global state, so that cargo test passes reliably without --test-threads=1."
human_verification:
  - test: "Play button produces an audible accent click on beat 1 that is perceptibly different from other beats"
    expected: "Beat 1 click is higher in pitch (1400 Hz vs 1000 Hz) and/or louder (1.3x amplitude) than beats 2, 3, 4 when playing at 120 BPM, 4/4, quarter subdivision"
    why_human: "Audio output cannot be verified programmatically without a running AudioContext; requires human listening test in a browser"
  - test: "BPM slider updates tempo in real time when the metronome is running"
    expected: "Dragging the slider from 120 to 200 BPM audibly speeds up clicks immediately without stopping/restarting"
    why_human: "Real-time audio timing change requires browser AudioWorklet running; cannot verify from static analysis"
---

# Phase 3: Timing Controls Verification Report

**Phase Goal:** BPM, time signature, and subdivision controls connected to PatternState; beat 1 accent; user hears the correct pattern
**Verified:** 2026-05-20T22:35:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                          | Status      | Evidence                                                                                                |
|----|----------------------------------------------------------------|-------------|----------------------------------------------------------------------------------------------------------|
| 1  | User can set BPM 20-300 via slider, text input, +/-1/5 buttons | VERIFIED  | App.svelte: range input min=20 max=300, onBpmInput clamps Math.max(20, Math.min(300, val)), 4 step buttons (-5/-1/+1/+5), adjustBpm() clamps on every call |
| 2  | User can set time signature numerator (1-12) and denominator (2/4/8/16) | VERIFIED | App.svelte: number input min=1 max=12, onNumeratorInput clamps; select with options 2/4/8/16; onDenominatorChange writes to pattern.tracks[0].denominator |
| 3  | User can select subdivision (quarter, 8th, triplet, 16th)     | VERIFIED  | App.svelte: subdiv-group with 4 buttons; onSubdivisionChange() recomputes stepCount and beats; SUBDIV_MULT = {quarter:1, eighth:2, triplet:3, sixteenth:4} |
| 4  | Beat 1 accent produces distinct click (different freq/amp)    | VERIFIED  | rust/src/lib.rs: ACCENT_FREQ/ACCENT_AMP statics, set_accent_params() export, fill_output_buffer voice branch (voice==1 uses ACCENT_FREQ/ACCENT_AMP vs CLICK_FREQ/0.75); processor.js calls set_accent_params on 'update-accent' message; audio-engine.ts posts 'update-accent' from updatePattern() |
| 5  | PatternState shape is multi-track ready for Phase 4           | VERIFIED  | pattern.ts: PatternState type with tracks: Track[], BeatPosition {voice: number}, Track {stepCount, subdivision, denominator, beats}, accentFreqHz, accentAmpMillis |
| 6  | All tests pass (vitest + cargo test)                          | FAILED    | Vitest: 23/23 pass. Cargo test: 15 pass, 1 FAILED (test_phase_inc_reset_on_normal) — race condition on static mut state when tests run in parallel. Test passes in isolation (--test-threads=1). TypeScript: npx tsc --noEmit exits 0 (clean). |

**Score:** 5/6 truths verified

### Required Artifacts

| Artifact                               | Expected                                      | Status    | Details                                                              |
|----------------------------------------|-----------------------------------------------|-----------|----------------------------------------------------------------------|
| `src/App.svelte`                       | BPM, time sig, subdivision, accent UI         | VERIFIED  | 469 lines; all four control sections present and wired               |
| `src/lib/pattern.ts`                   | PatternState, Track, BeatPosition types       | VERIFIED  | 79 lines; full type exports + computeStepInterval, rebuildBeats, defaultPatternState |
| `src/lib/audio-engine.ts`              | updatePattern(), _schedulerTick() with voice  | VERIFIED  | 225 lines; updatePattern() computes interval, writes paramSAB, posts update-accent; _schedulerTick() packs voice bits |
| `rust/src/lib.rs`                      | ACCENT_FREQ/ACCENT_AMP statics, set_accent_params export, voice branch in fill_output_buffer | VERIFIED | All three present; voice==1 branch reads ACCENT_FREQ/ACCENT_AMP |
| `public/worklet/processor.js`          | set_accent_params calls, update-accent handler | VERIFIED | Constructor calls set_accent_params from paramSAB or defaults; port.onmessage handles 'update-accent' |
| `src/lib/pattern.test.ts`              | Vitest unit tests for pattern utilities       | VERIFIED  | 23 tests across computeStepInterval, rebuildBeats, defaultPatternState — all pass |

### Key Link Verification

| From                    | To                            | Via                                            | Status   | Details                                                        |
|-------------------------|-------------------------------|------------------------------------------------|----------|----------------------------------------------------------------|
| App.svelte $effect      | engine.updatePattern()        | pattern $state reactivity                      | WIRED    | $effect(() => engine.updatePattern(pattern)) fires on any field change |
| App.svelte accentPitchOn/accentAmpOn | pattern.accentFreqHz/accentAmpMillis | updateAccentParams() in $effect | WIRED | Second $effect calls updateAccentParams() which writes both fields |
| audio-engine.ts updatePattern() | processor.js set_accent_params | postMessage({type:'update-accent'})           | WIRED    | audio-engine.ts line 184; processor.js line 68-72 handles it  |
| audio-engine.ts _schedulerTick() | voice field in ring event | beat.voice bit-packed at bits 7-11 of Uint32   | WIRED    | event = (sampleOffset & 0x7F) | ((voice & 0x1F) << 7) | ...  |
| processor.js process()  | fill_output_buffer(sampleOffset, voice, 0.0) | evVoice extracted from event bits 7-11 | WIRED  | process() extracts evVoice = (event >> 7) & 0x1F; passes to fill_output_buffer |
| rust fill_output_buffer | ACCENT_FREQ/ACCENT_AMP statics | voice == 1 branch                              | WIRED    | if voice == 1 reads ACCENT_FREQ and ACCENT_AMP via addr_of!   |

### Data-Flow Trace (Level 4)

| Artifact         | Data Variable     | Source                              | Produces Real Data | Status   |
|------------------|-------------------|-------------------------------------|--------------------|----------|
| App.svelte       | pattern (PatternState) | defaultPatternState() + user input mutations | Yes — user-driven | FLOWING |
| audio-engine.ts  | _beats, _stepInterval | updatePattern() from PatternState track | Yes              | FLOWING  |
| processor.js     | voice param       | Uint32 ring event from main thread  | Yes — real packed event | FLOWING |
| rust/src/lib.rs  | ACCENT_FREQ/AMP   | set_accent_params() called from worklet | Yes             | FLOWING  |

### Behavioral Spot-Checks

| Behavior                            | Command                                                | Result      | Status |
|-------------------------------------|--------------------------------------------------------|-------------|--------|
| TypeScript compiles without errors  | npx tsc --noEmit -p tsconfig.app.json                  | exit 0, no output | PASS |
| Vitest unit tests                   | npx vitest run                                         | 23/23 passed | PASS  |
| Rust unit tests                     | cargo test --manifest-path rust/Cargo.toml             | 15 passed, 1 FAILED | FAIL |
| Failing test in isolation           | cargo test test_phase_inc_reset_on_normal (single test) | 1 passed  | PASS  |

### Requirements Coverage

| Requirement | Description                                              | Status          | Evidence                                        |
|-------------|----------------------------------------------------------|-----------------|-------------------------------------------------|
| TIMING-01   | BPM 20-300 via slider, number input, +/-1/5 buttons      | SATISFIED       | App.svelte range input min/max, onBpmInput clamp, step buttons |
| TIMING-02   | Time signature numerator (1-12) and denominator (2/4/8/16) | SATISFIED    | App.svelte num-input min=1 max=12, denom-select options 2/4/8/16 |
| TIMING-03   | Subdivision picker (quarter, 8th, triplet, 16th)         | SATISFIED       | App.svelte subdiv-group 4-button segmented control  |
| PATTERN-02  | Beat 1 accent distinct from other beats                  | SATISFIED (code) | rust/src/lib.rs voice branch; processor.js update-accent; audio-engine.ts updatePattern(); human audio test still needed |

### Anti-Patterns Found

| File                     | Line | Pattern                    | Severity | Impact                                          |
|--------------------------|------|----------------------------|----------|-------------------------------------------------|
| rust/src/lib.rs          | All tests | Tests share static mut globals without synchronization | BLOCKER | `test_phase_inc_reset_on_normal` fails when run in parallel with other tests that call init() or fill_output_buffer(). cargo test fails. |

### Human Verification Required

#### 1. Beat 1 Accent Audible Distinction

**Test:** Open the app in a browser, press Play at 120 BPM / 4/4 / Quarter subdivision. Listen to several bars.
**Expected:** Beat 1 click is clearly higher in pitch (1400 Hz vs 1000 Hz normal) and/or louder (1.3x) than beats 2, 3, 4. Toggle the Pitch and Amplitude checkboxes; the distinction should disappear when both are off.
**Why human:** Audio output requires a running AudioContext + AudioWorklet. Cannot verify from static analysis.

#### 2. Real-Time BPM Update While Playing

**Test:** Press Play, then drag the BPM slider from 120 to 200 while the metronome is running.
**Expected:** Tempo audibly increases immediately without stopping/restarting playback.
**Why human:** Real-time scheduler behavior requires the browser audio thread running.

### Gaps Summary

One gap blocks a clean pass: the Rust test `test_phase_inc_reset_on_normal` fails when `cargo test` runs tests in parallel. The test exercises Pitfall P3-03 (after an accent trigger, the next normal trigger must reset PHASE_INC to CLICK_FREQ/SR). The production code logic is correct — the test passes in isolation and the `fill_output_buffer` voice branch correctly sets PHASE_INC on every trigger. The failure is a test infrastructure defect: all tests in the suite write to the same `static mut` globals (`PHASE_INC`, `SAMPLE_RATE`, `ACCENT_FREQ`, `ACCENT_AMP`, `ACTIVE`), and Rust's default parallel test runner causes concurrent mutation. Adding `serial_test::serial` attributes or a `--test-threads=1` CI flag would resolve this without any production code change.

All UI controls (TIMING-01, TIMING-02, TIMING-03), the accent DSP chain (PATTERN-02), the PatternState type shape, and TypeScript compilation are verified clean.

---

_Verified: 2026-05-20T22:35:00Z_
_Verifier: Claude (gsd-verifier)_
