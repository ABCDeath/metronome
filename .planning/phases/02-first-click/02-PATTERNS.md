# Phase 2: First Click - Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** 3 (all are edits to existing files; no new files created)
**Analogs found:** 3 / 3 — each file is its own analog (self-referential modifications)

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `rust/src/lib.rs` | DSP engine (WASM module) | streaming (per-quantum sample synthesis) | `rust/src/lib.rs` itself (Phase 1 patterns extended) | self — direct extension |
| `public/worklet/processor.js` | AudioWorklet processor | event-driven (ring buffer SPSC consumer) | `public/worklet/processor.js` itself (Phase 1 skeleton extended) | self — direct extension |
| `src/lib/audio-engine.ts` | audio engine service | event-driven (lookahead scheduler producer) | `src/lib/audio-engine.ts` itself (Phase 1 class extended) | self — direct extension |

All three files already exist. Phase 2 is purely additive edits within established patterns. No new files are introduced.

---

## Pattern Assignments

### `rust/src/lib.rs` (DSP engine, streaming)

**Analog:** `rust/src/lib.rs` (Phase 1 self — extend, do not replace)

**Existing static declaration pattern** (lines 6–7 — copy this style for all new statics):
```rust
static mut AUDIO_OUT: [f32; 128] = [0.0; 128];
static mut SAMPLE_RATE: f32 = 44100.0;
```

**New statics to add** — follow the exact same `static mut` form; place after line 7:
```rust
static mut PHASE_ACCUM: f32 = 0.0;      // triangle wave phase in [0.0, 1.0)
static mut PHASE_INC: f32 = 0.0;        // set in init() = CLICK_FREQ / SAMPLE_RATE
static mut ENVELOPE_GAIN: f32 = 0.0;    // current envelope amplitude
static mut DECAY_COEFF: f32 = 0.0;      // set in init() = exp(-1 / decay_samples)
static mut ACTIVE: bool = false;         // is the click envelope currently running?
```

**New compile-time constants** — add after the statics:
```rust
const CLICK_FREQ: f32 = 1000.0;         // D-01: 1000 Hz warm click
const DECAY_MS: f32 = 12.0;            // D-02: 12ms (midpoint of 10–15ms range)
const SILENCE_THRESHOLD: f32 = 1.0e-4; // stop rendering when envelope falls below this
const NO_BEAT_SENTINEL: u32 = 0xFF;     // sample_offset value meaning "no beat this quantum"
```

**Existing `init()` pattern** (lines 37–42 — extend, do not rewrite):
```rust
#[no_mangle]
pub extern "C" fn init(sample_rate: f32) {
    // SAFETY: Single-threaded WASM; no concurrent mutation possible.
    unsafe {
        std::ptr::addr_of_mut!(SAMPLE_RATE).write(sample_rate);
    }
}
```

**`init()` additions** — add these lines inside the same `unsafe {}` block after the existing `SAMPLE_RATE` write:
```rust
        let phase_inc = CLICK_FREQ / sample_rate;
        std::ptr::addr_of_mut!(PHASE_INC).write(phase_inc);
        let decay_samples = (DECAY_MS / 1000.0) * sample_rate;
        let decay_coeff = (-1.0_f32 / decay_samples).exp();
        std::ptr::addr_of_mut!(DECAY_COEFF).write(decay_coeff);
```

**Raw pointer write pattern** (established in lines 27–30 — use the same idiom everywhere):
```rust
unsafe {
    let ptr = std::ptr::addr_of_mut!(AUDIO_OUT) as *mut f32;
    for i in 0..128_usize {
        ptr.add(i).write(0.0_f32);       // ← ptr.add(i).write(value) for array slots
    }
}
// Reading a static: std::ptr::addr_of!(STATIC_NAME).read()
// Writing a static: std::ptr::addr_of_mut!(STATIC_NAME).write(value)
```

