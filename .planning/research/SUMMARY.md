# Project Research Summary

**Project:** Metronome — Browser-based metronome with Rust WASM audio engine
**Domain:** Browser audio / real-time DSP
**Researched:** 2026-05-18
**Confidence:** HIGH

## Executive Summary

This is a precision-timing audio application whose sole value proposition is clicks that land on time, every time. Experts build browser metronomes on a three-layer stack: a Rust WASM audio engine for sample-accurate synthesis (no GC pauses), an `AudioWorkletProcessor` running on a dedicated audio-priority OS thread, and a main-thread lookahead scheduler that pre-schedules beat events 100ms into the future using the `AudioContext.currentTime` hardware clock. Communication between layers is lock-free via `SharedArrayBuffer` and `Atomics` — no `postMessage` in the audio hot path. The entire architecture is dictated by one constraint: the `process()` callback fires every ~2.9ms and any pause longer than that budget causes an audible dropout.

The recommended stack is Rust 1.77+ compiled to `wasm32-unknown-unknown` via a manual `cargo + wasm-bindgen-cli + wasm-opt` pipeline (not `wasm-pack`, which was deprecated September 2025), Svelte 5 for the UI (compiler-based, no VDOM overhead), and Vite 6 as the build tool with `vite-plugin-wasm` covering both main thread and worker contexts. COOP/COEP response headers are a hard prerequisite for `SharedArrayBuffer` and must be configured from day one on both the dev server and every production deployment target; Netlify or Cloudflare Pages are the recommended hosts (GitHub Pages cannot set these headers natively).

The primary risks are platform-specific: Android Chrome has documented AudioWorklet timing instability that requires testing on real hardware, and iOS Safari carries an active iOS 18 bug where `AudioWorkletNode` produces no audio on iPhone. Both platforms require a 100–200ms lookahead scheduler window to tolerate irregular callback delivery. Secondary risks are build-toolchain traps — `wasm-bindgen-cli` version must be pinned to exactly match the crate version, and `wasm-bindgen`'s generated JS glue must never be called inside `AudioWorkletGlobalScope` (which lacks `TextEncoder`/`TextDecoder`). These are well-understood, well-documented failure modes with known prevention strategies.

---

## Key Findings

### Recommended Stack

The WASM toolchain is a manual three-step pipeline: `cargo build --release --target wasm32-unknown-unknown`, then `wasm-bindgen --target web` to generate JS/TS glue, then `wasm-opt -O3` for binary size reduction. `wasm-pack` is explicitly deprecated and its `wasm-opt` bundling has a known 10x performance regression on Linux. WASM output must be loaded via main-thread `fetch` + `WebAssembly.compile`, then transferred to the AudioWorklet via `processorOptions` in the `AudioWorkletNode` constructor — the worklet's isolated scope cannot make network requests.

**Core technologies:**
- **Rust 1.77+ (stable)** — audio engine source; no GC, deterministic allocation, SIMD available
- **wasm-bindgen 0.2.120** — JS/WASM FFI and TypeScript type generation; pin CLI version to crate version exactly
- **wasm-opt (Binaryen)** — post-compile binary optimizer; 10–30% size reduction beyond LLVM output
- **Web Audio API AudioWorkletProcessor** — only reliable sub-10ms audio thread in the browser; sample-accurate scheduling
- **SharedArrayBuffer + Atomics** — zero-copy, lock-free ring buffer between main thread and AudioWorklet; requires COOP/COEP headers
- **Svelte 5** — compiler-based UI with no runtime; 45% smaller bundles than React; Vite 6 native support
- **TypeScript 5** — UI and glue code; `wasm-bindgen` generates `.d.ts` types automatically
- **Vite 6 + vite-plugin-wasm + vite-plugin-top-level-await** — must appear in both `plugins` and `worker.plugins` arrays for Firefox support
- **Vitest 3 + Playwright** — layered testing: pure Rust unit tests for DSP, Vitest for main-thread TS, Playwright for full AudioWorklet integration
- **Netlify / Cloudflare Pages** — static hosting with native COOP/COEP header support

### Expected Features

**Must have (table stakes — ship in v1):**
- Play / Stop with drift-free timing — the entire value proposition; AudioWorklet + WASM lookahead scheduler
- BPM input (20–300) with increment/decrement and keyboard arrows
- Time signature (numerator 1–12, denominators 2/4/8/16; default 4/4)
- Subdivision (quarter, 8th, triplet, 16th)
- Per-beat sound assignment with 3–5 bundled synthesized sounds
- Accent on beat 1 (default case of the per-beat model)
- Visual beat indicator synchronized with audio
- White noise mix control (low marginal cost once WASM engine exists)
- User-loadable WAV/MP3 click sounds

