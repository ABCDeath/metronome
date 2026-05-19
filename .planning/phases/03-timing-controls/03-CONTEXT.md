# Phase 3: Timing Controls - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire BPM, time signature, and subdivision controls to PatternState and the scheduler. Beat 1 defaults to an accent click (configurable pitch and amplitude). Phase ends when: the user can change BPM, time signature, and subdivision and hear the correct pattern immediately; beat 1 produces a distinguishable accent; PatternState has the multi-track shape required by Phase 4. No per-beat sound assignment — that is Phase 4.

</domain>

<decisions>
## Implementation Decisions

### BPM Control
- **D-01:** BPM widget = horizontal `<input type="range">` slider (20–300) + validated number input + four step buttons: −5, −1, +1, +5 BPM. Editing the number updates the slider and vice versa. Input validates on blur/enter: clamp to 20–300, reject non-numeric. Slider and buttons change BPM immediately; scheduler picks up the new value on its next 25ms tick without stopping playback.

### Accent Sound
- **D-02:** Accent pitch: fixed at **1400 Hz** (vs. 1000 Hz for normal click). Toggled on/off independently — when off, accent uses 1000 Hz.
- **D-03:** Accent amplitude: configurable multiplier **1.0–1.5**, `step=0.1`. Toggled on/off independently — when off, accent amplitude = 1.0× (same as normal). Both pitch and amplitude toggles default to on.
- **D-04:** Beat 1 (index 0) in every bar is the accent voice (`voice = 1` in the ring protocol). All other positions are normal (`voice = 0`). The WASM `fill_output_buffer` receives the voice value and applies the accent frequency/amplitude accordingly. Accent parameters (freq override, amplitude multiplier) are passed via the paramSAB to WASM at init and on any change.

### PatternState Wiring
- **D-05:** `PatternState` is a Svelte `$state` object in `App.svelte`. Shape:
  ```ts
  type PatternState = {
    bpm: number;
    tracks: Track[];
  };
  type Track = {
    stepCount: number;       // numerator × subdivisionMultiplier
    subdivision: Subdivision; // 'quarter' | 'eighth' | 'triplet' | 'sixteenth'
    denominator: number;     // 2 | 4 | 8 | 16
    beats: BeatPosition[];   // length = stepCount
  };
  type BeatPosition = {
    voice: number; // 0=normal, 1=accent, 2=ghost, 3=silent (Phase 4 uses 2/3; Phase 3 only 0/1)
  };
  ```
  v1 uses a single track (`tracks[0]`). The multi-track shape requires no refactor to add a second track in a future phase.
