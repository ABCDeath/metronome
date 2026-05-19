# Roadmap: Metronome

## Overview

Five phases, each delivering something the user can run and hear. Phase 1 establishes the WASM-AudioWorklet-SharedArrayBuffer stack — the prerequisite for everything else. Phase 2 produces the first audible click. Phases 3 and 4 layer the full timing controls and per-beat customization on top of the working engine. Phase 5 closes out v1 with cross-platform validation on real Android hardware.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Infrastructure** - WASM build pipeline, AudioWorklet skeleton, SharedArrayBuffer ring, COOP/COEP headers, gesture gate — no sound yet but the entire audio stack is wired
- [ ] **Phase 2: First Click** - Rust click synthesis + lookahead scheduler running end-to-end; user can press play and hear a click at a fixed tempo
- [ ] **Phase 3: Timing Controls** - BPM, time signature, and subdivision controls connected to PatternState; beat 1 accent; user hears the correct pattern
- [ ] **Phase 4: Per-Beat Patterns and White Noise** - Per-beat sound assignment UI; white noise mix slider; user can customize every beat position
- [ ] **Phase 5: Cross-Platform Validation** - Android Chrome hardware testing, macOS Safari verification, timing budget audit; v1 ships

## Phase Details

### Phase 1: Infrastructure

**Goal:** The WASM-AudioWorklet-SharedArrayBuffer stack is wired and verified — WASM loads and runs inside the AudioWorklet, SharedArrayBuffer is confirmed available, the play button is gated behind a user gesture, no sound is produced yet but every prerequisite for sound is in place.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** PLATFORM-03, PLATFORM-04, AUDIO-03, AUDIO-04
**Success Criteria** (what must be TRUE):

  1. Dev server responds with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers; `crossOriginIsolated === true` in the browser console.
  2. `typeof SharedArrayBuffer !== 'undefined'` evaluates to `true` in the page; the SPSC ring buffer and Atomics parameter buffer are allocated without error.
  3. A minimal Rust WASM module (writes silence) is compiled via `cargo + wasm-bindgen-cli + wasm-opt`, compiled on the main thread, transferred to the AudioWorklet via `processorOptions`, and instantiated inside the worklet without error; `process()` returns `true` each frame.
  4. Clicking "Play" before any user gesture does nothing; clicking the Play button (a genuine user gesture) resumes the AudioContext and the engine enters `"running"` state.
  5. No allocations occur inside `process()` — all Float32Array views and ring-buffer storage are pre-allocated at init time; confirmed by Chrome DevTools Memory timeline showing a flat heap during playback.

**Plans:** 2 plans

Plans:

- [x] 01-01-PLAN.md — Scaffold Cargo workspace, Rust WASM crate, xtask build, Svelte 5 + Vite app with COOP/COEP headers (COMPLETE 2026-05-19)
- [ ] 01-02-PLAN.md — Wire AudioWorklet processor, SharedArrayBuffer ring/param buffers, gesture-gated Play button

### Phase 2: First Click

**Goal:** The user can press Play and hear an audible, drift-free click at a fixed tempo; pressing Stop silences it. The minimum demonstrable value of the app exists.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** AUDIO-01, TIMING-04, PLATFORM-01
**Success Criteria** (what must be TRUE):

  1. Pressing the Play button produces an audible click on macOS Chrome; pressing Stop silences it immediately.
  2. The click is synthesized by the Rust WASM engine (exponential-decay envelope, sample-rate-agnostic); no external audio files are required to hear a sound.
  3. The lookahead scheduler (25ms `setTimeout` interval, 100ms lookahead window) writes beat events to the SPSC ring; the AudioWorklet reads them each `process()` frame and triggers WASM synthesis — verified by confirming `AudioContext.currentTime` clock anchoring with no drift over 60 seconds.
  4. The app opens and produces audio in both macOS Chrome and macOS Safari (PLATFORM-01 validated).

**Plans:** 2 plans

Plans:
**Wave 1**

- [ ] 02-01-PLAN.md — TDD: Rust DSP click synthesis (triangle wave + exponential decay envelope) with unit tests

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 02-02-PLAN.md — Wire lookahead scheduler + worklet ring read + human verify audible click at 120 BPM

### Phase 3: Timing Controls

**Goal:** The user can set BPM, time signature, and subdivision, and hear the correct beat pattern immediately. Beat 1 defaults to an accent sound. The PatternState multi-track model is in place.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** TIMING-01, TIMING-02, TIMING-03, PATTERN-02
**Success Criteria** (what must be TRUE):

  1. User can set BPM between 20 and 300 (inclusive); the click tempo changes immediately without stopping playback; no audible drift occurs at tempo extremes.
  2. User can set the time signature numerator (1–12) and select common denominators (2, 4, 8, 16); the scheduler produces the correct number of beats per bar.
  3. User can select a subdivision (quarter note, 8th note, triplet, 16th note); the click rate updates immediately and matches the selected subdivision mathematically.
  4. Beat 1 of every bar produces an accent click (distinct pitch or amplitude); all other positions produce a normal click; this behavior is the default without any user configuration.
  5. The `PatternState` model has the shape `{ bpm, tracks: Track[] }` where `Track` contains `{ stepCount, subdivision, beats: BeatPosition[] }`; v1 uses one track but the structure requires no refactor to add a second.

**Plans:** TBD
**UI hint:** yes

### Phase 4: Per-Beat Patterns and White Noise

**Goal:** The user can assign a different click sound to each beat position independently, and can mix white noise into the output at a controllable level.
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** PATTERN-01, AUDIO-02
**Success Criteria** (what must be TRUE):

  1. A UI grid shows each beat position in the current pattern; the user can independently set the sound for any position (accent, normal, ghost, or silent) and hear the change on the next bar.
  2. Beat sound assignments persist across BPM, time signature, and subdivision changes (positions are remapped or reset gracefully when the step count changes).
  3. A white noise mix slider (0–100%) blends continuous white noise generated by the Rust WASM xorshift32 PRNG into the output; moving the slider is audible immediately without stopping playback.
  4. Setting white noise to 0% produces no audible noise floor; setting it to 100% produces audible noise without distortion or clipping.

**Plans:** TBD
**UI hint:** yes

### Phase 5: Cross-Platform Validation

**Goal:** The metronome works correctly on macOS (Chrome and Safari) and Android Chrome on real hardware; timing budget is verified; v1 is ready to ship.
**Mode:** mvp
**Depends on:** Phase 4
**Requirements:** PLATFORM-02
**Success Criteria** (what must be TRUE):

  1. Android Chrome on at least two physical device families (different OEM/chipset) produces audible, drift-free clicks with no dropout at 20 BPM, 120 BPM, and 300 BPM sustained for 60 seconds each.
  2. Performance profiling on Android (Chrome DevTools) confirms zero GC events inside `process()` during a 60-second run; the render budget stays under 2.9ms per callback.
  3. The production deployment (Netlify or Cloudflare Pages) serves COOP/COEP headers; `crossOriginIsolated === true` confirmed in a Playwright E2E test running against the production URL.
  4. `AudioContext.sampleRate` is read at runtime and passed to WASM at init; the engine produces correct timing at 44100 Hz (macOS default) and 48000 Hz (Android default) without manual reconfiguration.

**Plans:** TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Infrastructure | 2/2 | Complete | 2026-05-19 |
| 2. First Click | 0/2 | Planning complete | - |
| 3. Timing Controls | 0/TBD | Not started | - |
| 4. Per-Beat Patterns and White Noise | 0/TBD | Not started | - |
| 5. Cross-Platform Validation | 0/TBD | Not started | - |