**Should have (competitive differentiators — near-term follow):**
- Tap tempo — fast follow; no structural dependencies
- Mute-beats trainer — depends on bar-count tracking in scheduler
- Gradual tempo increase / speed trainer — depends on BPM-update-while-running
- Setlist / preset saving — localStorage; depends on all core params being stable
- Fullscreen / distraction-free mode — CSS only, low effort
- Keyboard-first control — no structural impact; accessibility benefit

**Defer (v2+):**
- Polyrhythm / multiple tracks — architecture must not block it; multi-track `PatternState` model designed in from the start
- MIDI output — inconsistent browser support; leave architecture door open
- Native app packaging — browser-only for v1

**Do not build:**
- Italian tempo markers (Allegro, Andante) — near-zero value when BPM is visible
- Tuner integration — out of scope; separate product surface
- Social / sharing features — no evidence of demand
- Complex polyrhythm visualizer with animated rings — documented UX confusion
- Randomly muted beats (randomization mode) — user comprehension failure documented in reviews

### Architecture Approach

The system has three distinct execution contexts that cannot share synchronous call stacks: the main thread (UI, lookahead scheduler, PatternState ownership), the AudioWorklet thread (audio-priority OS thread; runs `process()` every 128 samples), and WASM executing inside the AudioWorklet thread (pure synthesis, no scheduling). The main thread pre-schedules beat events 100ms ahead using the hardware `AudioContext.currentTime` clock and writes them into a wait-free SPSC ring buffer backed by `SharedArrayBuffer`. The AudioWorklet reads that ring each `process()` call and passes beat flags as a `u32` bitmask to the WASM engine via a raw `#[no_mangle] extern "C"` function — never through `wasm-bindgen`'s high-level glue, which is not available in `AudioWorkletGlobalScope`.

**Major components:**
1. **WASM Audio Engine (Rust)** — pure synthesis; click transients via exponential decay envelopes; white noise via xorshift32 PRNG; writes 128 f32 samples to a static output buffer; no scheduling, no allocations in the audio path
2. **AudioWorklet Glue Layer (plain JS, not bundled)** — bridges `process()` to WASM; reads control ring; copies WASM linear memory view to Web Audio output buffers; zero allocations in hot path
3. **SharedArrayBuffer Communication Layer** — two regions: SPSC ring buffer (beat event queue) and Atomics parameter buffer (noise gain, is_playing); main thread writes, AudioWorklet reads
4. **Lookahead Scheduler (TypeScript, main thread)** — `setTimeout` at 25ms interval; schedules all beats falling within the next 100ms window using `AudioContext.currentTime`; owns PatternState
5. **PatternState Model (TypeScript)** — multi-track from day one: `{ bpm, tracks: Track[] }` where each `Track` has `{ stepCount, subdivision, beats: BeatPosition[] }`; v1 uses one track; polyrhythm adds a second track with a different stepCount, no refactor needed
6. **Sound Library (TypeScript)** — registry of synthesized voices (WASM voice index) and user-loaded files (`AudioBuffer`); user files play back via `AudioBufferSourceNode` connected to the same Web Audio destination

### Critical Pitfalls

1. **AudioContext created before user gesture** — context starts in `"suspended"` state; iOS Safari never auto-resumes. Create the `AudioContext` (or call `resume()`) inside the play button's click handler. Show a "Tap to Start" affordance. Never attempt audio before the first gesture.

2. **Missing COOP/COEP headers** — `SharedArrayBuffer` is `undefined` without `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. The entire ring buffer architecture collapses. Set headers on Vite dev server from day one; configure them on the production host before integration testing. Test `typeof SharedArrayBuffer !== 'undefined'` at startup.

3. **Fetching WASM inside AudioWorkletGlobalScope** — `fetch()`, `importScripts()`, `TextEncoder`, and `TextDecoder` are absent from that scope. Compile WASM on the main thread, transfer the `WebAssembly.Module` via `processorOptions`, instantiate inside the worklet. Use `#[no_mangle] extern "C"` exports for all `process()`-path calls — never `wasm-bindgen`'s high-level glue.

4. **Memory allocation in `process()`** — any `new Float32Array()`, object literal, or string operation inside `process()` triggers the JS GC; a GC pause of 5–20ms on a 2.9ms budget causes audible dropout. Pre-allocate all buffers at init time. The WASM output view is a `Float32Array` created once over linear memory. Ring buffer storage is pre-allocated. Zero `new` in the hot path.

