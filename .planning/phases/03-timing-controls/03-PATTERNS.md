# Phase 3: Timing Controls - Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 7 (4 modified, 3 new)
**Analogs found:** 5 / 7 (2 files have no prior analog in this codebase)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `rust/src/lib.rs` | DSP module | event-driven | `rust/src/lib.rs` (self — extend in place) | exact |
| `src/lib/audio-engine.ts` | service | event-driven | `src/lib/audio-engine.ts` (self — extend in place) | exact |
| `public/worklet/processor.js` | middleware | event-driven | `public/worklet/processor.js` (self — minimal change) | exact |
| `src/App.svelte` | component | request-response | `src/App.svelte` (self — extend in place) | exact |
| `src/lib/pattern.ts` | utility / type module | transform | `src/lib/audio-engine.ts` (TypeScript module export style) | role-match |
| `src/lib/pattern.test.ts` | test | batch | `rust/src/lib.rs` `#[cfg(test)] mod tests` (test structure only) | partial |
| `vitest.config.ts` | config | — | `vite.config.ts` (same `defineConfig` Vite pattern) | role-match |

---

## Pattern Assignments

### `rust/src/lib.rs` (DSP module, event-driven) — modify in place

**Analog:** itself (`/Users/istratovrv/github/metronome/rust/src/lib.rs`)

**Existing static declaration pattern** (lines 6–12):
```rust
static mut AUDIO_OUT: [f32; 128] = [0.0; 128];
static mut SAMPLE_RATE: f32 = 44100.0;
static mut PHASE_ACCUM: f32 = 0.0;
static mut PHASE_INC: f32 = 0.0;
static mut ENVELOPE_GAIN: f32 = 0.0;
static mut DECAY_COEFF: f32 = 0.0;
static mut ACTIVE: bool = false;
```
Phase 3 adds two new statics immediately after this block, following the identical `static mut` declaration form:
```rust
static mut ACCENT_FREQ: f32 = 1400.0;  // D-02: 1400 Hz accent vs 1000 Hz normal
static mut ACCENT_AMP:  f32 = 1.3;     // D-03: default 1.3× multiplier (both toggles on)
```

**Existing `#[no_mangle]` export pattern** (lines 21–26 and 91–101):
```rust
#[no_mangle]
pub extern "C" fn get_output_buffer_ptr() -> *const f32 { ... }

#[no_mangle]
pub extern "C" fn init(sample_rate: f32) { ... }
```
Phase 3 adds a new export in the same form — no `wasm-bindgen`, pure C ABI (D-08 from Phase 1):
```rust
#[no_mangle]
pub extern "C" fn set_accent_params(freq_hz: f32, amp: f32) {
    unsafe {
        std::ptr::addr_of_mut!(ACCENT_FREQ).write(freq_hz);
        std::ptr::addr_of_mut!(ACCENT_AMP).write(amp);
    }
}
```

**Existing unsafe write pattern inside `init()`** (lines 94–100):
```rust
unsafe {
    std::ptr::addr_of_mut!(SAMPLE_RATE).write(sample_rate);
    let phase_inc = CLICK_FREQ / sample_rate;
    std::ptr::addr_of_mut!(PHASE_INC).write(phase_inc);
    let decay_samples = (DECAY_MS / 1000.0) * sample_rate;
    let decay_coeff = (-1.0_f32 / decay_samples).exp();
    std::ptr::addr_of_mut!(DECAY_COEFF).write(decay_coeff);
}
```
All WASM static writes follow `addr_of_mut!(STATIC_NAME).write(value)`. Never `STATIC_NAME = value` (UB on static mut without raw pointer).

