# Phase 2: First Click - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire click DSP synthesis and a lookahead scheduler to produce an audible, drift-free click at a fixed tempo on macOS Chrome. Phase ends when: pressing Play produces an audible triangle-wave click at 120 BPM (hardcoded), the click triggers with sample-accurate timing, the lookahead scheduler is running without drift over 60 seconds, and pressing Stop silences the metronome. No BPM/time-signature/subdivision controls — those are Phase 3. No Safari support — deferred.

</domain>

<decisions>
## Implementation Decisions

### Click Sound Synthesis
- **D-01:** Click oscillator frequency: **~1000 Hz** (warm, mid-range tick — clear without being piercing).
- **D-02:** Click decay duration: **~10–15ms** (short, punchy, matches DAW click track feel; no audible smear at 300 BPM where one beat ≈ 200ms).
- **D-03:** Click envelope shape: **triangle wave + exponential decay** — similar to Reaper's default woodblock-style click. Triangle waves have odd harmonics (1/n² amplitudes) giving a harder, more mechanical character than a pure sine. Synthesized entirely in Rust WASM; no external audio files needed (AUDIO-01). Envelope is sample-rate-agnostic: all timings computed from `SAMPLE_RATE` stored in WASM at `init()`.

### Beat Event Ring Buffer Protocol
- **D-04:** Beat events in the SPSC ring are **sample-accurate**. Each u32 event encodes:
  - bits 0–6: sample offset within the current 128-frame quantum (0–127) where the click envelope starts
  - bits 7–11: voice type (normal / accent / ghost / silent — Phase 2 only uses normal; accent added in Phase 3)
  - bits 12–31: reserved (zero for now)
- **D-05:** The WASM `fill_output_buffer` API is updated to accept `sample_offset: u32` and `voice: u32` instead of `beat_flags: u32`, enabling the worklet to pass the sample-accurate offset to the synthesizer. New signature: `fill_output_buffer(sample_offset: u32, voice: u32, noise_gain: f32)`. If no beat occurs this quantum, worklet passes `sample_offset = 255` (sentinel = no trigger) or calls with a flag; to be determined by implementer.
- **D-06:** Ring buffer write (main thread scheduler) uses `Atomics.store` on the write index after writing the event; ring buffer read (AudioWorklet `process()`) uses `Atomics.load` on both indices. No allocation inside `process()` (D-11 from Phase 1).

### Lookahead Scheduler
- **D-07:** Lookahead scheduler runs on the **main thread** via `setInterval` (25ms interval, 100ms lookahead window). Fixed BPM: **120** (hardcoded for Phase 2; BPM control is Phase 3). The scheduler computes beat times in `AudioContext.currentTime` seconds, converts to absolute sample counts, derives the quantum number and sample offset within that quantum, and writes events to the ring.
- **D-08:** The scheduler does **not** use a Worker thread for Phase 2. Main thread setTimeout is sufficient for 120 BPM with a 100ms lookahead window (4.8× safety margin at 120 BPM). Worker thread is a future optimization if drift appears at extreme BPMs under heavy main-thread load.

### Platform Scope
- **D-09:** Phase 2 targets **macOS Chrome only**. Safari support is explicitly deferred — user has confirmed Safari is lowest priority and not a Phase 2 concern. PLATFORM-01 (macOS Chrome + Safari) will only be partially satisfied; Safari parity addressed in Phase 5 or later.

### Claude's Discretion
- Exact `fill_output_buffer` sentinel value for "no beat this quantum" (e.g., passing `sample_offset = 0xFF` or a separate flag bit)
- Triangle wave generation algorithm in Rust (the straightforward implementation: phase accumulator mod 1.0, abs(phase - 0.5) * 4.0 - 1.0)
- Whether the main-thread scheduler stores the next beat time as `AudioContext.currentTime + lookahead` or as a sample count
- `setInterval` vs `setTimeout` (recursive) for the scheduler — both achieve 25ms cadence

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value ("clicks that land on time, every time"), constraints, key decisions
- `.planning/REQUIREMENTS.md` — Phase 2 requirements: AUDIO-01, TIMING-04, PLATFORM-01
- `.planning/ROADMAP.md` §Phase 2 — Success criteria and phase goal

### Phase 1 Decisions (carried forward)
- `.planning/phases/01-infrastructure/01-CONTEXT.md` — All D-01 through D-12 apply. Especially:
  - D-07: WASM compiled on main thread, transferred via processorOptions
  - D-08: `#[no_mangle] pub extern "C" fn` only in worklet hot path
  - D-11: Zero allocations in `process()`; all views pre-allocated at init

### Existing Implementation
- `rust/src/lib.rs` — Current WASM exports: `init`, `get_output_buffer_ptr`, `fill_output_buffer` (Phase 2 updates `fill_output_buffer` signature)
- `public/worklet/processor.js` — Current AudioWorklet processor; Phase 2 adds beat-event reading and sample-offset-aware synthesis call
- `src/lib/audio-engine.ts` — Current AudioEngine class; Phase 2 adds lookahead scheduler
- `src/App.svelte` — Current Play/Stop button; Phase 2 keeps the same UI

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AudioEngine` class (`src/lib/audio-engine.ts`): already handles AudioContext lifecycle, WASM compile/load, worklet bootstrap, SAB allocation. Phase 2 adds `_scheduler` logic inside `start()`/`stop()`.
- `MetronomeProcessor` (`public/worklet/processor.js`): already instantiates WASM, holds typed array views over the ring buffer. Phase 2 adds ring buffer read logic in `process()` and the sample-accurate synthesis call.
- `controlRingSAB` (1032 bytes): already allocated and transferred to worklet. Layout defined in Phase 1 (indices at 0–7, data at 8–1031). Phase 2 just starts writing events into it.

### Established Patterns
- `static mut` in Rust + raw pointer access: established in `lib.rs` for zero-allocation output. Phase 2 adds similar statics for synthesizer state (phase accumulator, envelope gain, active flag).
- `Atomics.store`/`Atomics.load` via `Int32Array` over SAB: already wired in the worklet for ring indices.
- No `new` inside `process()`: enforced by Phase 1; Phase 2 must not break this.

### Integration Points
- `fill_output_buffer` API change: worklet calls `this._exports.fill_output_buffer(sample_offset, voice, noise_gain)` — Phase 2 updates both the Rust function signature and the worklet call site.
- Main-thread scheduler writes to `controlRingSAB` via `new Int32Array(this._controlRingSAB)` (created once in AudioEngine, reused).

</code_context>

<specifics>
## Specific Ideas

- User referenced Reaper's default click sounds as the target character: woodblock-style, triangle wave, sharp transient with quick decay. This is the reference point for the synthesized click.
- Fixed BPM for Phase 2: 120 (not shown in UI — Phase 3 adds BPM control).

</specifics>

<deferred>
## Deferred Ideas

- **Safari support** — User confirmed Safari is lowest priority. PLATFORM-01 Safari half deferred to Phase 5 or later. Chrome-only for Phase 2.
- **BPM controls** — Phase 3 scope. Phase 2 hardcodes 120 BPM.
- **Accent vs. normal click distinction** — Phase 3 scope (voice type bits are reserved in the ring buffer protocol for this).
- **Worker thread scheduler** — May be needed at extreme BPMs under main-thread load. Defer until drift is observed empirically.

</deferred>

---

*Phase: 2-First Click*
*Context gathered: 2026-05-19*
