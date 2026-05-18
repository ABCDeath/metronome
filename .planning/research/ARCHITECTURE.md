# Architecture Patterns

**Domain:** Browser metronome with Rust WASM audio engine
**Researched:** 2026-05-18
**Confidence:** HIGH (multiple authoritative sources corroborate all major patterns)

---

## Recommended Architecture

The system splits into three distinct execution contexts that can never share synchronous call stacks:

```
┌─────────────────────────────────────────────────────────────┐
│  MAIN THREAD (UI)                                           │
│  TypeScript app layer                                       │
│  - Renders UI, handles user events                          │
│  - Loads WASM module, compiles it                           │
│  - Owns AudioContext, creates AudioWorkletNode              │
│  - Runs lookahead scheduler (setTimeout 25ms interval)      │
│  - Writes beat events into SharedArrayBuffer control ring   │
│  - Manages PatternState (tracks, beats, BPM, time sig)      │
└────────────────────┬────────────────────────────────────────┘
                     │ postMessage (init only)
                     │ SharedArrayBuffer (runtime)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  AUDIOWORKLET THREAD (audio-priority OS thread)             │
│  AudioWorkletProcessor JS glue                              │
│  - Holds compiled WASM instance                             │
│  - process() called every 128 samples (~2.9ms @ 44.1kHz)   │
│  - Reads control ring buffer (beat events from main thread) │
│  - Calls WASM export: fill_output_buffer(output_ptr, 128)   │
│  - Copies 128 f32 samples from WASM linear memory to        │
│    Web Audio outputs[][] Float32Array                        │
└────────────────────┬────────────────────────────────────────┘
                     │ exports via linear memory pointer
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  WASM (Rust, executes inside AudioWorklet thread)           │
│  - Synthesizes click transients (exponential decay env)     │
│  - Mixes white noise (xorshift PRNG, gain-controlled)       │
│  - Maintains active voice state (what beat is sounding)     │
│  - Writes samples to static output buffer                   │
│  - Exposes get_output_buffer_ptr() → *const f32             │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

### Component 1: WASM Audio Engine (Rust, `src/engine/`)

**Responsibility:** Pure synthesis. Given a trigger, produce audio samples. No scheduling, no state beyond voice/envelope tracking.

**Communicates with:** AudioWorklet glue layer only (via linear memory pointer)

**Exports (via `#[no_mangle]` or wasm-bindgen):**
```rust
// Called once at startup; returns pointer to static output buffer
pub extern "C" fn get_output_buffer_ptr() -> *const f32;

// Called every process() invocation — synthesizes 128 f32 samples into output buffer
// beat_flags: bitmask of which voices to trigger this frame
pub extern "C" fn fill_output_buffer(beat_flags: u32, noise_gain: f32);

// Param setters called when user changes settings (safe to call from worklet thread)
pub extern "C" fn set_voice_params(voice_idx: u32, freq: f32, decay_ms: f32);
```

**Internal WASM state:**
- Active voice array: per-voice envelope state (phase, amplitude, decay rate)
- White noise PRNG state (xorshift32, single `u32` seed)
- Output buffer: `static mut AUDIO_OUT: [f32; 128]`

**White noise algorithm — use xorshift32:**

```rust
fn xorshift32(state: &mut u32) -> f32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    // Map u32 → [-1.0, 1.0]
    (*state as f32 / 2_147_483_648.0) - 1.0
}
```

Rationale: xorshift produces genuine white noise (flat spectrum), is a single arithmetic operation per sample, and has no allocation. LCG and short LFSR produce colored noise artifacts. Web Crypto (`crypto.getRandomValues`) is not available in AudioWorkletGlobalScope and is async anyway.

**Click synthesis — exponential decay envelope:**

A click is modeled as a sine burst (or filtered impulse) multiplied by a fast exponential decay (`amplitude *= decay_coefficient` per sample). The decay coefficient is derived from the desired half-life in samples. Synthesis is additive; multiple voices sum into the output buffer before the noise is mixed.

---

### Component 2: AudioWorklet Glue Layer (`src/worklet/processor.js`)

**Responsibility:** Bridge between the real-time audio callback and the WASM engine. No scheduling logic lives here.

**Communicates with:** WASM (via linear memory), main thread (via SharedArrayBuffer read + postMessage for init only)