**Updated `fill_output_buffer` signature** (replaces the Phase 1 signature at line 23):
```rust
// OLD (Phase 1, lines 22–32) — replace entirely:
// #[no_mangle]
// pub extern "C" fn fill_output_buffer(_beat_flags: u32, _noise_gain: f32) { ... }

// NEW (Phase 2):
#[no_mangle]
pub extern "C" fn fill_output_buffer(sample_offset: u32, _voice: u32, _noise_gain: f32) {
    unsafe {
        let ptr = std::ptr::addr_of_mut!(AUDIO_OUT) as *mut f32;

        // Trigger: arm envelope if a beat fires this quantum.
        if sample_offset != NO_BEAT_SENTINEL {
            std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(1.0_f32);
            std::ptr::addr_of_mut!(PHASE_ACCUM).write(0.0_f32);
            std::ptr::addr_of_mut!(ACTIVE).write(true);
        }

        for i in 0..128_usize {
            let sample = if std::ptr::addr_of!(ACTIVE).read()
                && (sample_offset == NO_BEAT_SENTINEL || i >= sample_offset as usize)
            {
                let phase = std::ptr::addr_of!(PHASE_ACCUM).read();
                let gain  = std::ptr::addr_of!(ENVELOPE_GAIN).read();

                // Triangle wave: phase in [0.0, 1.0) → [-1.0, 1.0]
                let s = (phase - 0.5).abs() * 4.0 - 1.0;
                let output = s * gain;

                // Advance phase — use subtraction, not %, to avoid float division (RESEARCH.md anti-pattern)
                let mut new_phase = phase + std::ptr::addr_of!(PHASE_INC).read();
                if new_phase >= 1.0 { new_phase -= 1.0; }
                std::ptr::addr_of_mut!(PHASE_ACCUM).write(new_phase);

                // Advance envelope — multiplicative decay persists across quanta (RESEARCH.md Pitfall 1)
                let new_gain = gain * std::ptr::addr_of!(DECAY_COEFF).read();
                std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(new_gain);
                if new_gain < SILENCE_THRESHOLD {
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

**Rust unit test pattern** — add a `#[cfg(test)]` module at the bottom of the file. No existing tests to copy from; use the standard Rust form:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triangle_wave_range() { ... }

    #[test]
    fn envelope_decays_to_silence() { ... }

    #[test]
    fn sentinel_produces_silence_when_inactive() { ... }
}
```
Full test bodies are specified in `02-RESEARCH.md` §Rust Unit Test Design (lines 665–716).

---

### `public/worklet/processor.js` (AudioWorklet processor, event-driven SPSC consumer)

**Analog:** `public/worklet/processor.js` (Phase 1 self — extend `process()` and `fill_output_buffer` call site)

**Existing typed array view creation pattern** (lines 49–51 — follow for any new views):
```javascript
// Created ONCE in the 'init-buffers' message handler, reused every process() call (D-11)
this._ringIndices = new Int32Array(controlRing, 0, 2);
this._ringData = new Uint32Array(controlRing, 8, 256);
this._paramBuffer = new Int32Array(paramBuffer, 0, 8);
```

**Existing `process()` guard pattern** (lines 61–63 — keep exactly as is):
```javascript
process(_inputs, outputs) {
    if (!this._ready) {
      return true;
    }
    // ... logic ...
}
```

**Existing WASM call + output copy pattern** (lines 67–71 — the call site that changes):
```javascript
// Phase 1 (lines 67–71) — replace the fill_output_buffer call:
this._exports.fill_output_buffer(0, 0.0);          // ← OLD: 2 args
outputs[0][0].set(this._outputView);               // ← KEEP: unchanged

// Phase 2 — insert ring-read logic BEFORE the fill_output_buffer call;
// update the call to 3 args:
this._exports.fill_output_buffer(sampleOffset, voice, 0.0);   // 3 args (D-05)
outputs[0][0].set(this._outputView);               // unchanged
```

**Ring buffer read pattern** (zero allocation — insert between line 63 and the existing `fill_output_buffer` call):
```javascript
// Read ring indices — Atomics.load, no allocation (D-06)
const readIdx  = Atomics.load(this._ringIndices, 0);  // slot 0 = read index
const writeIdx = Atomics.load(this._ringIndices, 1);  // slot 1 = write index