5. **Hardcoded sample rate** — macOS defaults 44100 Hz, Windows/Android typically 48000 Hz, some Android devices use 32000 Hz. Read `AudioContext.sampleRate` at runtime and pass it to WASM at initialization. All time-domain constants (envelope durations) must be defined in seconds, converted to samples at runtime.

6. **`process()` not returning `true`** — a missing or falsy return value signals the worklet to stop and be garbage collected, with no error thrown. Always end `process()` with `return true`.

7. **Android AudioWorklet timing instability** — callbacks arrive with irregular timing on real Android hardware due to OEM audio stack fragmentation and historical Chromium thread priority bugs. The 100ms lookahead scheduler window is the primary mitigation. Use `latencyHint: "interactive"` (not `"playback"`, which has its own Android glitch bug). Test on physical devices, not emulators.

---

## Implications for Roadmap

Based on the dependency graph in FEATURES.md and the build order in ARCHITECTURE.md, six phases emerge. The ordering is driven by hard dependencies: SharedArrayBuffer must be available before any WASM-AudioWorklet communication can be tested, WASM synthesis must exist before click sounds can be validated, and the scheduler must be correct before time signature or per-beat features can be built on top of it.

### Phase 1: Infrastructure and Audio Foundation

**Rationale:** SharedArrayBuffer (COOP/COEP headers) and WASM loading into AudioWorklet are prerequisites for everything else. These are also the most novel and failure-prone parts of the stack. Validate them before writing any DSP code.

**Delivers:** WASM loads and runs inside AudioWorklet; `process()` loop executes without errors; `SharedArrayBuffer` confirmed available; no sound yet.

**Addresses:** None of the user-visible features, but unblocks all of them.

**Avoids:** Pitfalls 1 (AudioContext gesture gate), 2 (missing COOP/COEP), 3 (WASM loading in worklet scope), 6 (process() return value).

**Implementation tasks:**
- Configure COOP/COEP headers on Vite dev server
- Set up manual `cargo + wasm-bindgen-cli + wasm-opt` build pipeline
- Write minimal WASM module (`get_output_buffer_ptr`, `fill_output_buffer` writing silence)
- Write AudioWorklet processor skeleton (main thread fetch → compile → transfer → worklet instantiate)
- Establish SharedArrayBuffer layout (SPSC ring + Atomics param buffer)
- Gate UI play button behind AudioContext `"running"` state

### Phase 2: First Sound — Click Synthesis and Scheduler

**Rationale:** Once the infrastructure is proven, add synthesis and scheduling. These are the two halves of the core value proposition and must be built together — neither is useful without the other.

**Delivers:** Audible, drift-free click at a fixed BPM. The minimum demonstrable value.