**Why a separate JS file rather than TypeScript:** Bundlers rename and split files. The audio worklet module must be registered at a stable URL. Write this file as a plain `.js` static asset that is not processed by the bundler, or use a bundler plugin (e.g., `vite-plugin-audioworklet`) that handles worklet bundling explicitly. This is a critical pitfall.

**Initialization sequence:**
```
1. Main thread fetches WASM binary: fetch('engine.wasm')
2. Main thread compiles: WebAssembly.compile(buffer) → WebAssembly.Module
3. Main thread constructs AudioWorkletNode, passes module via constructor options
4. Worklet registers module receipt via MessagePort
5. Worklet calls WebAssembly.instantiate(module, imports)
6. Worklet reads get_output_buffer_ptr() → stores as wasmOutputPtr
7. Worklet creates Float32Array view: new Float32Array(memory.buffer, wasmOutputPtr, 128)
8. Worklet posts 'ready' message to main thread
9. Main thread starts lookahead scheduler
```

**The `process()` loop (every 128 samples):**
```javascript
process(inputs, outputs) {
  const beatFlags = readControlRing(this.controlRingBuffer);
  const noiseGain = Atomics.load(this.paramBuffer, NOISE_GAIN_IDX);
  this.exports.fill_output_buffer(beatFlags, noiseGain / 1000); // integer → float
  outputs[0][0].set(this.wasmOutputView);  // mono: copy 128 f32 samples
  return true;
}
```

The `Float32Array` view over WASM linear memory is created once at init and reused every frame. No allocation occurs in the hot path.

---

### Component 3: SharedArrayBuffer Communication Layer

**Responsibility:** Lock-free, allocation-free data transfer from main thread to AudioWorklet.

Two separate SharedArrayBuffer regions:

**A. Control Ring Buffer (beat event queue)**

Use the SPSC wait-free ring-buffer pattern (same as `ringbuf.js`). Main thread is producer, AudioWorklet is consumer.

Ring entries are fixed-size structs: `{ beat_idx: u8, voice_flags: u8, padding: u16 }` — 4 bytes per event. A 256-slot ring (1KB) is more than sufficient for any lookahead window.

Implementation: indices stored in a `Int32Array` backed by a 16-byte header SAB, sample storage in a separate SAB or the same. Use `Atomics.store` / `Atomics.load` on read/write indices. No `Atomics.wait` ever — this is wait-free (the worklet checks and moves on if empty).

**B. Parameter Atomic Buffer (live parameter updates)**

A small `Int32Array` backed by a SharedArrayBuffer for values that must be readable every frame without message overhead:
```
index 0: noise_gain_milliunits  (0–1000, maps to 0.0–1.0)
index 1: is_playing             (0 or 1)
index 2: reserved
...
```

Main thread writes with `Atomics.store`. AudioWorklet reads with `Atomics.load`. No lock needed; these are independent values, not structures.

**Required HTTP headers (COOP/COEP):**
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
Without these, `SharedArrayBuffer` is unavailable and the entire architecture breaks. This is a deployment constraint that must be addressed in Phase 1.

---

### Component 4: Lookahead Scheduler (Main Thread, TypeScript)

**Responsibility:** Convert PatternState + BPM into a stream of timestamped beat events. Push those events into the control ring buffer.

**Why not schedule directly from the AudioWorklet?** The AudioWorklet sees no `setTimeout` or DOM; it cannot calculate future beat times without access to BPM state. The main thread owns all mutable state and must drive scheduling.

**The two-clock pattern:**
- `AudioContext.currentTime`: hardware clock, sub-millisecond precision, unaffected by GC or layout — used for all scheduling timestamps
- `setTimeout(tick, 25)`: JavaScript timer, imprecise (±15ms), used only to trigger the scheduler function periodically

```typescript
const LOOKAHEAD_S = 0.1;    // schedule 100ms into the future
const INTERVAL_MS = 25;     // scheduler fires every 25ms

function tick() {
  while (nextBeatTime < audioCtx.currentTime + LOOKAHEAD_S) {
    writeToControlRing(controlRing, {
      beatIdx: currentBeatPosition,
      voiceFlags: pattern.tracks.map(t => t.beats[currentBeatPosition].active),
      scheduledTime: nextBeatTime
    });
    advanceBeat();
  }
  timerId = setTimeout(tick, INTERVAL_MS);
}
```

Note: The control ring stores `scheduledTime` as a float offset from AudioContext epoch if sub-frame precision is needed. For a metronome, writing the event close enough to the target frame is sufficient — the AudioWorklet triggers synthesis the frame it receives the beat flag, so precise sample-level scheduling within a 2.9ms window is not required.