**Existing trigger block in `fill_output_buffer()`** (lines 48–52) — the section Phase 3 modifies:
```rust
// Trigger: arm envelope if a beat fires this quantum
if sample_offset != NO_BEAT_SENTINEL {
    std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(1.0_f32);
    std::ptr::addr_of_mut!(PHASE_ACCUM).write(0.0_f32);
    std::ptr::addr_of_mut!(ACTIVE).write(true);
}
```
Phase 3 replaces this block to branch on `voice` (the parameter that was `_voice` — unused in Phase 2):
```rust
if sample_offset != NO_BEAT_SENTINEL {
    unsafe {
        let (freq, base_amp) = if voice == 1 {
            (std::ptr::addr_of!(ACCENT_FREQ).read(),
             std::ptr::addr_of!(ACCENT_AMP).read())
        } else {
            (CLICK_FREQ, 1.0_f32)
        };
        // Always set PHASE_INC on every trigger (Pitfall P3-03: must restore normal freq)
        std::ptr::addr_of_mut!(PHASE_INC).write(freq / std::ptr::addr_of!(SAMPLE_RATE).read());
        std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(base_amp);
        std::ptr::addr_of_mut!(PHASE_ACCUM).write(0.0_f32);
        std::ptr::addr_of_mut!(ACTIVE).write(true);
    }
}
```