let sampleOffset = 0xFF; // NO_BEAT_SENTINEL — default: no beat this quantum
let voice = 0;

if (readIdx !== writeIdx) {
    const event = this._ringData[readIdx];           // Uint32Array read — no allocation
    const evOffset  =  event & 0x7F;                // bits 0–6: sample offset (0–127)
    const evVoice   = (event >> 7) & 0x1F;          // bits 7–11: voice type
    const evQuantum = (event >> 12) | 0;            // bits 12–31: quantum index
    const myQuantum = (currentFrame / 128) | 0;     // (x | 0) = integer truncation, no alloc

    if (evQuantum === myQuantum) {
        // Event fires in the current quantum — consume it
        sampleOffset = evOffset;
        voice = evVoice;
        Atomics.store(this._ringIndices, 0, (readIdx + 1) & 0xFF);  // advance read index
    }
    // evQuantum > myQuantum: leave in ring for a future quantum (do nothing)
    // evQuantum < myQuantum: stale event — must also consume to drain (add else branch if needed)
}
```

**No-allocation discipline** (established in Phase 1 comment at line 59 — enforce throughout):
```javascript
// ZERO allocations: no new, no object literals, no string operations (D-11, T-01-03)
// (currentFrame / 128) | 0  — integer truncation without Math.floor (no alloc)
// Atomics.load / Atomics.store — no alloc
// Uint32Array index access — no alloc
```

---

### `src/lib/audio-engine.ts` (audio engine service, event-driven SPSC producer)

**Analog:** `src/lib/audio-engine.ts` (Phase 1 self — add private fields and `_schedulerTick()` method; extend `start()`/`stop()`)

**Existing private field declaration pattern** (lines 9–14 — follow this style for new fields):
```typescript
private _audioCtx: AudioContext | null = null;
private _workletNode: AudioWorkletNode | null = null;
private _controlRingSAB: SharedArrayBuffer | null = null;
private _paramSAB: SharedArrayBuffer | null = null;
private _state: AudioEngineState = 'stopped';
private _onStateChange: ((state: AudioEngineState) => void) | null;
```

**New private fields to add** — after line 14, before the constructor:
```typescript
private _schedulerIntervalId: ReturnType<typeof setInterval> | null = null;
private _nextBeatTime: number = 0;
private _controlRingIndices: Int32Array | null = null;
private _controlRingData: Uint32Array | null = null;
```

**Existing SAB allocation pattern** (lines 56–58 — follow for creating typed array views):
```typescript
this._controlRingSAB = new SharedArrayBuffer(4 + 4 + 256 * 4); // 1032 bytes
this._paramSAB = new SharedArrayBuffer(8 * 4);                  // 32 bytes
```

**Typed array view creation** — add immediately after the SAB allocation lines (after line 58), before the `AudioWorkletNode` constructor:
```typescript
// Create typed array views for the scheduler's ring writes (producer side).
// Matches the layout the worklet creates: indices at bytes 0-7, data at bytes 8-1031.
this._controlRingIndices = new Int32Array(this._controlRingSAB, 0, 2);
this._controlRingData = new Uint32Array(this._controlRingSAB, 8, 256);
```

**Scheduler start in `start()`** — add at the bottom of `start()`, after the existing `this._state = 'running'` line (line 95), immediately before `this._onStateChange?.(...)`:
```typescript
// Seed nextBeatTime to now — prevents flooding the ring with stale events (RESEARCH.md Pitfall 2)
this._nextBeatTime = this._audioCtx!.currentTime;
this._schedulerIntervalId = setInterval(() => this._schedulerTick(), 25);
```

**Scheduler stop in `stop()`** — add at the beginning of `stop()`, before the existing `this._audioCtx.suspend()` call (before line 106):
```typescript
// Cancel scheduler before suspending context (D-07 scheduler cleanup)
if (this._schedulerIntervalId !== null) {
    clearInterval(this._schedulerIntervalId);
    this._schedulerIntervalId = null;
}
// Clear the ring buffer to prevent stale events on next start() (RESEARCH.md Pitfall 4)
if (this._controlRingIndices) {
    Atomics.store(this._controlRingIndices, 0, 0); // reset read index
    Atomics.store(this._controlRingIndices, 1, 0); // reset write index
}
```

**Existing async method style** (lines 25–97 — follow for `_schedulerTick()`):
```typescript
// Phase 1 pattern: private methods use underscore prefix, no return annotation for void,
// TypeScript strict null checks via `if (!this._audioCtx)` guard.
async start(): Promise<void> { ... }
async stop(): Promise<void> { ... }
```

**New `_schedulerTick()` method** — add as a new private method after `stop()` (after line 111):
```typescript
private _schedulerTick(): void {
    if (!this._audioCtx || !this._controlRingIndices || !this._controlRingData) return;

    const sampleRate = this._audioCtx.sampleRate;
    const lookahead = 0.1; // 100ms lookahead window (D-07)

    while (this._nextBeatTime < this._audioCtx.currentTime + lookahead) {
        const beatSampleAbs = this._nextBeatTime * sampleRate;
        const quantumIndex  = Math.floor(beatSampleAbs / 128);
        const sampleOffset  = Math.min(Math.round(beatSampleAbs % 128), 127); // clamp to 0–127

        // Pack u32 event (D-04):
        //   bits  0–6:  sampleOffset (0–127)
        //   bits  7–11: voice = 0 (normal; accent reserved for Phase 3)
        //   bits 12–31: quantumIndex (Strategy A — robust for Phase 3+ extensions)
        const event = (sampleOffset & 0x7F) | (quantumIndex << 12);

        // Write to SPSC ring — producer side (D-06: Atomics.store on write index)
        const writeIdx  = Atomics.load(this._controlRingIndices, 1);
        const nextWrite = (writeIdx + 1) & 0xFF; // 256-slot ring mask
        if (nextWrite !== Atomics.load(this._controlRingIndices, 0)) { // not full
            this._controlRingData[writeIdx] = event;
            Atomics.store(this._controlRingIndices, 1, nextWrite);
        }

        this._nextBeatTime += 60.0 / 120; // fixed 120 BPM for Phase 2 (Phase 3 replaces constant)
    }
}
```

---

## Shared Patterns

### `#[no_mangle] pub extern "C" fn` — C ABI export convention
**Source:** `rust/src/lib.rs` lines 11–12, 22–23, 36–37
**Apply to:** Every new or modified Rust function that is called from JS
```rust
#[no_mangle]
pub extern "C" fn function_name(param: Type) -> ReturnType { ... }
```
Do NOT use `#[wasm_bindgen]` — the project uses raw C ABI exports only (D-08).