**Tempo change handling:** Because lookahead is 100ms, a BPM change takes effect within that window. This is standard and acceptable.

---

### Component 5: Pattern State Model (Main Thread, TypeScript)

**Responsibility:** The canonical model of what the metronome plays. Designed for polyrhythm extension from the start.

```typescript
interface BeatPosition {
  soundId: string;           // references SoundLibrary entry
  accent: 'normal' | 'accent' | 'ghost' | 'silent';
}

interface Track {
  id: string;
  stepCount: number;         // beats per cycle (numerator of time sig for track 0)
  subdivision: Subdivision;  // 'quarter' | 'eighth' | 'sixteenth' | 'triplet'
  beats: BeatPosition[];     // length === stepCount
}

interface PatternState {
  bpm: number;
  tracks: Track[];           // v1: one track; polyrhythm: multiple tracks with different stepCounts
}
```

This model is intentionally multi-track from the start. V1 uses one track. Adding polyrhythm means adding a second track with a different `stepCount` — no model refactor. The scheduler iterates all tracks per tick, computing each track's independent next beat time based on its own subdivision interval.

---

### Component 6: Sound Library (Main Thread, TypeScript)

**Responsibility:** Registry of available sounds — both synthesized (WASM-generated) and user-loaded files.

```typescript
type SoundSource =
  | { type: 'synthesized'; voiceIndex: number }   // maps to WASM voice slot
  | { type: 'user-file'; audioBuffer: AudioBuffer }; // decoded by Web Audio API

interface SoundLibrary {
  sounds: Map<string, SoundSource>;
  addUserFile(file: File): Promise<string>;
}
```

User-loaded files are decoded once via `AudioContext.decodeAudioData()` and stored as `AudioBuffer`. When scheduled, the worklet plays them back via an `AudioBufferSourceNode` connected to the same destination — this is separate from the WASM synthesis path. Mixing happens naturally in the Web Audio graph (destination sums all connected sources).

---

## Data Flow

### Startup Flow

```
User opens page
  → TypeScript bootstrap
  → fetch('engine.wasm') → WebAssembly.compile()
  → AudioContext.audioWorklet.addModule('processor.js')
  → new AudioWorkletNode(ctx, 'metronome-processor', { processorOptions: { wasmModule } })
  → Allocate SharedArrayBuffer (control ring + param buffer)
  → postMessage({ controlRing, paramBuffer }) to worklet via node.port
  → Worklet: instantiate WASM, create Float32Array view, post 'ready'
  → Main: enable UI play button
```

### Play Flow (per beat cycle)

```
User clicks Play
  → Scheduler starts (setTimeout loop)
  → Each tick:
       audioCtx.currentTime + 100ms lookahead window
       → for each track in PatternState.tracks:
            → compute nextBeatTime for this track
            → write { beatIdx, voiceFlags } to control ring (SAB)
            → advance beat cursor

  AudioWorklet process() — every 128 samples:
       → read control ring (if event present for this frame)
       → Atomics.load(paramBuffer, NOISE_GAIN_IDX) → noiseGain
       → WASM.fill_output_buffer(beatFlags, noiseGain)
            → Rust: trigger voices, advance envelopes, mix noise, write 128 f32 to static buffer
       → outputs[0][0].set(wasmOutputView)  // copy 128 f32 to Web Audio output
```

### Parameter Change Flow

```
User moves noise slider
  → Atomics.store(paramBuffer, NOISE_GAIN_IDX, newValue)
  (no message, no latency — AudioWorklet reads on next process() call)

User changes BPM
  → PatternState.bpm updated
  → Scheduler recalculates nextBeatTime on its next setTimeout tick
  → No message to worklet needed; beat events arrive at new rate
```

---

## Suggested Build Order

Dependencies between components determine implementation order:

### Phase 1 — Infrastructure (no audio yet)
1. Configure COOP/COEP headers on dev server (SharedArrayBuffer prerequisite)
2. Set up `wasm-pack` build pipeline: `Cargo.toml`, build script, `wasm-pack build --target web`
3. Create minimal WASM module that exports `get_output_buffer_ptr` and `fill_output_buffer` (silence only — empty loop writing 0.0f to output buffer)
4. Create AudioWorklet processor skeleton that loads WASM and runs process() loop
5. Establish SharedArrayBuffer layout (ring + param buffer) and write JS helper functions