**Existing test module pattern** (lines 103–249) — copy structure for new accent tests:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Helper: read AUDIO_OUT[i] via raw pointer
    unsafe fn read_out(i: usize) -> f32 {
        (std::ptr::addr_of!(AUDIO_OUT) as *const f32).add(i).read()
    }

    #[test]
    fn test_name() {
        unsafe {
            init(44100.0);
            // arrange: set statics via addr_of_mut! writes
            // act: call fill_output_buffer(...)
            // assert: read_out(i) or read static via addr_of!
        }
    }
}
```
New tests follow the same `unsafe { init(44100.0); ... }` setup, using `addr_of!` reads and `addr_of_mut!` writes only — never direct static access.

---

### `src/lib/audio-engine.ts` (service, event-driven) — modify in place

**Analog:** itself (`/Users/istratovrv/github/metronome/src/lib/audio-engine.ts`)

**Existing private field declaration pattern** (lines 9–18):
```typescript
private _audioCtx: AudioContext | null = null;
private _workletNode: AudioWorkletNode | null = null;
private _controlRingSAB: SharedArrayBuffer | null = null;
private _paramSAB: SharedArrayBuffer | null = null;
private _state: AudioEngineState = 'stopped';
private _onStateChange: ((state: AudioEngineState) => void) | null;
private _schedulerIntervalId: ReturnType<typeof setInterval> | null = null;
private _nextBeatTime: number = 0;
private _controlRingIndices: Int32Array | null = null;
private _controlRingData: Uint32Array | null = null;
```
Phase 3 adds new fields in the same style immediately after `_controlRingData`:
```typescript
private _paramBuffer: Int32Array | null = null;   // Int32Array view over _paramSAB
private _stepInterval: number = 60.0 / 120;       // seconds per step (recomputed by updatePattern)
private _beats: BeatPosition[] = [{ voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 0 }];
private _stepCount: number = 4;
private _barStep: number = 0;
```

**Existing `_paramSAB` allocation in `start()`** (lines 62–63):
```typescript
this._paramSAB = new SharedArrayBuffer(8 * 4); // 32 bytes
```
After allocation, add `_paramBuffer` view creation in the same block (following the `_controlRingIndices`/`_controlRingData` view creation pattern at lines 66–67):
```typescript
this._controlRingIndices = new Int32Array(this._controlRingSAB, 0, 2);
this._controlRingData = new Uint32Array(this._controlRingSAB, 8, 256);
// Add after:
this._paramBuffer = new Int32Array(this._paramSAB, 0, 8);
```

**Existing `Atomics.store` pattern in `stop()`** (lines 124–126):
```typescript
Atomics.store(this._controlRingIndices, 0, 0); // reset read index
Atomics.store(this._controlRingIndices, 1, 0); // reset write index
```
Phase 3 writes to paramSAB slots 2 and 3 in `updatePattern()` using the same `Atomics.store` pattern — guarded by null check:
```typescript
if (this._paramBuffer) {
    Atomics.store(this._paramBuffer, 2, accentFreqHz);      // slot 2: accent_freq_hz
    Atomics.store(this._paramBuffer, 3, accentAmpMillis);   // slot 3: accent_amp × 1000
}
```

**Existing `_schedulerTick()` inner loop** (lines 142–162) — the core loop Phase 3 modifies:
```typescript
while (this._nextBeatTime < this._audioCtx.currentTime + lookahead) {
    const beatSampleAbs = this._nextBeatTime * sampleRate;
    const quantumIndex  = Math.floor(beatSampleAbs / 128);
    const sampleOffset  = Math.min(Math.round(beatSampleAbs % 128), 127);

    // Pack u32 event — currently voice=0 always
    const event = (sampleOffset & 0x7F) | ((quantumIndex & 0xFFFFF) << 12);

    // Ring write (producer side)
    const writeIdx  = Atomics.load(this._controlRingIndices, 1);
    const nextWrite = (writeIdx + 1) & 0xFF;
    if (nextWrite !== Atomics.load(this._controlRingIndices, 0)) {
        this._controlRingData[writeIdx] = event;
        Atomics.store(this._controlRingIndices, 1, nextWrite);
    }

    this._nextBeatTime += 60.0 / 120; // Phase 2 hardcoded value
}
```
Phase 3 changes to this loop (only the voice encoding and step advance lines change — the ring write block is identical):
```typescript
// Phase 3 replacements inside the while loop:
const stepIndex = this._barStep % this._stepCount;
const voice     = this._beats[stepIndex]?.voice ?? 0;
const event     = (sampleOffset & 0x7F) | ((voice & 0x1F) << 7) | ((quantumIndex & 0xFFFFF) << 12);
// ... ring write block unchanged ...
this._nextBeatTime += this._stepInterval;  // replaces: 60.0 / 120
this._barStep++;                            // new: advance bar position
```

**New public method `updatePattern()`** — add after `stop()` and before `_schedulerTick()`:
```typescript
updatePattern(state: PatternState): void {
    const track = state.tracks[0];
    const multMap: Record<Subdivision, number> = {
        quarter: 1, eighth: 2, triplet: 3, sixteenth: 4,
    };
    const mult = multMap[track.subdivision] ?? 1;
    const newInterval = (60.0 / state.bpm) * (4 / track.denominator) / mult;
    const newStepCount = track.stepCount;

    // Reset bar position when step count changes (Pitfall P3-02: stale barStep OOB)
    if (newStepCount !== this._stepCount) {
        this._barStep = 0;
    }

    this._stepInterval = newInterval;
    this._stepCount    = newStepCount;
    this._beats        = track.beats;

    // Write accent params to paramSAB — guarded for pre-start() calls (Pitfall P3-04)
    if (this._paramBuffer) {
        Atomics.store(this._paramBuffer, 2, state.accentFreqHz);
        Atomics.store(this._paramBuffer, 3, state.accentAmpMillis);
    }
}
```

---

### `public/worklet/processor.js` (middleware, event-driven) — minimal modify

**Analog:** itself (`/Users/istratovrv/github/metronome/public/worklet/processor.js`)

**Existing `set_accent_params` call site** — the worklet must call `set_accent_params` on the WASM exports after WASM is ready. The existing WASM call pattern (line 30) is:
```javascript
this._exports.init(sampleRate);
```
Phase 3 adds a call immediately after `init()` to prime accent defaults:
```javascript
this._exports.init(sampleRate);
// Prime accent params from paramSAB slots 2 and 3 (written by main thread before 'ready')
// Called once at init; re-called via port.onmessage when accent settings change.
if (this._paramBuffer) {
    const freqHz = Atomics.load(this._paramBuffer, 2);
    const ampMillis = Atomics.load(this._paramBuffer, 3);
    if (freqHz > 0) {
        this._exports.set_accent_params(freqHz, ampMillis / 1000.0);
    }
}
```

**Existing `port.onmessage` handler** (lines 44–54) — extend to handle accent-update messages:
```javascript
this.port.onmessage = (event) => {
    if (event.data.type === 'init-buffers') {
        const { controlRing, paramBuffer } = event.data;
        this._ringIndices = new Int32Array(controlRing, 0, 2);
        this._ringData = new Uint32Array(controlRing, 8, 256);
        this._paramBuffer = new Int32Array(paramBuffer, 0, 8);
    }
};
```
Phase 3 may add an `'update-accent'` branch here if the planner chooses the message-based approach (Research Open Question 1, Option A via message):
```javascript
    if (event.data.type === 'update-accent' && this._exports) {
        this._exports.set_accent_params(event.data.freqHz, event.data.amp);
    }