### `std::ptr::addr_of_mut!` / `std::ptr::addr_of!` — safe static access pattern
**Source:** `rust/src/lib.rs` lines 15, 27–30, 40
**Apply to:** Every read or write of a `static mut` variable in Rust
```rust
// Write:   std::ptr::addr_of_mut!(STATIC).write(value);
// Read:    std::ptr::addr_of!(STATIC).read()
// Array write via raw pointer:
let ptr = std::ptr::addr_of_mut!(AUDIO_OUT) as *mut f32;
ptr.add(i).write(value);
```
Never create a `&mut` reference to a `static mut` — UB in Rust.

### Zero-allocation discipline in `process()`
**Source:** `public/worklet/processor.js` line 59 comment; Phase 1 D-11
**Apply to:** Everything inside `MetronomeProcessor.process()`
```javascript
// Forbidden inside process():
//   new TypedArray(...)     — allocates
//   {}  []                  — allocates
//   Math.floor(x)           — does NOT allocate (safe, but (x | 0) is marginally faster)
//   String operations       — allocates

// Permitted:
//   Atomics.load / Atomics.store
//   (x / 128) | 0           — integer truncation
//   existingTypedArray[i]   — index reads
//   existingTypedArray.set() — bulk copy
```

### `Atomics.load` / `Atomics.store` SPSC protocol
**Source:** `public/worklet/processor.js` lines 49–51 (view creation); Phase 1 ring buffer layout
**Apply to:** All ring buffer reads (worklet) and writes (AudioEngine scheduler)
```
Ring layout (controlRingSAB = 1032 bytes):
  bytes 0-3:    read index  → Int32Array slot 0
  bytes 4-7:    write index → Int32Array slot 1
  bytes 8-1031: 256 × Uint32 event slots → Uint32Array(controlRing, 8, 256)

Producer (main thread): Atomics.load(indices, 1) to read write idx; Atomics.store(indices, 1, next)
Consumer (worklet):     Atomics.load(indices, 0) to read read idx; Atomics.store(indices, 0, next)
Ring-full check:  (writeIdx + 1) & 0xFF !== readIdx
Ring-empty check: readIdx === writeIdx
```