**Addresses:** Play/Stop with drift-free timing (table stakes #1).

**Avoids:** Pitfalls 4 (allocations in `process()`), 5 (hardcoded sample rate), 7 (Android timing — lookahead architecture must be correct from the start), 8 (background tab throttling — scheduler must run on audio clock, not JS timers).

**Implementation tasks:**
- Implement click synthesis in Rust: single voice, exponential decay envelope, sample-rate-agnostic
- Implement xorshift32 PRNG and white noise mixing in Rust
- Wire voice trigger: main thread writes beat events to SPSC ring; worklet reads and passes `beat_flags` bitmask to WASM
- Implement lookahead scheduler (25ms `setTimeout` interval, 100ms lookahead window, `AudioContext.currentTime`)
- Read `AudioContext.sampleRate` at runtime; pass to WASM at init

### Phase 3: Pattern Engine — Time Signature, Subdivision, BPM Controls

**Rationale:** The scheduler from Phase 2 handles one beat at a fixed tempo. This phase extends it to the full `PatternState` model, enabling all user-facing timing controls.

**Delivers:** Configurable time signature, subdivision, and BPM. Correct beat pattern. Visual beat indicator.

**Addresses:** BPM input, time signature, subdivision, accent on beat 1, visual beat indicator (table stakes #2–#7).

**Avoids:** Anti-pattern of a flat single-beat data model — `PatternState.tracks: Track[]` must be the shape from the start.

**Implementation tasks:**
- Implement `PatternState` multi-track model in TypeScript
- Add time signature numerator/denominator and subdivision to scheduler
- Connect BPM, time sig, and play/stop UI controls to PatternState
- Implement visual beat indicator (synchronized via postMessage from worklet, throttled)
- Handle `visibilitychange` for background tab pause/resume

### Phase 4: Per-Beat Sounds and User Audio Files

**Rationale:** Once the pattern engine is stable, the per-beat sound assignment model can be built on top. This is where the differentiating audio customization features land.

**Delivers:** Per-beat sound customization with bundled synthesized defaults; user-loadable WAV/MP3 sounds.

**Addresses:** Per-beat sound assignment, bundled click sounds, user-loadable audio files, white noise mix control (table stakes #4–#9).

**Avoids:** The WASM output path and the `AudioBufferSourceNode` path for user files must coexist in the Web Audio graph without interference.

**Implementation tasks:**
- Implement `SoundLibrary` with synthesized voice variants (accent, ghost, silent)
- Per-beat assignment UI: grid of beat positions, each with sound selector
- User file loading: `File` input → `AudioContext.decodeAudioData()` → `AudioBuffer`; schedule via `AudioBufferSourceNode`
- Expose noise gain via Atomics param buffer and add mix slider to UI
- Implement `audioCtx.suspend()` / `resume()` on stop and visibility change (battery drain mitigation)

### Phase 5: Cross-Platform Validation and Polish

**Rationale:** Platform-specific bugs (Android timing, iOS 18 AudioWorklet silence, sample rate variance) cannot be caught in development. This phase requires physical devices.

**Delivers:** A metronome that works correctly on macOS and Android Chrome; iOS Safari documented with known limitations.

**Addresses:** The <10ms scheduling gap requirement; click consistency requirement.

**Avoids:** Pitfall 5 (Android timing instability), Pitfall 6 (iOS Safari AudioWorklet bugs), Pitfall 11 (battery drain).

**Implementation tasks:**
- Android hardware testing (minimum two device families): timing stability, `outputLatency` monitoring, render capacity tracking
- iOS hardware testing: verify AudioWorklet initializes and `process()` is called; document iOS 18 status
- Performance profiling: `chrome://tracing` to confirm zero GC events in `process()` hot path; render budget stays under 2.9ms
- Set COOP/COEP headers on production deployment (Netlify or Cloudflare Pages)
- Verify `crossOriginIsolated === true` in Playwright E2E tests

### Phase 6: Practice Features (Post-v1)

**Rationale:** Tap tempo, mute-beats trainer, gradual tempo increase, and preset saving are all additive. They depend on the core scheduler and PatternState being stable, which Phase 3 delivers.

**Delivers:** Extended practice modes that differentiate the product from simpler browser metronomes.

**Addresses:** Differentiator features from FEATURES.md.

**Implementation tasks:**
- Tap tempo: average last 3–4 tap intervals → write BPM back to PatternState
- Mute-beats trainer: bar counter in scheduler; silence all voice flags for Y bars after X playing bars
- Gradual tempo increase: scheduler updates PatternState.bpm by step every N bars
- Preset saving: serialize `{ name, bpm, timeSig, subdivision, beatMap }` to `localStorage`

### Phase Ordering Rationale

- Infrastructure (Phase 1) before synthesis (Phase 2) because SharedArrayBuffer is a hard prerequisite for the SPSC ring buffer, and WASM loading patterns must be validated before DSP code is written on top of them.
- Synthesis and scheduler together (Phase 2) because neither is demonstrable alone — a click with no scheduler is untimed noise; a scheduler with no synthesis is silence.
- Pattern engine (Phase 3) before per-beat sounds (Phase 4) because per-beat sound assignment requires a stable array of beat positions, which Phase 3 produces.
- Cross-platform validation (Phase 5) before shipping because Android and iOS bugs are invisible in development and are the most likely v1 failure mode.
- Practice features (Phase 6) deferred because they are additive and their dependencies (stable scheduler, stable PatternState) are not available until Phase 3.

### Research Flags

Phases needing deeper research during planning:

- **Phase 1:** AudioWorklet module bundling strategy — whether to use a static plain-JS file outside Vite's processing pipeline, or `vite-plugin-audioworklet` for explicit worklet bundling. The ARCHITECTURE.md recommendation (plain JS static asset) is correct but has implications for TypeScript sharing between worklet and main thread.
- **Phase 2:** Background tab scheduler behavior — running the beat scheduler inside `AudioWorkletGlobalScope` (audio clock, never throttled) vs. main thread `setTimeout` with `AudioContext.currentTime` lookahead. The ARCHITECTURE.md design places the scheduler on the main thread with audio-clock anchoring; this is the standard pattern but warrants validation on the target browser versions.
- **Phase 5:** iOS 18 AudioWorklet silence bug status — the bug was confirmed as of research date; its fix status in the current iOS release should be verified before committing to a fallback strategy.

Phases with standard patterns (research can be skipped):

- **Phase 3:** PatternState model and lookahead scheduler are well-documented patterns; the cwilso/metronome reference implementation covers this ground.
- **Phase 4:** `AudioBufferSourceNode` for user file playback is standard Web Audio; `SoundLibrary` is a straightforward registry pattern.
- **Phase 6:** All practice features are pure TypeScript scheduler logic with no novel integration concerns.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All choices verified against official docs and current ecosystem state (wasm-pack deprecation confirmed, vite-plugin-wasm behavior verified, Svelte 5 Vite 6 compatibility confirmed) |
| Features | HIGH | Table stakes cross-verified across five competing metronome apps; anti-features supported by user review patterns |
| Architecture | HIGH | Multiple authoritative sources corroborate all major patterns: Chrome developer docs, Web Audio spec, cwilso/metronome reference, wasm-bindgen official example |
| Pitfalls | HIGH | All critical pitfalls traced to official bug trackers (Chromium, WebAudio spec) or official docs; Android and iOS issues have Chromium issue numbers |

**Overall confidence:** HIGH

### Gaps to Address

- **iOS 18 AudioWorklet silence bug:** Confirmed at research time but may have been fixed in a subsequent iOS release. Check Apple Developer Forums thread #768347 and verify on physical hardware before Phase 5. If unfixed, decide during Phase 5 planning whether to implement a `ScriptProcessorNode` fallback (deprecated but functional) or document as a known limitation.
- **wasm-bindgen TextEncoder restriction in AudioWorkletGlobalScope:** The official wasm-bindgen AudioWorklet example works around this by encapsulating WASM init in Rust code. Whether this pattern is compatible with the manual (non-wasm-pack) build pipeline should be verified during Phase 1 implementation before committing to the full worklet architecture.
- **Polyrhythm future-proofing:** The multi-track `PatternState` model is designed in from Phase 3. The WASM engine's voice architecture (fixed `voice_idx` slots) should be designed to accommodate up to 4 simultaneous tracks without rewriting the DSP core — this is an implementation detail that should be settled in Phase 2.
- **White noise differentiator validation:** No competing browser metronome explicitly advertises white noise mixing. This is a medium-confidence assertion. If users don't value it, it's still low-cost to ship (Phase 4) and does not affect the core architecture.

---

## Sources

### Primary (HIGH confidence)
- [wasm-bindgen docs — AudioWorklet example](https://rustwasm.github.io/docs/wasm-bindgen/examples/wasm-audio-worklet.html)
- [Chrome Developers — Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern/)
- [web.dev — A Tale of Two Clocks (audio scheduling)](https://web.dev/articles/audio-scheduling)
- [web.dev — COOP/COEP cross-origin isolation](https://web.dev/articles/coop-coep)
- [MDN — AudioWorkletProcessor.process()](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process)
- [blog.paul.cx — Wait-free SPSC ring buffer](https://blog.paul.cx/post/a-wait-free-spsc-ringbuffer-for-the-web/)
- [vite-plugin-wasm (Menci)](https://github.com/Menci/vite-plugin-wasm)
- [rustwasm org sunsetting announcement](https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org/)
- [Chromium Bug #813825 — AudioWorklet real-time priority on Android](https://bugs.chromium.org/p/chromium/issues/detail?id=813825)
- [Web Audio API Issue #1439 — No fetch in AudioWorkletGlobalScope](https://github.com/WebAudio/web-audio-api/issues/1439)
- [cwilso/metronome — Reference lookahead scheduler](https://github.com/cwilso/metronome)
- [ringbuf.js — SPSC ring buffer reference](https://github.com/padenot/ringbuf.js/)

### Secondary (MEDIUM confidence)
- [audiodev.blog — Random numbers for audio (xorshift vs LCG vs LFSR)](https://audiodev.blog/random-numbers/)
- [nickb.dev — Life after wasm-pack](https://nickb.dev/blog/life-after-wasm-pack-an-opinionated-deconstruction/)
- [Melodics — Best metronome apps for drummers 2026](https://melodics.com/blog/best-metronome-apps-for-drummers-2026)
- [Apple Developer Forums #768347 — AudioWorklet not playing on iOS 18](https://developer.apple.com/forums/thread/768347)
- [cprimozic.net — FM synthesis in browser with Rust WASM + SIMD](https://cprimozic.net/blog/fm-synth-rust-wasm-simd/)
- [loke.dev — Stop allocating inside AudioWorkletProcessor](https://loke.dev/blog/stop-allocating-inside-audioworkletprocessor)

---
*Research completed: 2026-05-18*
*Ready for roadmap: yes*