```
Alternatively the planner may use the paramSAB slot-check approach (no message needed). Either approach is valid — see Research Open Question 1.

**Existing `voice` extraction in `process()`** (lines 78, 84–85) — already correct for Phase 3, no change needed:
```javascript
const evVoice = (event >> 7) & 0x1F;   // bits 7–11: voice type
// ...
voice = evVoice;
// ...
this._exports.fill_output_buffer(sampleOffset, voice, 0.0);
```
The worklet already reads `evVoice` from the ring event and passes it to `fill_output_buffer`. Phase 2 always wrote `voice=0` into ring events; Phase 3 writes `voice=1` for beat 0. No worklet change needed for the voice pass-through itself.

---

### `src/App.svelte` (component, request-response) — extend in place

**Analog:** itself (`/Users/istratovrv/github/metronome/src/App.svelte`)

**Existing `$state` declaration pattern** (line 6):
```typescript
let engineState = $state<'stopped' | 'running'>('stopped')
```
Phase 3 adds a second `$state` for `PatternState`, following the same inline generic form:
```typescript
let pattern = $state<PatternState>({
    bpm: 120,
    tracks: [{
        stepCount: 4,
        subdivision: 'quarter' as Subdivision,
        denominator: 4,
        beats: [{ voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 0 }],
    }],
})
```

**Existing `engine` construction and callback pattern** (lines 8–10):
```typescript
const engine = new AudioEngine((state) => {
    engineState = state
})
```
Phase 3 adds a `$effect` for the engine binding, after the `engine` declaration:
```typescript
$effect(() => {
    engine.updatePattern(pattern)
})
```

**Existing button `onclick` handler pattern** (lines 12–19 and 24):
```typescript
async function handlePlayStop() {
    if (engine.state === 'stopped') {
        await engine.start()
    } else {
        await engine.stop()
    }
}
// ...
<button id="play-btn" type="button" onclick={handlePlayStop}>
```
Phase 3 adds helper functions for BPM adjustment in the same synchronous (non-async) function style:
```typescript
function adjustBpm(delta: number) {
    pattern.bpm = Math.max(20, Math.min(300, pattern.bpm + delta))
}

function onBpmInput(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10)
    if (!isNaN(val)) {
        pattern.bpm = Math.max(20, Math.min(300, val))
    }
}
```

**Existing CSS style pattern** (lines 31–63) — single `<style>` block with element and class selectors, `system-ui` font stack, flexbox layout. Phase 3 adds new controls in the same style block using the same conventions (no CSS modules, no Tailwind, no external CSS).

**Import line pattern** (line 2):
```typescript
import { AudioEngine } from './lib/audio-engine.js'
```
Phase 3 adds types from `pattern.ts`:
```typescript
import type { PatternState, Track, BeatPosition, Subdivision } from './lib/pattern.js'
```

---

### `src/lib/pattern.ts` (utility / type module, transform) — new file

**No exact analog in codebase.** Closest structural analog is `src/lib/audio-engine.ts` for TypeScript module conventions (named exports, no default export).

**TypeScript module export convention** from `audio-engine.ts` (line 8):
```typescript
export class AudioEngine { ... }
```
`pattern.ts` uses named type exports and named function exports in the same module style (no `export default`):
```typescript
export type Subdivision = 'quarter' | 'eighth' | 'triplet' | 'sixteenth';