### TypeScript private field + null-initialized pattern
**Source:** `src/lib/audio-engine.ts` lines 9–14
**Apply to:** All new private fields in `AudioEngine`
```typescript
private _fieldName: Type | null = null;
// Guard before use:
if (!this._fieldName) return;
// Or non-null assertion when caller guarantees initialization:
this._fieldName!.method();
```

### AudioContext created only on user gesture
**Source:** `src/lib/audio-engine.ts` lines 1–3 comment, lines 32–33
**Apply to:** Any code path that might touch AudioContext
```typescript
// NEVER create AudioContext at module import time (D-12).
// ALWAYS create inside start() which is called from a click handler.
if (!this._audioCtx) {
    this._audioCtx = new AudioContext({ latencyHint: 'interactive' });
}
```

---

## No Analog Found

All three modified files exist in the codebase and serve as their own analogs. No file in this phase is net-new without a structural template.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All Phase 2 work is additive edits to existing Phase 1 files |

---

## Key Constraints Summary for Executor

These are the hard constraints extracted from existing code and decisions that the executor MUST NOT violate:

1. **No wasm-bindgen** — `rust/src/lib.rs` comment line 4: "wasm-bindgen crate is NOT a dependency — pure C ABI exports, no JS glue needed."
2. **No allocations in `process()`** — `processor.js` line 59: "ZERO allocations: no new, no object literals, no string operations (D-11, T-01-03)."
3. **No AudioContext at import time** — `audio-engine.ts` line 3: "D-12: AudioContext created ONLY on Play button click."
4. **Views created once** — `processor.js` lines 36–37, 49–51: Float32Array and ring typed array views are created in the constructor, not in `process()`.
5. **`#[no_mangle] pub extern "C" fn` only** — `lib.rs` line 4, D-08: no wasm-bindgen exports in the hot path.
6. **Phase wrap via subtraction** — RESEARCH.md anti-pattern section: use `if PHASE_ACCUM >= 1.0 { PHASE_ACCUM -= 1.0; }` not `%`.
7. **`nextBeatTime` seeded to `currentTime` on start** — RESEARCH.md Pitfall 2: seed to `audioCtx.currentTime`, not `0.0`.
8. **Ring cleared on stop** — RESEARCH.md Pitfall 4: reset both read and write indices to 0 via `Atomics.store` before suspend.

---

## Metadata

**Analog search scope:** Full project (`rust/src/`, `public/worklet/`, `src/lib/`, `src/`)
**Files read:** `rust/src/lib.rs`, `public/worklet/processor.js`, `src/lib/audio-engine.ts`, `src/App.svelte`, `.planning/phases/02-first-click/02-CONTEXT.md`, `.planning/phases/02-first-click/02-RESEARCH.md`
**Files scanned:** 4 source files (all relevant files in this early-stage codebase)
**Pattern extraction date:** 2026-05-19