- **D-06:** `AudioEngine` gains an `updatePattern(state: PatternState): void` method. App.svelte calls it via `$effect(() => engine.updatePattern(pattern))`. The scheduler reads `this._bpm`, `this._stepInterval`, and `this._beats` (the current track's BeatPosition array) on each tick. No postMessage needed — the engine's internal fields are updated synchronously on the main thread before the next scheduler interval.

### Step Count and Timing Formula
- **D-07:** Step count per bar = `numerator × subdivisionMultiplier` where:
  - quarter note = ×1, 8th note = ×2, triplet = ×3, 16th note = ×4
  - Examples: 4/4 + quarter = 4 steps; 4/4 + 8th = 8 steps; 3/4 + triplet = 9 steps; 7/8 + 8th = 7 steps
- **D-08:** BPM always means **quarter-note BPM** (DAW standard — matches Ableton, Reaper, Cubase, FL Studio and the MIDI spec). Step interval in seconds:
  ```
  stepInterval = (60 / bpm) × (4 / denominator) / subdivisionMultiplier
  ```
  Example: 6/8 at 120 BPM, 8th subdivision → `(60/120) × (4/8) / 1 = 0.25s` per step.
- **D-09:** The scheduler advances `_nextBeatTime` by `stepInterval` each step (replacing the hardcoded `60/120` in Phase 2). The beat array index cycles: `stepIndex = barStep % stepCount`. Voice for each event = `this._beats[stepIndex].voice`.

### Claude's Discretion
- Default PatternState on first load: BPM=120, 4/4, quarter subdivision, tracks[0].beats = [{voice:1}, {voice:0}, {voice:0}, {voice:0}]
- Exact layout of timing controls in App.svelte (BPM block, time signature row, subdivision selector)
- How time signature numerator is picked (number input 1–12) and denominator (select: 2|4|8|16)
- Subdivision picker UI (radio buttons or select, four options)
- Whether accent settings (pitch toggle, amplitude slider) live in a collapsible panel or always visible
- WASM encoding of accent params in paramSAB (e.g., slots 2–4 for accent_freq, accent_amp, unused)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — Phase 3 requirements: TIMING-01, TIMING-02, TIMING-03, PATTERN-02
- `.planning/ROADMAP.md` §Phase 3 — Success criteria and phase goal (PatternState shape, beat 1 accent, real-time BPM change)

### Prior Phase Decisions (carried forward)
- `.planning/phases/01-infrastructure/01-CONTEXT.md` — D-08 (`#[no_mangle] extern "C"` only), D-11 (zero allocations in `process()`)
- `.planning/phases/02-first-click/02-CONTEXT.md` — D-04 (ring event encoding: bits 0–6 sample offset, 7–11 voice, 12–31 quantum), D-05 (`fill_output_buffer(sample_offset, voice, noise_gain)`), D-06 (Atomics ring protocol), D-07 (scheduler: 25ms interval, 100ms lookahead), paramSAB layout

### Existing Implementation
- `rust/src/lib.rs` — Current WASM exports: `init`, `get_output_buffer_ptr`, `fill_output_buffer`; Phase 3 adds accent frequency/amplitude handling via voice parameter
- `public/worklet/processor.js` — Current AudioWorklet processor; Phase 3 passes voice to `fill_output_buffer` from the ring event
- `src/lib/audio-engine.ts` — Current AudioEngine; Phase 3 adds `updatePattern()`, dynamic `_stepInterval`, `_beats` array, step index tracking
- `src/App.svelte` — Current Play/Stop UI; Phase 3 adds BPM slider, step buttons, time signature, subdivision, accent controls

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AudioEngine` class (`src/lib/audio-engine.ts`): `_schedulerTick()` already computes quantum index and sample offset. Phase 3 replaces the hardcoded `60/120` step with `this._stepInterval` and reads `this._beats[stepIndex].voice` to encode the voice in the ring event.
- `controlRingSAB` ring buffer: already allocated (1032 bytes, 256 slots). Voice bits 7–11 in each u32 event are already reserved — Phase 3 just starts writing non-zero voice values.
- `paramSAB` (32 bytes, 8 × Int32 slots): already allocated and transferred to worklet. Phase 3 uses slots for accent params (freq, amp) in addition to noise_gain. Phase 2 left slots 1–7 unused.

### Established Patterns
- `Atomics.store`/`Atomics.load` for ring buffer and paramSAB — no mutation inside `process()`.
- Svelte 5 runes (`$state`, `$effect`) — Phase 3 extends App.svelte with additional `$state` fields.
- `static mut` in Rust for zero-allocation DSP state — Phase 3 adds accent frequency and amplitude statics.

### Integration Points
- `_schedulerTick()` in AudioEngine: replace `60.0 / 120` with `this._stepInterval`; add step index cycling; read `this._beats[stepIndex].voice` for the ring event voice bits.
- `fill_output_buffer(sample_offset, voice, noise_gain)` in WASM: `voice === 1` triggers accent freq/amp; `voice === 0` is normal.
- `process()` in worklet: already reads `evVoice` from the ring event — no change needed here; it passes voice to `fill_output_buffer` already (from Phase 2).

</code_context>

<specifics>
## Specific Ideas

- User cited Ableton, Reaper, Cubase, FL Studio as the reference for BPM-means-quarter-note convention — the scheduler formula must match what musicians expect from those tools.
- The ±1/±5 step buttons are specifically called out as "really useful" — must be prominent in the UI, not hidden behind the slider.
- Accent settings (pitch toggle, amplitude slider) are independently optional — a user may want louder-but-same-pitch accent or same-volume-but-higher-pitch accent.

</specifics>

<deferred>
## Deferred Ideas

- **Per-beat sound assignment** — Phase 4 scope. Phase 3 only has accent (voice=1) on beat 0 and normal (voice=0) elsewhere. The BeatPosition.voice field exists in PatternState but the UI to change it per-position is Phase 4.
- **Ghost notes (voice=2) and silent beats (voice=3)** — Phase 4. Ring protocol bits 7–11 already accommodate them.
- **White noise slider** — Phase 4 (AUDIO-02).
- **Configurable accent pitch multiplier** — User chose fixed 1400 Hz for now; a ratio slider could be v2.

</deferred>

---

*Phase: 3-Timing Controls*
*Context gathered: 2026-05-19*