export type BeatPosition = {
    voice: number;
};

export type Track = {
    stepCount: number;
    subdivision: Subdivision;
    denominator: number;
    beats: BeatPosition[];
};

export type PatternState = {
    bpm: number;
    tracks: Track[];
    accentFreqHz: number;       // used by updatePattern() to write paramSAB slot 2
    accentAmpMillis: number;    // used by updatePattern() to write paramSAB slot 3 (amp × 1000)
};

export const SUBDIV_MULT: Record<Subdivision, number> = {
    quarter: 1,
    eighth: 2,
    triplet: 3,
    sixteenth: 4,
};

export function computeStepInterval(bpm: number, denominator: number, subdivMult: number): number {
    return (60.0 / bpm) * (4 / denominator) / subdivMult;
}

export function rebuildBeats(stepCount: number): BeatPosition[] {
    return Array.from({ length: stepCount }, (_, i) => ({ voice: i === 0 ? 1 : 0 }));
}

export function defaultPatternState(): PatternState {
    return {
        bpm: 120,
        tracks: [{
            stepCount: 4,
            subdivision: 'quarter',
            denominator: 4,
            beats: [{ voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 0 }],
        }],
        accentFreqHz: 1400,
        accentAmpMillis: 1300,  // 1.3 × 1000
    };
}
```

---

### `src/lib/pattern.test.ts` (test, batch) — new file

**No TypeScript test file analog exists in the codebase.** The closest structural model is the `#[cfg(test)] mod tests` block in `rust/src/lib.rs` (lines 103–249), which demonstrates: test naming convention (descriptive snake_case sentences), helper setup functions, arrange-act-assert structure.

**Vitest test file conventions** (derived from RESEARCH.md Validation Architecture and CLAUDE.md stack):
```typescript
import { describe, it, expect } from 'vitest'
import {
    computeStepInterval,
    rebuildBeats,
    defaultPatternState,
    SUBDIV_MULT,
} from './pattern.js'

describe('computeStepInterval', () => {
    it('4/4 quarter at 120 BPM = 0.5s', () => {
        expect(computeStepInterval(120, 4, SUBDIV_MULT.quarter)).toBeCloseTo(0.5)
    })
    // ... more cases from D-08 examples in RESEARCH.md
})

describe('rebuildBeats', () => {
    it('returns stepCount elements', () => { ... })
    it('beats[0].voice === 1', () => { ... })
    it('all other voices === 0', () => { ... })
})
```
Test file imports use `.js` extension (matching the existing `audio-engine.js` import in App.svelte line 2 — TypeScript with `"moduleResolution": "bundler"` or `"node16"` requires `.js` even for `.ts` sources).

---

### `vitest.config.ts` (config) — new file

**Closest analog:** `vite.config.ts` (`/Users/istratovrv/github/metronome/vite.config.ts`) — same `defineConfig` import pattern from `vite`:

```typescript
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const COOP_COEP_HEADERS = { ... }

export default defineConfig({
    plugins: [svelte()],
    build: { target: 'es2020' },
    server: { headers: COOP_COEP_HEADERS },
    preview: { headers: COOP_COEP_HEADERS },
})
```

Phase 3 `vitest.config.ts` follows the same `defineConfig` import from `'vitest/config'` (not `'vite'` — Vitest re-exports with test-specific options merged):
```typescript
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
    plugins: [svelte()],
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',   // pattern.ts has no DOM dependency; node env is faster
    },
})
```
The `plugins: [svelte()]` is copied from `vite.config.ts` to maintain Svelte 5 compatibility when Vitest transforms `.svelte` imports transitively. The `build.target: 'es2020'` from `vite.config.ts` is not required in `vitest.config.ts` — Vitest uses esbuild by default.

---

## Shared Patterns

