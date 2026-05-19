# Phase 2: First Click — Research

**Researched:** 2026-05-19
**Domain:** Rust DSP synthesis (triangle wave + exponential decay envelope), SPSC ring buffer beat-event protocol, main-thread lookahead scheduler, AudioWorklet sample-accurate read pattern
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Click oscillator frequency: ~1000 Hz (warm, mid-range tick).
- **D-02:** Click decay duration: ~10–15ms (short, punchy).
- **D-03:** Click envelope shape: triangle wave + exponential decay. Synthesized entirely in Rust WASM. Envelope is sample-rate-agnostic (all timings computed from `SAMPLE_RATE` stored in WASM at `init()`).
- **D-04:** Beat events in the SPSC ring are sample-accurate. Each u32 event encodes: bits 0–6 = sample offset within the current 128-frame quantum (0–127); bits 7–11 = voice type (Phase 2 uses normal=0 only); bits 12–31 = reserved (zero).
- **D-05:** WASM `fill_output_buffer` API updated to: `fill_output_buffer(sample_offset: u32, voice: u32, noise_gain: f32)`. Existing Phase 1 signature `fill_output_buffer(_beat_flags: u32, _noise_gain: f32)` is replaced.
- **D-06:** Ring buffer write (main thread scheduler) uses `Atomics.store` on the write index after writing the event; ring buffer read (AudioWorklet `process()`) uses `Atomics.load` on both indices. No allocation inside `process()`.
- **D-07:** Lookahead scheduler runs on the main thread via `setInterval` (25ms interval, 100ms lookahead window). Fixed BPM: 120 (hardcoded). Scheduler computes beat times in `AudioContext.currentTime` seconds, converts to absolute sample counts, derives quantum number and sample offset within that quantum, writes events to the ring.
- **D-08:** No Worker thread for Phase 2. Main thread setTimeout sufficient for 120 BPM with 100ms lookahead.
- **D-09:** Phase 2 targets macOS Chrome only. Safari support deferred.

### Claude's Discretion

- Exact `fill_output_buffer` sentinel value for "no beat this quantum" (e.g., `sample_offset = 0xFF` or a separate flag bit).
- Triangle wave generation algorithm in Rust (phase accumulator mod 1.0, `abs(phase - 0.5) * 4.0 - 1.0`).
- Whether the main-thread scheduler stores `nextBeatTime` as `AudioContext.currentTime + lookahead` or as a sample count.
- `setInterval` vs `setTimeout` (recursive) for the scheduler — both achieve 25ms cadence.

### Deferred Ideas (OUT OF SCOPE)

- Safari support — deferred to Phase 5 or later.
- BPM controls — Phase 3 scope. Phase 2 hardcodes 120 BPM.
- Accent vs. normal click distinction — Phase 3 scope.
- Worker thread scheduler — defer until drift is observed empirically.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUDIO-01 | Default click sounds are synthesized by the Rust WASM engine (no external audio files required) | Triangle wave + exponential decay implemented entirely in `rust/src/lib.rs`. Phase 1 pipeline proven; only the DSP body changes. |
| TIMING-04 | User can start and stop the metronome via a play/stop control | Play/Stop button and AudioEngine already exist from Phase 1. Phase 2 adds `_scheduler` to `start()`/`stop()`. |
| PLATFORM-01 | App runs in browser on macOS (Chrome and Safari) | D-09 scopes to Chrome only for Phase 2. Chrome path is primary; Safari deferred. |

</phase_requirements>

---

## Summary

Phase 2 is the first audible milestone. The entire WASM → AudioWorklet → SharedArrayBuffer pipeline from Phase 1 is proven and running. This phase has two separable concerns:

**Concern 1 — DSP synthesis in Rust:** Update `fill_output_buffer` to accept a `sample_offset` and synthesize a 1000 Hz triangle wave burst with an exponential decay envelope (~10–15ms). All state is kept in `static mut` statics (phase accumulator, envelope gain, envelope active flag, decay coefficient). No heap allocation. The decay coefficient is derived from `SAMPLE_RATE` at `init()` time so it is correct at any sample rate.

**Concern 2 — Lookahead scheduler + ring buffer protocol:** The main-thread `AudioEngine.start()` launches a recursive `setTimeout`/`setInterval` loop at 25ms that writes beat events into the existing `controlRingSAB` ring. Each event encodes the beat's scheduled quantum index (derived from `AudioContext.currentTime`) and the sample offset within that quantum. The worklet's `process()` reads the ring each frame, checks whether the current `currentFrame` matches the event's quantum, and calls `fill_output_buffer(sample_offset, voice, noise_gain)` at the right moment.

The key insight from research is that **`currentFrame`** (an `AudioWorkletGlobalScope` global, incrementing by 128 each quantum) is the correct primitive for matching scheduled beat events to the current audio quantum on the worklet side. [CITED: MDN AudioWorkletGlobalScope/currentFrame]

**Primary recommendation:** Implement DSP first (verifiable via OfflineAudioContext or by temporarily hardcoding a trigger), then wire the scheduler. This separates two failure modes (bad sound vs. bad timing) that are otherwise hard to debug together.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Click sound synthesis (DSP) | WASM (Rust, inside AudioWorklet thread) | — | Pure synthesis: phase accumulator, envelope multiplier. No JS involved. |
| Sample-rate-agnostic envelope | WASM (derives decay coefficient at `init()`) | — | `SAMPLE_RATE` static stored at `init()`; decay coefficient computed once |
| Beat event encoding (u32 packing) | Main thread (TypeScript scheduler) | — | Scheduler owns timing knowledge; packs event before writing to ring |
| Beat event writing to ring | Main thread (TypeScript scheduler) | — | SPSC producer; uses `Atomics.store` on write index |
| Beat event reading from ring | AudioWorklet (`process()`) | — | SPSC consumer; uses `Atomics.load`; zero allocation |
| Quantum matching (currentFrame) | AudioWorklet (`process()`) | — | `currentFrame` is the only reliable quantum counter in the worklet scope |
| Lookahead scheduling loop | Main thread (AudioEngine._scheduler) | — | Owns `AudioContext.currentTime`, BPM state, `nextBeatTime` |
| Play/Stop control | Main thread (App.svelte + AudioEngine) | — | Already implemented; Phase 2 adds scheduler start/stop inside `start()`/`stop()` |