**Milestone:** WASM loads in AudioWorklet; process() runs without errors; no sound yet.

### Phase 2 — First Sound
6. Implement click synthesis in Rust (exponential decay envelope, single voice)
7. Wire voice trigger: main thread writes to control ring, worklet reads and passes beat flags to WASM
8. Implement minimal lookahead scheduler (single track, no pattern, just a tick at BPM intervals)

**Milestone:** Audible, drift-free click at a fixed BPM.

### Phase 3 — Pattern Engine
9. Implement PatternState model with multi-track structure
10. Add time signature and subdivision support to scheduler
11. Connect UI controls (BPM, time sig, play/stop) to PatternState and scheduler

**Milestone:** Configurable time signature and BPM with correct beat pattern.

### Phase 4 — Per-Beat Sounds
12. Implement SoundLibrary with synthesized voice variants (accent, ghost)
13. Per-beat sound assignment UI
14. User-loaded file support (AudioBufferSourceNode path)

**Milestone:** Per-beat sound customization working.

### Phase 5 — White Noise
15. Implement xorshift PRNG and noise mixing in Rust WASM
16. Expose noise gain via Atomics param buffer
17. Add noise mix slider to UI

**Milestone:** White noise mixed with clicks, controllable via slider.

### Phase 6 — Polish and Platform Testing
18. Android Chrome testing: apply `latencyHint: 0` workaround, validate timing
19. Safari mobile testing: verify AudioWorklet + SharedArrayBuffer behavior
20. Performance profiling: ensure process() budget stays well under 2.9ms

---

## Patterns to Follow

### Pattern: Static Buffer Pointer Export

Expose audio output from WASM via a raw pointer to a static buffer rather than through wasm-bindgen's higher-level types. wasm-bindgen's string/object marshalling uses `TextEncoder`/`TextDecoder`, which are not available in `AudioWorkletGlobalScope`.

```rust
static mut AUDIO_OUT: [f32; 128] = [0.0; 128];

#[no_mangle]
pub extern "C" fn get_output_buffer_ptr() -> *const f32 {
    unsafe { AUDIO_OUT.as_ptr() }
}
```

JavaScript side:
```javascript
const ptr = instance.exports.get_output_buffer_ptr();
this.outputView = new Float32Array(instance.exports.memory.buffer, ptr, 128);
```

This view is created once. `outputView.buffer` remains valid as long as WASM memory does not grow. Since synthesis uses a fixed static buffer, memory growth is not a concern.

### Pattern: WASM Module Transfer via Constructor Options

Compile the WASM module on the main thread (where fetch is available), then transfer to the worklet via `processorOptions` in the `AudioWorkletNode` constructor. Do not attempt to fetch from inside the worklet.

```typescript
const response = await fetch('/engine.wasm');
const buffer = await response.arrayBuffer();
const wasmModule = await WebAssembly.compile(buffer);

const node = new AudioWorkletNode(audioCtx, 'metronome-processor', {
  processorOptions: { wasmModule }
});
```

### Pattern: Wait-Free SPSC Ring for Beat Events

```typescript
// Main thread (producer)
function writeBeatEvent(ring: BeatRing, event: BeatEvent): boolean {
  const writeIdx = Atomics.load(ring.indices, WRITE_IDX);
  const nextWrite = (writeIdx + 1) & ring.mask;
  if (nextWrite === Atomics.load(ring.indices, READ_IDX)) return false; // full, drop
  ring.events[writeIdx] = packEvent(event);
  Atomics.store(ring.indices, WRITE_IDX, nextWrite);
  return true;
}

// AudioWorklet (consumer) — no wait, no allocation
function readBeatEvent(ring: BeatRing): BeatEvent | null {
  const readIdx = Atomics.load(ring.indices, READ_IDX);
  if (readIdx === Atomics.load(ring.indices, WRITE_IDX)) return null; // empty
  const event = unpackEvent(ring.events[readIdx]);
  Atomics.store(ring.indices, READ_IDX, (readIdx + 1) & ring.mask);
  return event;
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern: postMessage in process()

**What:** Calling `this.port.postMessage()` or `node.port.postMessage()` on every audio frame.

**Why bad:** `postMessage` allocates memory and acquires locks internally. On a real-time audio thread, this causes non-deterministic latency spikes and audible glitches. Confirmed in Chromium issue tracker.

**Instead:** Use `Atomics.store` / `Atomics.load` on SharedArrayBuffer for all per-frame communication. Reserve `postMessage` for one-off init events and UI-bound visualization data.

### Anti-Pattern: Calling wasm-bindgen-generated functions inside AudioWorkletProcessor

**What:** Using `wasm-bindgen`'s high-level JS glue (which internally uses `TextEncoder` / `TextDecoder` and JS object marshalling) inside the worklet.

**Why bad:** `TextEncoder` and `TextDecoder` are not in the AudioWorklet spec and are absent from `AudioWorkletGlobalScope`. The WASM module will fail to initialize with a `ReferenceError`.

**Instead:** Export only primitive-typed functions via `#[no_mangle] pub extern "C" fn`. Use raw pointer exports for buffer access. The wasm-bindgen `.d.ts` types are still useful for the main thread interface; write two compilation targets if needed (one for worklet, one for main thread JS glue).