### `static mut` Write Pattern (Rust)
**Source:** `rust/src/lib.rs` lines 93–100
**Apply to:** All new `static mut` statics in `rust/src/lib.rs`
```rust
// ALWAYS use addr_of_mut!().write() — never direct assignment to static mut
std::ptr::addr_of_mut!(STATIC_NAME).write(value);

// ALWAYS use addr_of!().read() for reading — never direct dereference
let val = std::ptr::addr_of!(STATIC_NAME).read();
```

### `Atomics.store` / `Atomics.load` Pattern (TypeScript)
**Source:** `src/lib/audio-engine.ts` lines 124–126, 154–158
**Apply to:** All paramSAB and ring buffer operations in `audio-engine.ts`
```typescript
// Write: always Atomics.store, never direct array assignment for shared indices
Atomics.store(this._controlRingIndices, slotIndex, value);
// Read: always Atomics.load
const idx = Atomics.load(this._controlRingIndices, 0);
```
Exception: `this._controlRingData[writeIdx] = event` is a direct array write (not an index slot) — intentional per D-06 ring protocol.

### Null Guard Before SAB Operations
**Source:** `src/lib/audio-engine.ts` lines 137, 123–126
**Apply to:** `updatePattern()`, `_schedulerTick()`, any new SAB slot write
```typescript
// Guard every SAB typed array access with a null check
if (!this._audioCtx || !this._controlRingIndices || !this._controlRingData) return;
// Similarly for paramBuffer:
if (this._paramBuffer) {
    Atomics.store(this._paramBuffer, 2, value);
}
```

### Zero-Allocation Hot Path (worklet `process()`)
**Source:** `public/worklet/processor.js` lines 59–102
**Apply to:** Any code that runs inside `process()` on the audio thread
```javascript
// NO new, NO object literals, NO array allocation inside process()
// All typed array views created once in constructor or onmessage handler
// Arithmetic uses bitwise ops for integer truncation: (x / 128) | 0
```

### `$state` + `$effect` Reactive Binding (Svelte 5)
**Source:** `src/App.svelte` lines 6–18 (existing pattern, extended for Phase 3)
**Apply to:** `PatternState` binding to `engine.updatePattern()`
```typescript
// $state declares reactive value — Svelte tracks all reads of pattern.* fields
let pattern = $state<PatternState>(defaultPatternState())

// $effect re-runs whenever any pattern.* field read inside the callback changes
$effect(() => {
    engine.updatePattern(pattern)
})
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/lib/pattern.ts` | utility / type module | transform | No pure TypeScript utility module exists yet; codebase has only one TS file (`audio-engine.ts`) which is a class-based service. Type-only modules with pure functions are new to this codebase. |
| `src/lib/pattern.test.ts` | test | batch | No TypeScript test files exist in the project. Vitest is not yet installed. Structure modeled after `rust/src/lib.rs` `#[cfg(test)]` block (closest available test pattern). |

---

## Metadata

**Analog search scope:** `rust/src/`, `src/lib/`, `src/`, `public/worklet/`, project root
**Files scanned:** 7 (all source files in the project — small codebase)
**Pattern extraction date:** 2026-05-20

**Key invariants extracted from existing code:**
- `#[no_mangle] pub extern "C" fn` is the only WASM export form (no `wasm-bindgen` — D-08)
- All WASM static reads/writes go through `std::ptr::addr_of!` / `std::ptr::addr_of_mut!` — never direct static mut access
- All SAB slot reads/writes use `Atomics.load` / `Atomics.store` on the main thread and worklet
- AudioContext creation is deferred to `start()` only — never at import time or constructor (D-12)
- All typed array views (Float32Array, Int32Array, Uint32Array) over SAB are created once, reused forever (D-11)
- Svelte 5 runes (`$state`, `$effect`) — no Svelte 4 stores, no writable(), no reactive declarations
- TypeScript imports use `.js` extension for `.ts` sources (ESM with bundler module resolution)