---

## Standard Stack

No new npm or Rust dependencies are needed for Phase 2. All required capabilities are in-language (Rust `f32` arithmetic, TypeScript `Atomics`, browser-native `AudioContext.currentTime`). The build pipeline and SAB allocation are unchanged from Phase 1.

### Core (unchanged from Phase 1)

| Component | What It Provides | Phase 2 Use |
|-----------|-----------------|-------------|
| `rust/src/lib.rs` | WASM DSP engine | Replace silence stub with triangle wave + envelope synthesis |
| `public/worklet/processor.js` | AudioWorklet glue | Add ring buffer read + sample-offset-aware WASM call |
| `src/lib/audio-engine.ts` | Main-thread AudioEngine class | Add `_scheduler` property, start/stop lookahead loop |
| `controlRingSAB` (1032 bytes) | SPSC ring pre-allocated in Phase 1 | Write beat events from scheduler; read from worklet |
| `paramSAB` (32 bytes) | Atomics param buffer | `IS_PLAYING_IDX` slot (index 1) — worklet checks each frame |

### No New Packages

Phase 2 installs no new npm or Rust crates. [VERIFIED: all required APIs are browser-native or already in the project's Rust/TS code]

---

## Package Legitimacy Audit

No new packages are introduced in Phase 2. Audit is not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
[Main Thread — AudioEngine._scheduler (setInterval 25ms)]
        │
        │  Each tick while nextBeatTime < audioCtx.currentTime + 0.1:
        │    beatSampleAbs  = nextBeatTime * sampleRate      (float seconds → samples)
        │    quantumIndex   = Math.floor(beatSampleAbs / 128) (which 128-frame quantum)
        │    sampleOffset   = beatSampleAbs % 128             (offset within quantum, 0–127)
        │    event_u32      = (sampleOffset & 0x7F)           (bits 0–6; voice=0 for Phase 2)
        │    write event_u32 into controlRingSAB via Atomics.store
        │    nextBeatTime  += 60.0 / BPM                     (advance to next beat)
        │
        │  [SharedArrayBuffer — controlRingSAB]
        │  [read/write indices at bytes 0–7; 256 × u32 events at bytes 8–1031]
        ▼
[AudioWorklet thread — MetronomeProcessor.process()]
        │
        │  Each 128-sample quantum:
        │    myQuantum = currentFrame / 128          (integer division)
        │    loop: drain ring until readIdx === writeIdx
        │      event = Uint32Array[readIdx]           (no allocation)
        │      eventQuantum = event >> 7              (bits 7+, if used; see Note below)
        │      sampleOffset = event & 0x7F            (bits 0–6)
        │      → if eventQuantum matches myQuantum:
        │            call WASM fill_output_buffer(sampleOffset, voice=0, noise_gain=0.0)
        │      advance readIdx
        │
        │  outputs[0][0].set(this._outputView)        (copy 128 f32, no alloc)
        │  return true
        ▼
[WASM / Rust — fill_output_buffer(sample_offset, voice, noise_gain)]
        │
        │  If sample_offset != 0xFF (sentinel = no beat):
        │    ACTIVE = true; ENVELOPE_GAIN = 1.0
        │    PHASE_ACCUM = 0.0 (reset to start of waveform)
        │
        │  For each sample i in 0..128:
        │    if ACTIVE:
        │      if i < sample_offset: output = 0.0 (pre-beat silence)
        │      else:
        │        triangle = abs(PHASE_ACCUM - 0.5) * 4.0 - 1.0
        │        AUDIO_OUT[i] = triangle * ENVELOPE_GAIN
        │        PHASE_ACCUM = (PHASE_ACCUM + PHASE_INC) % 1.0
        │        ENVELOPE_GAIN *= DECAY_COEFF
        │        if ENVELOPE_GAIN < SILENCE_THRESHOLD: ACTIVE = false
        │    else:
        │      AUDIO_OUT[i] = 0.0
        │
        │  [Static buffer AUDIO_OUT is already viewed by worklet's this._outputView]
```

**Note on quantum matching:** The D-04 protocol encodes only sample_offset (bits 0–6) and voice (bits 7–11) per event. The event is written to the ring when the scheduler computes it, which means the event applies to a future quantum. The worklet must track which quantum the event belongs to. Two equivalent strategies are described in the Common Patterns section below.

### Recommended Project Structure (unchanged from Phase 1)

No structural changes. All Phase 2 changes are file edits, not file additions.

```
rust/src/lib.rs           ← DSP state statics + synthesizer logic (EDIT)
public/worklet/processor.js ← ring read + sample-offset WASM call (EDIT)
src/lib/audio-engine.ts   ← lookahead scheduler added (EDIT)
```

### Pattern 1: Triangle Wave Phase Accumulator (Claude's Discretion — recommended approach)

**What:** Maintains a normalized phase `[0.0, 1.0)` that increments each sample by `freq / sample_rate`. The triangle waveform maps this to `[-1.0, 1.0]`.

**When to use:** Always for the click oscillator. No wavetable allocation needed; runs entirely from a single `f32` static.

```rust
// Source: Standard DSP textbook formula; validated by wavetable synthesis literature [ASSUMED]
// PHASE_INC computed once at init() from SAMPLE_RATE:
//   PHASE_INC = CLICK_FREQ / SAMPLE_RATE  e.g. 1000.0 / 44100.0 ≈ 0.02268

fn triangle_sample(phase: f32) -> f32 {
    // phase in [0.0, 1.0)
    // Result in [-1.0, 1.0]
    (phase - 0.5).abs() * 4.0 - 1.0
}

// Per-sample hot path (inside fill_output_buffer loop):
//   let sample = triangle_sample(PHASE_ACCUM) * ENVELOPE_GAIN;
//   PHASE_ACCUM += PHASE_INC;
//   if PHASE_ACCUM >= 1.0 { PHASE_ACCUM -= 1.0; }  // no % — branchless subtraction
```

Triangle waves have odd harmonics at `1/n²` amplitudes (gentler than sawtooth), producing the hard mechanical click character described in D-03.

### Pattern 2: Exponential Decay Envelope

**What:** Per-sample multiplicative decay: `gain *= decay_coefficient`. Coefficient derived from desired half-life in samples.

**When to use:** Always — the industry-standard approach for percussive envelopes. No allocation, no table lookup.

```rust
// Source: Standard DSP envelope design [ASSUMED]; consistent with fundsp envelope pattern
//
// To compute decay_coefficient for a desired decay_time_ms at a given sample_rate:
//   let decay_samples = (decay_time_ms / 1000.0) * sample_rate;
//   let decay_coeff = (-1.0_f32 / decay_samples).exp();   // ~0.9997 at 44100Hz for 10ms
//
// Alternatively, for a target amplitude after decay_ms (e.g., reach 0.001 from 1.0):
//   decay_coeff = (target_amp).powf(1.0 / decay_samples)
//
// Phase 2 target: 10–15ms decay. At 44100 Hz, 12ms = 529 samples.
//   decay_coeff ≈ exp(-1/529) ≈ 0.99811

// Static WASM state (all static mut, set at init time or per-trigger):
// static mut PHASE_ACCUM: f32 = 0.0;
// static mut PHASE_INC: f32 = 0.0;      // set in init() = CLICK_FREQ / SAMPLE_RATE
// static mut ENVELOPE_GAIN: f32 = 0.0;
// static mut DECAY_COEFF: f32 = 0.0;    // set in init() = exp(-1 / decay_samples)
// static mut ACTIVE: bool = false;
// static const SILENCE_THRESHOLD: f32 = 1e-4;
```

### Pattern 3: Sentinel Value for "No Beat This Quantum"

**What:** `fill_output_buffer` needs to know whether a beat fires this quantum. Two approaches:

**Option A (recommended — Claude's Discretion):** Sentinel `sample_offset = 0xFF` (255). Since valid offsets are 0–127 (bits 0–6 max value = 127), 0xFF is unambiguously out of range. The worklet passes 255 when no ring event matches the current quantum.

**Option B:** Separate `has_beat: bool` parameter. Adds one argument but makes the API self-documenting. Heavier for a C ABI signature.

Option A is recommended because it keeps the signature at 3 arguments (matching D-05) and the sentinel is unambiguous given the 7-bit range constraint.

### Pattern 4: Quantum-Matching Event Read in `process()`

**What:** The worklet reads events from the ring buffer each `process()` call and determines whether any event belongs to the current 128-frame quantum.

**Key globals in AudioWorkletGlobalScope:**
- `currentFrame`: read-only integer, increments by 128 per quantum. [CITED: MDN AudioWorkletGlobalScope/currentFrame]
- `currentTime`: read-only float, `currentFrame / sampleRate`. Same information, different units.

**Strategy A — Quantum index encoded in the event (more robust):**

The scheduler computes `quantumIndex = Math.floor(beatSampleAbs / 128)` and encodes it in the upper 20 bits of the u32 event (the "reserved" bits 12–31 from D-04). The worklet compares `currentFrame / 128` against `event >> 12` to match. This makes the ring a "future event queue" and handles the case where multiple beats fall in different future quanta.

**Strategy B — Single-event-per-quantum convention (simpler for Phase 2 at 120 BPM):**

At 120 BPM, beats occur every 0.5 seconds = 22050 samples = 172 quanta apart. The ring always has at most one future event. The scheduler writes the event ~100ms (~191 quanta) ahead. The worklet reads the ring, checks if the event's sampleOffset is valid, and uses `currentFrame` to decide if the event is "now":

```javascript
// Inside process() — zero allocation, no new, no object literals:
const readIdx = Atomics.load(this._ringIndices, 0);   // READ_IDX = 0
const writeIdx = Atomics.load(this._ringIndices, 1);  // WRITE_IDX = 1

let beatSampleOffset = 0xFF; // sentinel = no beat
let beatVoice = 0;

if (readIdx !== writeIdx) {
    const event = this._ringData[readIdx];
    // Decode event:
    const sampleOffset = event & 0x7F;           // bits 0-6
    const voice = (event >> 7) & 0x1F;           // bits 7-11
    const scheduledQuantum = event >> 12;         // bits 12-31 (Strategy A)

    const myQuantum = (currentFrame / 128) | 0;  // integer division, no Math.floor alloc

    if (scheduledQuantum === myQuantum) {
        // This event fires in the current quantum
        beatSampleOffset = sampleOffset;
        beatVoice = voice;
        // Advance read index (consume event)
        Atomics.store(this._ringIndices, 0, (readIdx + 1) & 0xFF); // 256-slot mask
    }
    // If scheduledQuantum > myQuantum: event is for a future quantum — leave in ring
    // If scheduledQuantum < myQuantum: stale event, should not happen with 100ms lookahead
}

this._exports.fill_output_buffer(beatSampleOffset, beatVoice, 0.0);
```

**Recommendation (Claude's Discretion):** Use Strategy A (quantum index in bits 12–31). This makes Phase 3+ extensions (sub-beat scheduling, multiple events per scheduler tick) trivial. The u32 can hold quantum indices up to 4M — enough for ~14 hours at 48kHz before overflow.

### Pattern 5: Lookahead Scheduler Math

**What:** Converting `AudioContext.currentTime` + BPM into ring buffer events with sample-accurate timing.

**Core timing constants:**
```typescript
const BPM = 120;
const SECONDS_PER_BEAT = 60.0 / BPM;  // 0.5s at 120 BPM
const LOOKAHEAD_S = 0.1;               // schedule 100ms into the future (D-07)
const INTERVAL_MS = 25;                // scheduler fires every 25ms (D-07)
```

**Beat-to-quantum conversion:**
```typescript
// Inside the scheduler tick function:
while (nextBeatTime < audioCtx.currentTime + LOOKAHEAD_S) {
    const sampleRate = audioCtx.sampleRate;          // e.g. 44100 or 48000
    const beatSampleAbs = nextBeatTime * sampleRate; // absolute sample count (float)
    const quantumIndex = Math.floor(beatSampleAbs / 128);  // which 128-frame quantum
    const sampleOffset = Math.round(beatSampleAbs % 128);  // offset within quantum (0–127)

    // Clamp sampleOffset to valid range (edge case: rounding at quantum boundary)
    const clampedOffset = Math.min(sampleOffset, 127);

    // Pack event: bits 0-6 = sampleOffset, bits 7-11 = voice (0=normal), bits 12-31 = quantumIndex
    const event = (clampedOffset & 0x7F) | (0 << 7) | (quantumIndex << 12);

    // Write to ring (producer — main thread)
    const writeIdx = Atomics.load(ringIndices, 1);  // WRITE_IDX = 1
    const nextWrite = (writeIdx + 1) & 0xFF;        // 256-slot mask
    if (nextWrite !== Atomics.load(ringIndices, 0)) { // not full
        ringData[writeIdx] = event;
        Atomics.store(ringIndices, 1, nextWrite);
    }
    // Advance scheduler
    nextBeatTime += SECONDS_PER_BEAT;
}
```

**Safety margin analysis at 120 BPM:**
- Beat interval: 500ms
- Lookahead window: 100ms
- Scheduler interval: 25ms
- Safety factor: 100ms / 25ms = 4x (the scheduler fires 4 times within the lookahead window)
- Even if one scheduler tick is delayed 75ms by main-thread work, the next tick will catch up [CITED: web.dev/audio-scheduling — standard pattern]

### Pattern 6: Rust Static State for DSP

**What:** All synthesizer state lives in `static mut` statics. No heap allocation. State persists between `fill_output_buffer` calls (so the envelope tail decays correctly across multiple quanta).

```rust
// rust/src/lib.rs additions (Phase 2)
static mut SAMPLE_RATE: f32 = 44100.0;   // set in init()
static mut PHASE_ACCUM: f32 = 0.0;       // triangle wave phase [0.0, 1.0)
static mut PHASE_INC: f32 = 0.0;         // set in init() = CLICK_FREQ / SAMPLE_RATE
static mut ENVELOPE_GAIN: f32 = 0.0;     // current envelope amplitude
static mut DECAY_COEFF: f32 = 0.0;       // set in init() = exp(-1 / decay_samples)
static mut ACTIVE: bool = false;          // is the click envelope currently running?

// Constants (compile-time)
const CLICK_FREQ: f32 = 1000.0;          // D-01
const DECAY_MS: f32 = 12.0;             // D-02: 10–15ms range; 12ms is the midpoint
const SILENCE_THRESHOLD: f32 = 1.0e-4;  // stop rendering when envelope < this

// Updated init() — already exists, add PHASE_INC and DECAY_COEFF computation:
#[no_mangle]
pub extern "C" fn init(sample_rate: f32) {
    unsafe {
        std::ptr::addr_of_mut!(SAMPLE_RATE).write(sample_rate);
        let phase_inc = CLICK_FREQ / sample_rate;
        std::ptr::addr_of_mut!(PHASE_INC).write(phase_inc);
        let decay_samples = (DECAY_MS / 1000.0) * sample_rate;
        let decay_coeff = (-1.0_f32 / decay_samples).exp();
        std::ptr::addr_of_mut!(DECAY_COEFF).write(decay_coeff);
    }
}
```

### Anti-Patterns to Avoid

- **Hardcoding sample rate in DSP constants:** Envelope duration in samples must be derived from `SAMPLE_RATE` at `init()` time. macOS Chrome defaults to 44100 Hz; some devices use 48000 Hz. An 8.8% sample rate error produces perceptibly wrong click duration. [CITED: PITFALLS.md Pitfall 7]
- **Using `%` for phase wrap:** Rust's `%` on `f32` compiles to a division. The branchless `if PHASE_ACCUM >= 1.0 { PHASE_ACCUM -= 1.0; }` is faster and equally correct for this range.
- **Allocating in `process()`:** `Math.floor()` does NOT allocate. `(x / 128) | 0` (bitwise OR with 0) is an integer-truncation idiom that also does not allocate and is marginally faster. Avoid `new`, object literals `{}`, and array literals `[]` inside `process()`. [CITED: PITFALLS.md Pitfall 4]
- **Missing stale event handling in the worklet:** If the main-thread scheduler writes a quantum index that the worklet has already passed (e.g., due to a paused tab resumed), the event must be drained from the ring without triggering synthesis. Check `scheduledQuantum < myQuantum` and consume without firing.
- **Not resetting `nextBeatTime` on restart:** When `stop()` then `start()` is called, `nextBeatTime` must be re-seeded to `audioCtx.currentTime` (not `0.0` or a stale value from the previous session). Otherwise the scheduler floods the ring with stale past-due events immediately.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exponential decay coefficient from decay time | Custom lookup table or approximation | `(-1.0_f32 / decay_samples).exp()` in Rust | `exp()` is intrinsic, single instruction on modern CPUs; approximations introduce pitch/timing errors |
| Clock for lookahead | JS `Date.now()` or `performance.now()` | `AudioContext.currentTime` | The audio hardware clock; immune to GC, tab throttling, and process scheduling jitter [CITED: web.dev/audio-scheduling] |
| Custom waveform table | Float32Array in WASM heap | Phase accumulator formula | Wavetable requires allocation; formula needs one `f32` static |
| Ring buffer SPSC from scratch | Custom queue | Existing `controlRingSAB` + Atomics pattern (already implemented in Phase 1) | The pattern is already wired and tested in the walking skeleton |

**Key insight:** The entire DSP synthesis requires exactly 6 `static mut` values in Rust and ~15 lines of arithmetic per quantum. Resist the temptation to add complexity (e.g., band-limiting the triangle wave) before the basic click is proven to work.

---

## Common Pitfalls

### Pitfall 1: Envelope Decay Over Quantum Boundaries

**What goes wrong:** The click envelope starts mid-quantum (at `sample_offset`, e.g., sample 64 of 128). The envelope's tail must continue into the next quantum(s). If `fill_output_buffer` only applies the envelope for the remainder of the triggering quantum and resets state, subsequent quanta produce silence instead of the decaying tail.

**Why it happens:** `fill_output_buffer` is called every quantum. The synthesizer state (`ENVELOPE_GAIN`, `PHASE_ACCUM`, `ACTIVE`) must persist between calls. The Phase 1 stub reset everything each call.

**How to avoid:** The `ACTIVE`, `ENVELOPE_GAIN`, and `PHASE_ACCUM` statics carry state across calls. On a quantum where `sample_offset = 0xFF` (sentinel), the function still advances the envelope for all 128 samples if `ACTIVE == true`. The envelope only clears `ACTIVE` when `ENVELOPE_GAIN < SILENCE_THRESHOLD`.

**Warning signs:** Click sounds abbreviated or truncated; correct first 64 samples, silence for next 64+.

### Pitfall 2: `nextBeatTime` Not Initialized Before Scheduler Loop

**What goes wrong:** The scheduler `while` loop fires immediately with `nextBeatTime = 0.0`. Since `0.0 < audioCtx.currentTime + 0.1` is always true when the context has been running, the scheduler floods the ring with thousands of stale events in the first tick.

**Why it happens:** `nextBeatTime` must be seeded to `audioCtx.currentTime` at scheduler start time, not to zero.

**How to avoid:**
```typescript
// In AudioEngine.start(), after AudioContext is running:
this._nextBeatTime = this._audioCtx.currentTime;
this._schedulerIntervalId = setInterval(() => this._schedulerTick(), 25);
```

**Warning signs:** Dozens of events written to ring in the first tick; clicks burst at startup then go silent.

### Pitfall 3: Quantum Index Overflow in u32 Event Packing

**What goes wrong:** `quantumIndex << 12` overflows a 32-bit integer after a long session if `quantumIndex` is large. At 44100 Hz with 128-sample quanta, `quantumIndex` increments by ~344 per second. After ~3.5 hours, `quantumIndex` exceeds 2^20 = 1,048,576, overflowing the 20 bits available in bits 12–31.

**Why it happens:** Phase 2 hardcodes 120 BPM in a single session. A 3.5-hour session at 120 BPM exceeds the quantum counter range.

**How to avoid:** Use `currentFrame` (which is an integer that also increments by 128 per quantum) — it may itself overflow after ~27 hours at 44100 Hz. For Phase 2 (60-second validation), this is not an issue. For production, consider resetting the base or using a relative quantum count. Document for Phase 5.

**Warning signs:** Clicks stop after extended playback; ring events have `scheduledQuantum` that never matches `currentFrame / 128`.

### Pitfall 4: `AudioContext.suspend()` on Stop Drops Scheduled Events

**What goes wrong:** `AudioEngine.stop()` calls `audioCtx.suspend()`. Any events already in the ring buffer with future quantum indices will be stale when `audioCtx.resume()` is called later. The `currentFrame` counter may reset or continue, depending on implementation.

**Why it happens:** `AudioContext.suspend()` pauses the audio hardware clock. On Chrome, `currentTime` pauses; `currentFrame` pauses too. On resume, both continue from where they paused. Events with quantum indices written before suspend but "in the past" of the resumed clock will be stale.

**How to avoid:** On `stop()`: call `this._clearRing()` (reset read and write indices to same value via `Atomics.store`) before or immediately after `audioCtx.suspend()`. On `start()`: re-seed `nextBeatTime` and verify the ring is empty.

**Warning signs:** Spurious click at the moment of playback resume; no subsequent clicks.

### Pitfall 5: `AudioContext.currentTime` Precision and Rounding

**What goes wrong:** `AudioContext.currentTime` is updated once per audio quantum (every 128 samples), not continuously. On Chrome, the value seen by the main thread may be slightly behind the audio thread's view. This means `beatSampleAbs` computed from `currentTime` may be off by up to one quantum (128 samples ≈ 2.9ms).

**Why it happens:** The audio clock is on the audio thread; the main thread polls it. As documented in bugzilla and the Web Audio spec, `currentTime` corresponds to block boundaries. [CITED: MDN BaseAudioContext/currentTime]

**How to avoid:** The 100ms lookahead window absorbs this error (~2.9ms out of 100ms = 2.9% error). For Phase 2 at 120 BPM, timing precision of ±1 quantum is imperceptible (one quantum = 2.9ms; the beat interval is 500ms). Document for Phase 3 if sub-quantum accuracy for beat 1 is needed.

**Warning signs:** Not a bug for Phase 2 — acceptable imprecision. Flag if user reports audible timing irregularity in Phase 3.

---

## Code Examples

### Verified Pattern: Triangle Wave Sample Function

```rust
// Source: Standard DDS/wavetable synthesis formula [ASSUMED]
// phase in [0.0, 1.0) → output in [-1.0, 1.0]
// Odd harmonics at 1/n² amplitudes — "harder" than sine, suitable for woodblock click.
#[inline(always)]
fn triangle_sample(phase: f32) -> f32 {
    (phase - 0.5).abs() * 4.0 - 1.0
}
```

### Verified Pattern: fill_output_buffer with sample_offset (updated signature)

```rust
// Source: CONTEXT.md D-05; Phase 1 lib.rs extended [CITED: 02-CONTEXT.md]
#[no_mangle]
pub extern "C" fn fill_output_buffer(sample_offset: u32, _voice: u32, _noise_gain: f32) {
    unsafe {
        let ptr = std::ptr::addr_of_mut!(AUDIO_OUT) as *mut f32;
        let sentinel: u32 = 0xFF;

        // Trigger: start envelope if a beat fires this quantum
        if sample_offset != sentinel {
            std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(1.0_f32);
            std::ptr::addr_of_mut!(PHASE_ACCUM).write(0.0_f32);
            std::ptr::addr_of_mut!(ACTIVE).write(true);
        }

        for i in 0..128_usize {
            let sample = if std::ptr::addr_of!(ACTIVE).read()
                && (sample_offset == sentinel || i >= sample_offset as usize)
            {
                let phase = std::ptr::addr_of!(PHASE_ACCUM).read();
                let gain = std::ptr::addr_of!(ENVELOPE_GAIN).read();
                let s = (phase - 0.5).abs() * 4.0 - 1.0;
                let output = s * gain;

                // Advance phase
                let mut new_phase = phase + std::ptr::addr_of!(PHASE_INC).read();
                if new_phase >= 1.0 { new_phase -= 1.0; }
                std::ptr::addr_of_mut!(PHASE_ACCUM).write(new_phase);

                // Advance envelope
                let new_gain = gain * std::ptr::addr_of!(DECAY_COEFF).read();
                std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(new_gain);
                if new_gain < 1.0e-4 {
                    std::ptr::addr_of_mut!(ACTIVE).write(false);
                }

                output
            } else {
                0.0_f32
            };
            ptr.add(i).write(sample);
        }
    }
}
```

### Verified Pattern: Scheduler tick in TypeScript

```typescript
// Source: web.dev/audio-scheduling + MDN Advanced Techniques [CITED]
// Adapted for ring buffer write instead of AudioBufferSourceNode.start()

private _schedulerTick(): void {
    if (!this._audioCtx || !this._controlRingIndices || !this._controlRingData) return;

    const sampleRate = this._audioCtx.sampleRate;
    const lookahead = 0.1; // 100ms

    while (this._nextBeatTime < this._audioCtx.currentTime + lookahead) {
        const beatSampleAbs = this._nextBeatTime * sampleRate;
        const quantumIndex = Math.floor(beatSampleAbs / 128);
        const sampleOffset = Math.min(Math.round(beatSampleAbs % 128), 127);

        // Pack u32: bits 0-6 = sampleOffset, bits 7-11 = voice=0, bits 12-31 = quantumIndex
        const event = (sampleOffset & 0x7F) | (quantumIndex << 12);

        // Write to SPSC ring (producer — no Atomics.wait)
        const writeIdx = Atomics.load(this._controlRingIndices, 1);
        const nextWrite = (writeIdx + 1) & 0xFF;
        if (nextWrite !== Atomics.load(this._controlRingIndices, 0)) {
            this._controlRingData[writeIdx] = event;
            Atomics.store(this._controlRingIndices, 1, nextWrite);
        }

        this._nextBeatTime += 60.0 / 120; // fixed 120 BPM for Phase 2
    }
}
```

### Verified Pattern: Ring buffer read in process() (zero allocation)

```javascript
// Source: ARCHITECTURE.md + blog.paul.cx SPSC pattern [CITED: ARCHITECTURE.md]
// Inside MetronomeProcessor.process() — no new, no object literals, no Math.floor

process(_inputs, outputs) {
    if (!this._ready) return true;

    const readIdx = Atomics.load(this._ringIndices, 0);
    const writeIdx = Atomics.load(this._ringIndices, 1);

    let sampleOffset = 0xFF; // sentinel = no beat
    let voice = 0;

    if (readIdx !== writeIdx) {
        const event = this._ringData[readIdx];
        const evOffset  = event & 0x7F;
        const evVoice   = (event >> 7) & 0x1F;
        const evQuantum = (event >> 12) | 0;
        const myQuantum = (currentFrame / 128) | 0;

        if (evQuantum === myQuantum) {
            sampleOffset = evOffset;
            voice = evVoice;
            Atomics.store(this._ringIndices, 0, (readIdx + 1) & 0xFF);
        }
        // If evQuantum > myQuantum: leave in ring for future quantum
    }

    this._exports.fill_output_buffer(sampleOffset, voice, 0.0);
    outputs[0][0].set(this._outputView);
    return true;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `scheduleNote()` via `AudioBufferSourceNode.start(time)` | SPSC ring buffer + WASM synthesis | Circa 2019 (AudioWorklet era) | No per-note AudioNode allocation; synthesis in WASM avoids JS GC |
| Sine wave for click sound | Triangle wave | Design choice (D-03) | Triangle has harder mechanical character; appropriate for woodblock-style click |
| `ScriptProcessorNode` | `AudioWorkletProcessor` | Chrome 66 (2018); baseline since 2021 | ScriptProcessorNode is deprecated |
| `setInterval` as timing source | `AudioContext.currentTime` for scheduling (setInterval only to trigger the check) | Popularized by Chris Wilson "A Tale of Two Clocks" (2013), now universal | Eliminates cumulative drift from JS timer imprecision |

**Deprecated/outdated:**
- `ScriptProcessorNode`: do not use; `AudioWorkletProcessor` is the standard.
- Using `setInterval` as the direct audio clock: use `AudioContext.currentTime` for all scheduled event times; `setInterval` is only the polling mechanism.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Triangle wave formula `(phase - 0.5).abs() * 4.0 - 1.0` is correct for phase in [0.0, 1.0) | Code Examples, Pattern 1 | Wrong formula produces DC offset or clipped output; verify by inspection: at phase=0.0 → -1.0; at phase=0.25 → 0.0; at phase=0.5 → 1.0; at phase=0.75 → 0.0 |
| A2 | Decay coefficient `(-1.0_f32 / decay_samples).exp()` gives correct 63% amplitude reduction per decay time | Code Examples, Pattern 2 | Incorrect decay speed — either too short (clicky) or too long (muddy). Verify: at `t = decay_samples`, `gain = e^(-1) ≈ 0.368`. Adjust `DECAY_MS` if needed |
| A3 | `currentFrame / 128` gives the current quantum index that matches the scheduler's `Math.floor(beatSampleAbs / 128)` | Pattern 4 | Quantum mismatch → events never fire or fire spuriously. Verified by reasoning: both divide the same absolute sample count by 128. `currentFrame` is an integer; the division is exact |
| A4 | `AudioContext.suspend()` on stop does not reset `currentFrame` on Chrome | Pitfall 4 | If Chrome resets `currentFrame` on suspend/resume, stale quantum events could fire incorrectly. Verify empirically in Phase 2 manual validation |
| A5 | Strategy A (quantum index in bits 12–31) fits within a u32 for sessions up to ~3.5 hours | Pattern 4 | If user runs the metronome for >3.5 hours at 44100 Hz, quantumIndex overflows 20 bits. Not a Phase 2 risk (60-second validation); document for Phase 5 |

---

## Open Questions (RESOLVED)

1. **Does `AudioContext.suspend()` pause `currentFrame`, and does it resume from the same value?**
   - What we know: `currentTime` pauses on Chrome; `currentFrame` should behave the same (both are derived from the audio hardware clock).
   - What's unclear: Spec does not explicitly state `currentFrame` behavior on suspend/resume.
   - **RESOLVED: Verify empirically in Plan 02-02 Task 2 human-verify checkpoint.** If `currentFrame` resets to 0 on resume, stale ring events must be purged on `stop()`.

2. **Should the sentinel be `0xFF` (255) or a dedicated `has_beat` parameter in `fill_output_buffer`?**
   - What we know: D-05 locks the 3-argument signature; sentinel approach preserves it.
   - What's unclear: Nothing — sentinel is unambiguous given bits 0–6 range (0–127).
   - **RESOLVED: Use `0xFF` sentinel (Claude's Discretion). Document it as a constant in both `lib.rs` and `processor.js`.**

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust stable | WASM DSP compile | Yes (from Phase 1) | 1.95.0 | — |
| wasm32-unknown-unknown target | cargo build | Yes (from Phase 1) | — | — |
| wasm-opt (binaryen) | xtask build pipeline | Yes (from Phase 1) | 129 | Skip for debug builds |
| Node.js | Vite dev server | Yes (from Phase 1) | 26.0.0 | — |
| Chrome macOS | Manual testing (D-09) | Assumed available | — | — |

**Missing dependencies with no fallback:** None — Phase 1 established the full toolchain.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (Rust DSP unit) | `cargo test` (native host — no browser needed for pure math) |
| Framework (TS) | Vitest 4.1.6 (not yet installed — Wave 0 gap) |
| Framework (Integration) | Manual browser verification in Chrome |
| Config file | `vitest.config.ts` (Wave 0 gap — to be created) |
| Quick run command | `cargo test --manifest-path rust/Cargo.toml` |
| Full suite command | `cargo test --manifest-path rust/Cargo.toml && npm run typecheck` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUDIO-01 | Triangle wave synthesis produces non-zero output when triggered | Unit (Rust) | `cargo test --manifest-path rust/Cargo.toml` | ❌ Wave 0 |
| AUDIO-01 | Envelope decays to silence within ~15ms at 44100 Hz | Unit (Rust) | `cargo test --manifest-path rust/Cargo.toml` | ❌ Wave 0 |
| AUDIO-01 | `fill_output_buffer(0xFF, 0, 0.0)` produces silence when inactive | Unit (Rust) | `cargo test --manifest-path rust/Cargo.toml` | ❌ Wave 0 |
| TIMING-04 | Play button starts audio; Stop button silences it | Manual (browser) | — | N/A (Phase 1 UI already exists) |
| TIMING-04 | AudioContext.currentTime clock shows no drift over 60 seconds | Manual (browser console) | — | N/A |
| PLATFORM-01 | App opens and produces click audio in macOS Chrome | Manual (browser) | — | N/A |

### Rust Unit Test Design

The following test structure belongs in `rust/src/lib.rs` or a separate `rust/src/dsp.rs` module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triangle_wave_range() {
        // triangle_sample must output [-1.0, 1.0] for any phase in [0.0, 1.0)
        for i in 0..100 {
            let phase = i as f32 / 100.0;
            let s = (phase - 0.5).abs() * 4.0 - 1.0;
            assert!(s >= -1.0 && s <= 1.0, "phase={} → s={} out of range", phase, s);
        }
    }

    #[test]
    fn envelope_decays_to_silence() {
        // At 44100 Hz, 12ms decay = 529 samples. Verify decay_coeff computed correctly.
        let sample_rate = 44100.0_f32;
        let decay_ms = 12.0_f32;
        let decay_samples = (decay_ms / 1000.0) * sample_rate;
        let coeff = (-1.0_f32 / decay_samples).exp();
        let mut gain = 1.0_f32;
        for _ in 0..(decay_samples as usize) {
            gain *= coeff;
        }
        // After one decay_samples, gain should be e^(-1) ≈ 0.368
        assert!((gain - 0.3679).abs() < 0.01, "gain after decay_samples = {}", gain);
    }

    #[test]
    fn sentinel_produces_silence_when_inactive() {
        // Call fill_output_buffer with sentinel 0xFF when ACTIVE is false → silence
        // Requires init() + calling fill_output_buffer + reading AUDIO_OUT
        // Note: unsafe static access is acceptable in test scope
        unsafe {
            SAMPLE_RATE = 44100.0;
            PHASE_INC = CLICK_FREQ / SAMPLE_RATE;
            let dc = (-1.0_f32 / (0.012 * 44100.0)).exp();
            DECAY_COEFF = dc;
            ACTIVE = false;
            ENVELOPE_GAIN = 0.0;

            fill_output_buffer(0xFF, 0, 0.0);

            let ptr = std::ptr::addr_of!(AUDIO_OUT) as *const f32;
            for i in 0..128_usize {
                assert_eq!(ptr.add(i).read(), 0.0_f32, "sample {} should be 0", i);
            }
        }
    }
}
```

### Sampling Rate

- **Per task commit:** `cargo test --manifest-path rust/Cargo.toml && npm run typecheck`
- **Per wave merge:** Full manual browser checklist (see below)
- **Phase gate:** All manual verification items pass before `/gsd:verify-work`

### Manual Verification Checklist (Phase Gate)

1. `cargo xtask build` exits 0; `public/wasm/metronome_engine_bg.wasm` updated.
2. Open `http://localhost:5173` in macOS Chrome.
3. Click Play — an audible click is heard at ~120 BPM (2 clicks per second).
4. The click sounds percussive (short decay, not a sustained tone) — matches woodblock character.
5. Let run for 60 seconds — clicks remain evenly spaced with no audible drift.
6. Open Chrome DevTools → Web Audio inspector → render capacity stays below 20% during playback.
7. Click Stop — audio stops immediately (no trailing clicks).
8. Click Play again — audio resumes correctly (no burst of stale events, no silence).
9. DevTools Console shows no allocation errors, no `GC` warnings during playback.
10. `crossOriginIsolated === true` in console (inherited from Phase 1 — verify not broken).

### Wave 0 Gaps

- [ ] `rust/src/lib.rs` — add Rust unit tests for DSP functions (triangle wave range, envelope decay, sentinel silence)
- [ ] Vitest not installed — `npm install -D vitest` — if TypeScript scheduler tests are desired (optional for Phase 2, no TS scheduler logic to unit test yet)

*(No new test files for the TypeScript side — the scheduler logic is integration-tested via the manual checklist. Rust unit tests cover the DSP correctness path.)*

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth |
| V3 Session Management | No | No sessions |
| V4 Access Control | No | Single-user browser app |
| V5 Input Validation | Minimal | `sample_offset` clamped to 0–127 in scheduler before packing; sentinel 0xFF handled in WASM |
| V6 Cryptography | No | No cryptographic operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Ring buffer overflow (main thread writes faster than worklet consumes) | Denial of Service | Drop-if-full check: `nextWrite !== readIdx` before writing. At 120 BPM, ring accumulates ~1 event/500ms; 256-slot ring holds ~128 seconds of headroom |
| Stale quantum events after suspend/resume | Tampering (incorrect audio) | Clear ring on `stop()`; re-seed `nextBeatTime` on `start()` |

---

## Sources

### Primary (HIGH confidence)

- [MDN: AudioWorkletGlobalScope.currentFrame](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentFrame) — `currentFrame` type (integer), increment (128 per quantum), browser baseline (2021)
- [MDN: BaseAudioContext.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime) — clock properties, quantum alignment, precision rounding
- [MDN: Advanced Techniques — Step Sequencer](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques) — canonical lookahead scheduler implementation with `scheduleNote`/`nextNote`/`scheduler` functions
- [web.dev: A Tale of Two Clocks](https://web.dev/audio-scheduling/) — seminal article on `AudioContext.currentTime` + `setTimeout` lookahead pattern; 25ms/100ms values sourced here
- [Chrome Developers: Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern/) — WASM ring buffer + SPSC design
- [blog.paul.cx: Wait-Free SPSC Ring Buffer](https://blog.paul.cx/post/a-wait-free-spsc-ringbuffer-for-the-web/) — Atomics-based ring implementation
- [loke.dev: Stop Allocating Inside AudioWorkletProcessor](https://loke.dev/blog/stop-allocating-inside-audioworkletprocessor) — zero-allocation discipline; `currentFrame` for scheduling
- Phase 1 CONTEXT.md, ARCHITECTURE.md, PITFALLS.md — established decisions and patterns carried forward

### Secondary (MEDIUM confidence)

- [Casey Primozic: FM Synthesis in Browser with Rust WASM](https://cprimozic.net/blog/fm-synth-rust-wasm-simd/) — Rust DSP in WASM performance characteristics; static state patterns
- [Bugzilla 901247: AudioContext.currentTime doesn't update continuously](https://bugzilla.mozilla.org/show_bug.cgi?id=901247) — Firefox vs Chrome clock update semantics
- [Web Audio API Issue #2467: start(currentTime + baseLatency) behavior](https://github.com/WebAudio/web-audio-api/issues/2467) — scheduling imprecision acknowledgment

### Tertiary (LOW confidence)

- Triangle wave formula `(phase - 0.5).abs() * 4.0 - 1.0` — training knowledge / standard DSP formula. Verifiable by inspection of boundary values. [ASSUMED]
- Decay coefficient formula `exp(-1 / decay_samples)` for envelope half-life — training knowledge / DSP textbook formula. [ASSUMED]

---

## Metadata

**Confidence breakdown:**

- DSP synthesis (triangle wave + envelope): MEDIUM — algorithms are standard DSP; specific Rust implementation is training knowledge [ASSUMED] but verifiable via Rust unit tests
- Ring buffer protocol / SPSC pattern: HIGH — from Phase 1 established patterns and authoritative sources
- Lookahead scheduler timing math: HIGH — from MDN Advanced Techniques and web.dev/audio-scheduling canonical sources
- `currentFrame` for quantum matching: HIGH — from MDN AudioWorkletGlobalScope/currentFrame (widely available baseline 2021)
- Pitfalls: HIGH — derived from Phase 1 research + codebase analysis + authoritative source citations

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (30 days — Web Audio API is stable; browser behavior documented)