### Anti-Pattern: Allocating inside process()

**What:** Creating `new Float32Array()`, `new Array()`, spreading arrays, or using any JS construct that triggers the garbage collector inside `process()`.

**Why bad:** GC pauses cause audio glitches. At 44.1kHz, 128 samples = 2.9ms budget. A GC pause of 5–20ms causes audible dropout.

**Instead:** Pre-allocate all buffers at init time. The `wasmOutputView` Float32Array is created once. Ring buffer storage is pre-allocated. Parameters are read from pre-allocated Atomics arrays.

### Anti-Pattern: Single-beat data model

**What:** Storing `beats: number` and `beatSound: SoundId` as flat fields on PatternState rather than as an array of per-beat `BeatPosition` objects.

**Why bad:** Polyrhythm requires multiple independent tracks, each with its own step array. Flat fields make the refactor destructive.

**Instead:** Model `PatternState.tracks: Track[]` with `Track.beats: BeatPosition[]` from the start. V1 just happens to have one track.

---

## Scalability Considerations

This app is fundamentally single-client (browser tab, no server). Scalability concerns are about audio system load, not user scale.

| Concern | V1 (one track) | Polyrhythm (4+ tracks) | Note |
|---------|---------------|----------------------|------|
| WASM synthesis voices | 1-2 active at once | Up to 4 simultaneous | Additive mixing; no per-voice cost jump |
| Beat events per scheduler tick | 1-2 | Up to 8-16 | Ring buffer easily handles this |
| process() budget usage | ~10% of 2.9ms | ~25% of 2.9ms | Confirmed headroom in real-world Rust WASM synths |
| Android latency | Needs `latencyHint: 0` workaround | Same | Not a scale problem; a platform bug |

---

## Sources

- [Chrome Developers: Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern/) — WASM loading patterns, SharedArrayBuffer + Worker design
- [Web.dev: A Tale of Two Clocks](https://web.dev/articles/audio-scheduling) — Lookahead scheduler architecture
- [loke.dev: Stop Allocating Inside AudioWorkletProcessor](https://loke.dev/blog/stop-allocating-inside-audioworkletprocessor) — Ring buffer pattern, allocation anti-pattern
- [blog.paul.cx: Wait-Free SPSC Ring Buffer](https://blog.paul.cx/post/a-wait-free-spsc-ringbuffer-for-the-web/) — SPSC ring buffer design
- [wasm-bindgen Guide: Wasm Audio Worklet](https://rustwasm.github.io/docs/wasm-bindgen/examples/wasm-audio-worklet.html) — Official Rust WASM + AudioWorklet example
- [wasmbyexample.dev: Reading and Writing Audio](https://wasmbyexample.dev/examples/reading-and-writing-audio/reading-and-writing-audio.rust.en-us.html) — Raw pointer export pattern
- [audiodev.blog: Random Numbers for Audio](https://audiodev.blog/random-numbers/) — LCG vs LFSR vs xorshift analysis
- [cwilso/metronome](https://github.com/cwilso/metronome) — Reference lookahead scheduler implementation
- [ringbuf.js](https://github.com/padenot/ringbuf.js/) — SPSC wait-free ring buffer reference implementation
- [Chromium Issue: WebAudio high latency on Android](https://issues.chromium.org/issues/40103372) — Android AudioWorklet quirks
- [GoogleChromeLabs/web-audio-samples Issue #189](https://github.com/GoogleChromeLabs/web-audio-samples/issues/189) — Android Chrome glitching
- [waw-rs: Rust Web Audio Worklets](https://github.com/Marcel-G/waw-rs) — Ergonomic Rust Processor trait pattern
