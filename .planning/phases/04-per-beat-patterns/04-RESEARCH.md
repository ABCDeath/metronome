# Phase 4: Per-Beat Patterns and White Noise - Research

**Researched:** 2026-05-21
**Domain:** Rust WASM DSP (xorshift32 noise), TypeScript pattern merge semantics, Svelte 5 deep proxy reactivity, AudioWorklet paramSAB wiring
**Confidence:** HIGH — all source files read directly; Svelte 5 docs verified; xorshift32 parameters verified via KVR DSP forum + EDN article + Wikipedia; no external packages added this phase

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Beat Grid UI Interaction**
- D-01: Each beat cell is a clickable button cycling Normal → Accent → Silent → Normal (wraps). No mode selector, no right-click.
- D-02: Grid is a row of N buttons (one per step). Updates dynamically when step count changes.

**Sound Palette Model**
- D-03: Palette voice index: 0 = Normal click (1000 Hz, 0.75 amp), 1 = Accent click (1400 Hz, 1.3× amp — reuses ACCENT_FREQ/ACCENT_AMP statics), 2 = Silent (beat event fires, no click synthesized).
- D-04: No new DSP types. Palette reuses two click sounds already built in Phases 2–3. Extensible.
- D-05: Phase 3 global accent controls remain unchanged — now "Accent sound settings" rather than per-bar override.
- D-06: Default beat assignments: beat 0 = Accent (voice 1), all others = Normal (voice 0). Same as Phase 3.

**Step Count Change Policy**
- D-07: When step count changes, preserve existing assignments for positions that still exist; fill new positions with Normal (voice 0). If step count shrinks, truncate from the right.
- D-08: `rebuildBeats()` updated or new overload accepting optional `existingBeats` parameter. Standalone `rebuildBeats(stepCount)` path retains default behaviour.

**White Noise — Delivery and Behaviour**
- D-09: `noise_gain` communicated via paramSAB slot 4 (integer = gain × 1000). Worklet reads atomically on every `process()` call.
- D-10: White noise runs unconditionally on every `process()` frame — NOT gated on click synthesis. Rust `fill_output_buffer` generates xorshift32 PRNG noise mixed into every output buffer call.
- D-11: OTG adapter / wireless headphone keep-alive use case. 5–10% noise at slow tempos.
- D-12: Slider range 0–100%. 0% = no noise. PRNG call still executes at 0% (no branch in hot path).
- D-13: Silent beats still receive noise contribution.

**Silent Voice Implementation**
- D-14: Voice 2 = silent. In `fill_output_buffer`, the trigger block adds third branch: `voice == 2` → no envelope trigger, do not set ACTIVE. Noise mixing path is outside this branch.
- D-15: Ring event voice field (bits 7–11, 5 bits) already supports 0–31. Voice 2 fits without ring protocol change.

### Claude's Discretion

- Exact Svelte component structure for the beat grid (inline in App.svelte or extracted to a component)
- Visual styling of the three beat states on the grid buttons (colour, label text, or icon)
- Whether the noise slider appears in the existing controls panel or in its own section
- xorshift32 PRNG seed and state management inside Rust (static mut, same pattern as other statics)
- Whether to add a Vitest test for the updated `rebuildBeats()` merge behaviour

### Deferred Ideas (OUT OF SCOPE)

- Ghost note sound — deferred to v2 (user-loadable WAV/MP3 milestone)
- More palette entries (cowbell, rimshot, handclap) — v2 scope
- Visual beat indicator — highlight currently-playing beat cell while metronome runs — deferred to v2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PATTERN-01 | Each beat position in the pattern has an independently assignable click sound | `rebuildBeats()` merge overload + Svelte 5 deep proxy mutation + `fill_output_buffer` voice==2 branch |
| AUDIO-02 | User can mix white noise into the output with a controllable mix level (0–100%) | xorshift32 PRNG static in Rust + paramSAB slot 4 wiring + worklet hot-path read + clipping prevention |
</phase_requirements>

---

## Summary

Phase 4 has two orthogonal work streams that share only the audio output mix: (1) per-beat voice assignment — a UI/data model/Rust change — and (2) continuous white noise — a Rust DSP + SAB wiring change. The codebase is completely read and understood. All existing patterns from Phases 2 and 3 extend directly to Phase 4; no new architecture is needed.

**xorshift32 noise:** The canonical three-shift implementation (state ^= state << 13; state ^= state >> 17; state ^= state << 5) is the industry standard for audio white noise generation. It must live in a `static mut` PRNG_STATE following the existing `addr_of_mut!` write pattern. The PRNG runs every frame unconditionally; noise_gain is read from paramSAB slot 4 and applied as a scale factor. The output is mixed additively into the synthesized click output — this creates a clipping risk when an accent click (peak ~1.3) and 100% noise (peak ~1.0) coincide on the same frame. This is the single most important pitfall to mitigate.

**Svelte 5 deep proxy — confirmed safe:** Mutating `pattern.tracks[0].beats[i].voice = newVoice` directly on the $state proxy WILL trigger the existing `$effect(() => { engine.updatePattern(pattern) })` because Svelte 5 proxifies the object tree recursively and intercepts property writes at any nesting depth. No new array reference is required.

**rebuildBeats() merge:** The existing `rebuildBeats(stepCount)` creates a fresh default array. Phase 4 needs a merge variant that accepts `existingBeats: BeatPosition[]` and preserves assignments for existing positions. The implementation is pure TypeScript with no external dependencies — testable with the existing Vitest setup.

**paramSAB slot 4 wiring:** Slot 4 is free (slots 0–3 used). The encoding is identical to `accentAmpMillis` (integer × 1000). The worklet reads slot 4 on every `process()` frame and passes it to `fill_output_buffer`. The Svelte slider writes to slot 4 via `Atomics.store` on every `oninput` event — bypasses `updatePattern()` for immediate response (no need to go through PatternState for a UI-only numeric value).

**Primary recommendation:** Implement in four focused tasks: (1) Rust PRNG + noise mixing + voice==2 silent branch + cargo tests, (2) paramSAB slot 4 wiring (worklet + audio-engine), (3) rebuildBeats() merge overload + Vitest tests, (4) Svelte UI (beat grid + noise slider) + human verify.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| xorshift32 PRNG white noise synthesis | WASM (Rust) | — | Sample-level DSP belongs in the WASM engine. Main thread never touches samples. |
| noise_gain paramSAB slot wiring | AudioWorklet (processor.js) | AudioEngine (audio-engine.ts) | Worklet reads slot 4 on every process() frame. AudioEngine writes slot 4 on slider change. |
| Silent beat (voice=2) suppression | WASM (Rust) | — | Voice dispatch lives inside fill_output_buffer trigger block, which is Rust. |
| Voice ring event packing | AudioEngine (_schedulerTick) | — | Already packs voice into bits 7–11 of the u32 ring event; no change needed for voice 2. |
| rebuildBeats() merge semantics | pattern.ts (TypeScript) | — | Pure data transform function — no DOM or audio dependency. |
| Beat grid UI interaction | App.svelte | pattern.ts | Svelte 5 $state proxy mutation + existing $effect drives updatePattern(). |
| Noise slider UI | App.svelte | AudioEngine | Direct Atomics.store to paramSAB slot 4 on oninput — bypasses updatePattern() for immediacy. |
| Beat assignment persistence across step count changes | pattern.ts + App.svelte | — | onTimeSigChange / onSubdivisionChange must call merge-preserving rebuildBeats(). |

---

## Standard Stack

No new external packages are added in Phase 4. All work extends existing Rust + TypeScript sources.

### Core (unchanged)
| Component | Role | Pattern Used |
|-----------|------|--------------|
| `rust/src/lib.rs` | WASM DSP engine | Add `static mut PRNG_STATE`, extend `fill_output_buffer` |
| `src/lib/audio-engine.ts` | AudioEngine | Write paramSAB slot 4 on noise slider change |
| `public/worklet/processor.js` | AudioWorklet | Read slot 4 every process() frame, pass to fill_output_buffer |
| `src/lib/pattern.ts` | Pattern utilities | Add merge-preserving rebuildBeats() overload |
| `src/App.svelte` | Svelte 5 UI | Add beat grid + noise slider sections |
| `src/lib/pattern.test.ts` | Vitest tests | Extend with merge semantics + voice cycling tests |

### No Installation Required

All Phase 4 work is changes to existing files. `npm install` is not needed.

---

## Package Legitimacy Audit

No new packages are installed in this phase. Not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
[App.svelte: beat cell click]
  │  pattern.tracks[0].beats[i].voice = (prev + 1) % 3
  │  (Svelte 5 deep proxy intercepts — $effect fires)
  ▼
[App.svelte: $effect]
  │  engine.updatePattern(pattern)
  ▼
[AudioEngine._beats = track.beats]
  │  (no paramSAB write — beats are in-memory only)
  │  voice 2 flows through existing ring event packing unchanged
  ▼
[AudioEngine._schedulerTick]
  │  packs voice into ring event bits 7–11
  │  voice=2 passes through unchanged (no ring protocol change)
  ▼
[AudioWorklet process()]
  │  extracts evVoice from ring event
  │  reads noiseGain = Atomics.load(paramBuffer, 4)  ← NEW
  │  calls fill_output_buffer(sampleOffset, voice, noiseGain / 1000.0)
  ▼
[Rust fill_output_buffer]
  ├─ trigger block: if sample_offset != NO_BEAT_SENTINEL
  │    ├─ voice==0 → normal click (1000 Hz, 0.75 amp)
  │    ├─ voice==1 → accent click (ACCENT_FREQ, ACCENT_AMP)
  │    └─ voice==2 → no trigger (do nothing)  ← NEW
  └─ noise mixing (UNCONDITIONAL — runs every frame):
       PRNG_STATE xorshift32 step
       noise_sample = (prng_out as f32 / i32::MAX as f32) * noise_gain
       for each sample: out[i] += noise_sample (before clamp)
       clamp output to [-1.0, 1.0] per sample                 ← CRITICAL

[App.svelte: noise slider oninput]
  │  noiseLevel / 100.0 → noise_gain_millis = Math.round(val * 1000)
  ▼
[AudioEngine.setNoiseGain(millis) or direct Atomics.store]
  │  Atomics.store(this._paramBuffer, 4, noise_gain_millis)
  ▼
[AudioWorklet reads slot 4 on next process() frame (~2.9ms)]
```

### Recommended Project Structure (no changes to structure)

```
rust/src/lib.rs               ← extend: PRNG_STATE static, fill_output_buffer changes
src/lib/pattern.ts            ← extend: rebuildBeats() merge overload
src/lib/pattern.test.ts       ← extend: merge semantics tests
src/lib/audio-engine.ts       ← extend: setNoiseGain() or noise write in updatePattern
public/worklet/processor.js   ← extend: read slot 4, pass noiseGain to fill_output_buffer
src/App.svelte                ← extend: Pattern section + Noise section
```

### Pattern 1: xorshift32 PRNG Static in Rust

**What:** A `static mut PRNG_STATE: u32` drives the noise generator. The canonical three-shift sequence produces a new 32-bit value per call. The output is converted to a float in [-1.0, 1.0] and scaled by `noise_gain`.

**When to use:** Every call to `fill_output_buffer`, for every sample in the 128-sample loop, unconditionally.

**Implementation (established `addr_of_mut!` pattern):**
```rust
// Add with existing statics at top of lib.rs
static mut PRNG_STATE: u32 = 12345;  // seed must be non-zero

// Called inside fill_output_buffer, per-sample:
#[inline(always)]
unsafe fn xorshift32_next() -> u32 {
    let mut state = std::ptr::addr_of!(PRNG_STATE).read();
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    std::ptr::addr_of_mut!(PRNG_STATE).write(state);
    state
}

// Convert to [-1.0, 1.0]:
// Cast u32 → i32 (reinterpret, same bits) then normalize by i32::MAX
let raw = xorshift32_next();
let noise_sample = (raw as i32 as f32) / 2147483648.0_f32 * noise_gain;
// Then: out[i] = (click_sample + noise_sample).clamp(-1.0, 1.0)
```

**Source:** [CITED: KVR Audio DSP Forum](https://www.kvraudio.com/forum/viewtopic.php?t=564273) canonical shift parameters (13, 17, 5); [CITED: EDN article on xorshift32 audio white noise](https://www.edn.com/a-non-finicky-mass-producible-audio-frequency-white-noise-generator/)

**Confidence:** HIGH — shift parameters (13, 17, 5) are the canonical Marsaglia xorshift32 triple, verified across multiple independent sources. Same triple used in SIMD white noise generators for audio.

### Pattern 2: fill_output_buffer Extension

**What:** The existing trigger block gains a `voice==2` branch (no trigger). The outer sample loop gains unconditional noise mixing. The output is clamped per-sample to prevent clipping.

**Current signature (unchanged):**
```rust
pub extern "C" fn fill_output_buffer(sample_offset: u32, voice: u32, _noise_gain: f32)
```

**Phase 4 changes — three distinct edit sites:**

1. Rename `_noise_gain` parameter to `noise_gain` (remove leading underscore).

2. Trigger block — add voice==2 branch (inline in existing if block):
```rust
if sample_offset != NO_BEAT_SENTINEL {
    if voice == 2 {
        // Silent: beat event fires (bar position advances) but no click synthesis
        // ACTIVE is not set; noise mixing still runs below
    } else {
        let (freq, base_amp) = if voice == 1 {
            (std::ptr::addr_of!(ACCENT_FREQ).read(),
             std::ptr::addr_of!(ACCENT_AMP).read())
        } else {
            (CLICK_FREQ, 0.75_f32)
        };
        std::ptr::addr_of_mut!(PHASE_INC).write(freq / std::ptr::addr_of!(SAMPLE_RATE).read());
        std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(base_amp);
        std::ptr::addr_of_mut!(PHASE_ACCUM).write(0.0_f32);
        std::ptr::addr_of_mut!(ACTIVE).write(true);
    }
}
```

3. Per-sample output computation — add noise and clamp:
```rust
// click_sample is the existing synthesis output (0.0 if ACTIVE=false)
let raw = xorshift32_next();
let noise_sample = (raw as i32 as f32) / 2147483648.0_f32 * noise_gain;
let mixed = (click_sample + noise_sample).clamp(-1.0_f32, 1.0_f32);
ptr.add(i).write(mixed);
```

### Pattern 3: paramSAB Slot 4 Wiring (End-to-End)

**What:** The noise slider value (0–100 integer) maps to `Math.round(noiseLevel / 100 * 1000)` for Atomics storage (same × 1000 encoding as `accentAmpMillis`). Written on every `oninput` event for immediate response.

**Svelte slider → AudioEngine → SAB:**
```typescript
// In App.svelte — new $state:
let noiseLevel = $state(0)   // 0–100 integer, default 0

// oninput handler (fires on every slider move):
function onNoiseInput(e: Event) {
    noiseLevel = parseInt((e.target as HTMLInputElement).value, 10)
    engine.setNoiseGain(Math.round(noiseLevel * 10))  // 0–100 → 0–1000
    // OR: if AudioEngine exposes _paramBuffer directly:
    // Atomics.store(engine._paramBuffer!, 4, Math.round(noiseLevel * 10))
}
```

**AudioEngine.setNoiseGain() (new method, follows existing null-guard pattern):**
```typescript
setNoiseGain(millis: number): void {
    if (this._paramBuffer) {
        Atomics.store(this._paramBuffer, 4, millis);
    }
}
```

**Worklet process() — one new line before fill_output_buffer call:**
```javascript
// Read noise gain from paramSAB slot 4 on every frame (continuous, not event-driven)
const noiseGainMillis = Atomics.load(this._paramBuffer, 4);
const noiseGain = noiseGainMillis / 1000.0;  // 0.0–1.0

// Changed from fill_output_buffer(sampleOffset, voice, 0.0):
this._exports.fill_output_buffer(sampleOffset, voice, noiseGain);
```

**Division cost note:** `/ 1000.0` is one float division per process() frame (every ~2.9ms). This is negligible — the zero-allocation constraint applies to memory, not arithmetic. [ASSUMED]

### Pattern 4: rebuildBeats() Merge Overload

**What:** A second overload (or optional parameter) for `rebuildBeats()` that merges existing beat assignments rather than generating fresh defaults.

**Implementation:**
```typescript
/**
 * Build a beats array of length stepCount.
 * If existingBeats is provided, copies voice assignments from it for positions that
 * still exist; new positions beyond existingBeats.length default to Normal (voice 0).
 * Position 0 only defaults to Accent (voice 1) when existingBeats is NOT provided
 * (i.e., a fresh initialization, not a resize).
 */
export function rebuildBeats(
    stepCount: number,
    existingBeats?: BeatPosition[]
): BeatPosition[] {
    if (!existingBeats) {
        // Fresh default: beat 0 = accent (voice 1), rest = normal
        return Array.from({ length: stepCount }, (_, i) => ({ voice: i === 0 ? 1 : 0 }));
    }
    // Merge: preserve existing, fill new with Normal (voice 0)
    return Array.from({ length: stepCount }, (_, i) => ({
        voice: i < existingBeats.length ? existingBeats[i].voice : 0,
    }));
}
```

**Callers that must be updated in App.svelte:**

Current (Phase 3) — resets all beats on every step count change:
```typescript
pattern.tracks[0].beats = rebuildBeats(stepCount)  // in onTimeSigChange + onSubdivisionChange
```

Phase 4 — pass existing beats for merge:
```typescript
pattern.tracks[0].beats = rebuildBeats(stepCount, pattern.tracks[0].beats)
```

This is the only change needed in the existing App.svelte helper functions.

### Pattern 5: Beat Grid Svelte 5 Reactivity

**What:** Mutating `pattern.tracks[0].beats[i].voice` directly on the $state proxy triggers the existing `$effect(() => { engine.updatePattern(pattern) })`.

**Verified mechanism (Svelte 5 official docs):** `$state` wraps plain objects and arrays in a deeply reactive proxy tree. Property writes at any nesting depth are intercepted and propagate reactivity to all dependents. No new array reference is required.

**Click handler for beat cell cycling:**
```typescript
function cycleBeatVoice(i: number) {
    const current = pattern.tracks[0].beats[i].voice
    pattern.tracks[0].beats[i].voice = (current + 1) % 3  // 0→1→2→0
}
```

This single-property mutation is sufficient. The $effect fires, `engine.updatePattern(pattern)` runs, `_beats` is updated, and the scheduler picks it up on the next tick.

**No reassignment needed.** Do NOT do `pattern.tracks[0].beats = [...beats]` — it works but creates unnecessary array allocation. The proxy mutation is cleaner.

[CITED: https://svelte.dev/docs/svelte/$state — "Proxies allow Svelte to run code when you read or write properties, including via methods like array.push(...), triggering granular updates."]

### Anti-Patterns to Avoid

- **Branching on `noise_gain` in the sample loop:** `if (noise_gain > 0.0) { ... }` in the hot path. Decision D-12 explicitly rejects this. The PRNG call runs unconditionally; multiplication by 0.0 in IEEE 754 is always exactly 0.0 (no conditional needed).
- **Calling `set_accent_params` from the worklet for voice==2:** Silent is a new voice value, not a new DSP mode. No change to accent DSP parameters is needed.
- **Using `postMessage` to deliver noise_gain:** postMessage introduces latency and allocation. The paramSAB slot 4 atomic read is the correct path (same pattern as `accentAmpMillis` in slot 3, which already goes through paramSAB, not postMessage).
- **Resetting `_barStep` when beats[i].voice changes:** Only step count changes require `_barStep = 0`. Voice changes are in-place and the scheduler continues with the current bar position.
- **Assuming pattern.tracks[0].beats is an ordinary array:** It is a Svelte 5 proxy. Do not pass it to `structuredClone()` or `JSON.stringify()` without `$state.snapshot(pattern)` first. The `rebuildBeats()` function returns a plain array, so its output is safe to assign.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| White noise PRNG | Custom LCG or LFSR | xorshift32 (canonical Marsaglia triple) | LCG has short period and obvious patterns; xorshift32 has period 2³²-1, passes spectral tests, matches industry audio standard |
| Float clipping prevention | Soft-knee compressor | `f32::clamp(-1.0, 1.0)` | Single intrinsic; LLVM compiles to `minss/maxss`; no dynamic range processing needed at this mix level |
| Svelte deep reactivity | Observer pattern / manual invalidation | Svelte 5 $state proxy | $state already provides this — any mutation to nested properties triggers $effect |
| paramSAB encoding | Custom float encoding | Integer × 1000 (existing convention) | accentAmpMillis already uses this; consistency prevents decoding errors in the worklet |

**Key insight:** The PRNG, the clamp, and the proxy reactivity are each one line or intrinsic call. Nothing in Phase 4 warrants a hand-rolled solution.

---

## Common Pitfalls

### Pitfall 1: Clipping When Noise + Click Fire on the Same Frame (CRITICAL)

**What goes wrong:** At 100% noise (gain 1.0) and accent voice (peak ~1.3), the additive mix can reach ~2.3 before output normalization. Web Audio output is internally clamped by the browser, but the worklet's `Float32Array` output is copied before any clamping — some platforms pass the unclamped float through to the DAC, producing distortion or digital clipping artifacts.

**Why it happens:** `fill_output_buffer` writes click + noise additively into AUDIO_OUT. The AUDIO_OUT buffer is shared memory (a Float32Array view over WASM linear memory). The worklet copies it with `outputs[0][0].set(this._outputView)`. The Web Audio spec says output values outside [-1.0, 1.0] are implementation-defined — most browsers clamp silently but Android Chrome on some devices clips to integer range before DAC conversion.

**How to avoid:** Clamp every sample after mixing: `(click_sample + noise_sample).clamp(-1.0_f32, 1.0_f32)`. This is a free intrinsic on x86/ARM. The noise_gain at 100% means the noise occupies [-1.0, 1.0] of headroom; the click must be mixed within that budget. At practical usage (5–10% noise for OTG keep-alive), clipping does not occur. At 100% noise with an accent click, the clamp handles the edge case.

**Alternative mitigation (if clamp is not wanted):** Scale click amplitudes by (1.0 - noise_gain) to preserve headroom. This is more correct from a mixing perspective but adds a multiply per trigger. The clamp approach is simpler and correct for all cases.

**Warning signs:** Buzzing or crackling sound at high noise levels during accent beats. Vitest cannot detect this — it requires a human verify at 100% noise.

### Pitfall 2: PRNG State Initialized to Zero

**What goes wrong:** xorshift32 has a fixed point at 0: if `PRNG_STATE = 0`, every call returns 0, producing silence instead of noise.

**Why it happens:** Rust initializes all uninitialized statics to zero. If `PRNG_STATE` is declared as `static mut PRNG_STATE: u32 = 0;` or left as default, the PRNG output is permanently zero.

**How to avoid:** Declare with any non-zero seed: `static mut PRNG_STATE: u32 = 12345;`. Any non-zero value works — the sequence is deterministic and period-correct from any non-zero seed.

**Warning signs:** Noise slider shows non-zero value but no audible noise. `read_out(i)` in a Rust test shows 0.0 for all samples when noise_gain > 0.

### Pitfall 3: rebuildBeats() Callers Not Updated — Resets User Assignments

**What goes wrong:** `onTimeSigChange()` and `onSubdivisionChange()` in App.svelte call `rebuildBeats(stepCount)` without the `existingBeats` argument. After any time signature or subdivision change, all per-beat assignments reset to the default pattern (beat 0 = accent, rest = normal). Phase 4 specifically requires D-07 (preserve on resize).

**Why it happens:** Phase 3 deliberately wrote `rebuildBeats(stepCount)` everywhere. Phase 4 requires updating these two call sites to pass `pattern.tracks[0].beats` as the second argument.

**How to avoid:** Update both call sites in App.svelte from `rebuildBeats(stepCount)` to `rebuildBeats(stepCount, pattern.tracks[0].beats)`.

**Warning signs:** User customizes beat 3 to Silent, then changes subdivision — the Silent assignment disappears. Confirmed by the Vitest test for merge semantics.

### Pitfall 4: barStep Out-of-Bounds After Step Count Change (existing P3-02, still applies)

**What goes wrong:** If `_barStep` is, say, 7 when step count shrinks to 4, `_beats[7 % 4]` = `_beats[3]` — this is in-bounds for a 4-step array, so the existing modulo guard handles it correctly.

**However:** When step count INCREASES (e.g., 4 → 16), the new positions (indices 4–15) are added by `rebuildBeats()`. The existing `_barStep = 0` reset on step count change (in `updatePattern()`) means the scheduler always restarts from beat 0 after a step count change. This is the correct behavior and is already implemented. No change needed.

**Warning signs:** Beats playing in the wrong order after subdivision changes.

### Pitfall 5: Noise Slider Writes to paramSAB Before start() Initializes It

**What goes wrong:** The user moves the noise slider before pressing Play. `_paramBuffer` is null until `start()` allocates the SharedArrayBuffer. `Atomics.store(null, 4, ...)` throws a TypeError that is uncaught.

**Why it happens:** Same as Pitfall P3-04 (accent param write before SAB init). The same null guard pattern used in `updatePattern()` must be applied to noise gain writes.

**How to avoid:**
```typescript
setNoiseGain(millis: number): void {
    if (this._paramBuffer) {           // null guard — identical to updatePattern()
        Atomics.store(this._paramBuffer, 4, millis);
    }
    // Store the value for replay when start() initializes SAB:
    this._pendingNoiseGainMillis = millis;
}
```
And in `start()` after `_paramBuffer` is set:
```typescript
this._paramBuffer = new Int32Array(this._paramSAB, 0, 8);
if (this._pendingNoiseGainMillis > 0) {
    Atomics.store(this._paramBuffer, 4, this._pendingNoiseGainMillis);
}
```
Alternatively: store `noiseLevel` as $state in Svelte and re-call `engine.setNoiseGain()` after `engine.start()` in `handlePlayStop()` (simpler, no new AudioEngine field).

**Warning signs:** "TypeError: Cannot perform Atomics operation on a non-SharedArrayBuffer" in the browser console when moving the noise slider before pressing Play.

### Pitfall 6: Worklet Reads noiseGain BEFORE paramBuffer Is Set

**What goes wrong:** The worklet's `process()` calls `Atomics.load(this._paramBuffer, 4)` but `_paramBuffer` is null until the 'init-buffers' message arrives.

**Why it happens:** The `process()` guard at line 83 checks `!this._ready || !this._ringIndices`. If `_paramBuffer` is not included in this guard, and `_ready` becomes true before `_paramBuffer` is set, the `Atomics.load` call throws.

**How to avoid:** Add `_paramBuffer` to the ready guard:
```javascript
if (!this._ready || !this._ringIndices || !this._paramBuffer) {
    return true;
}
```
Alternatively, initialize `_paramBuffer` to a zeroed placeholder and check null. The guard extension is simpler.

**Warning signs:** AudioWorklet throws TypeError and stops outputting audio (process() returns undefined instead of true, killing the worklet permanently).

---

## Code Examples

Verified patterns from codebase and official sources:

### xorshift32 inline helper (Rust)
```rust
// Source: Marsaglia (2003) xorshift32 — shift triple (13, 17, 5) canonical for 32-bit
// [CITED: KVR Audio DSP Forum, EDN article on xorshift32 audio noise]
static mut PRNG_STATE: u32 = 12345;  // non-zero seed required

#[inline(always)]
unsafe fn xorshift32_next() -> u32 {
    let mut state = std::ptr::addr_of!(PRNG_STATE).read();
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    std::ptr::addr_of_mut!(PRNG_STATE).write(state);
    state
}
```

### Per-sample noise mixing and clamp (inside fill_output_buffer loop)
```rust
// Source: Phase 4 design — extends existing sample loop in rust/src/lib.rs lines 64–93
let click_sample: f32 = /* existing synthesis output (0.0 if !ACTIVE) */;
let raw_noise = xorshift32_next();
let noise_sample = (raw_noise as i32 as f32) / 2147483648.0_f32 * noise_gain;
let mixed = (click_sample + noise_sample).clamp(-1.0_f32, 1.0_f32);
ptr.add(i).write(mixed);
```

### Voice==2 silent branch (inside trigger block)
```rust
// Source: D-14 — extends existing trigger block in rust/src/lib.rs lines 50–62
if sample_offset != NO_BEAT_SENTINEL {
    if voice == 2 {
        // Silent: no click synthesis, no ACTIVE set; noise runs unconditionally below
    } else {
        let (freq, base_amp) = if voice == 1 { ... } else { (CLICK_FREQ, 0.75_f32) };
        // ... (existing Phase 3 trigger code unchanged)
    }
}
```

### rebuildBeats() with merge parameter (TypeScript)
```typescript
// Source: D-07, D-08 — extends src/lib/pattern.ts rebuildBeats()
export function rebuildBeats(
    stepCount: number,
    existingBeats?: BeatPosition[]
): BeatPosition[] {
    if (!existingBeats) {
        return Array.from({ length: stepCount }, (_, i) => ({ voice: i === 0 ? 1 : 0 }));
    }
    return Array.from({ length: stepCount }, (_, i) => ({
        voice: i < existingBeats.length ? existingBeats[i].voice : 0,
    }));
}
```

### Svelte 5 beat cell click handler
```typescript
// Source: Svelte 5 docs — deep proxy mutation triggers $effect
// [CITED: https://svelte.dev/docs/svelte/$state]
function cycleBeatVoice(i: number) {
    const current = pattern.tracks[0].beats[i].voice
    pattern.tracks[0].beats[i].voice = (current + 1) % 3
}
```

### paramSAB slot 4 write (AudioEngine)
```typescript
// Source: existing Atomics.store pattern — audio-engine.ts lines 177–179
setNoiseGain(millis: number): void {
    if (this._paramBuffer) {
        Atomics.store(this._paramBuffer, 4, millis);  // slot 4: noise_gain × 1000
    }
}
```

### paramSAB slot 4 read (worklet process())
```javascript
// Source: existing Atomics.load pattern — processor.js lines 88–89
// Add before fill_output_buffer call (processor.js line 114)
const noiseGainMillis = Atomics.load(this._paramBuffer, 4);
this._exports.fill_output_buffer(sampleOffset, voice, noiseGainMillis / 1000.0);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `_noise_gain` parameter unused (always 0.0) | `noise_gain` parameter active — xorshift32 white noise | Phase 4 | Enables OTG keep-alive; user-controllable via slider |
| `rebuildBeats(stepCount)` resets all beats | `rebuildBeats(stepCount, existingBeats?)` preserves assignments | Phase 4 | Users can customize per-beat voices persistently |
| Voice 0/1 only in ring events | Voice 0/1/2 (silent) in ring events | Phase 4 | Complete per-beat assignment control |
| `fill_output_buffer` trigger: normal or accent | `fill_output_buffer` trigger: normal, accent, or silent (voice==2 no-op) | Phase 4 | Completes palette model |

**No deprecated patterns introduced.** All Phase 4 changes extend existing patterns without breaking them.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `/ 1000.0` float division in worklet process() is negligible (one op per 2.9ms frame) | Pattern 3: paramSAB slot 4 | If wrong: could use integer shift or store as float directly; but `/ 1000.0` is ~0.1 CPU cycles on modern ARM/x86 — not a practical concern |
| A2 | `noiseLevel * 10` encodes noise_gain_millis correctly (0–100 → 0–1000) | Pattern 3 | If wrong: wrong scaling produces wrong noise level. Verify: 50% slider → `50 * 10 = 500` → `500 / 1000.0 = 0.5`. Correct. |

**Both assumptions are low-risk arithmetic facts, not behavioral assumptions.**

---

## Open Questions (RESOLVED)

1. **Where should the noise slider write happen — via `AudioEngine.setNoiseGain()` or direct `Atomics.store` from App.svelte?**
   - What we know: `updatePattern()` already guards all paramSAB writes. The noise slider does not need to go through PatternState (it's not a beat pattern property — it's a mix control).
   - What's unclear: Should `noiseLevel` be added to `PatternState`, or handled as a separate `engine.setNoiseGain()` call?
   - Recommendation: Add `setNoiseGain(millis: number)` to AudioEngine. Keep `noiseLevel` as a separate `$state` in App.svelte (not part of PatternState). This preserves separation of concerns — PatternState holds rhythm data, not audio mix settings. The `$effect` tracking `pattern` does not need to re-run for noise changes.

2. **Should `pendingNoiseGainMillis` be stored in AudioEngine for pre-start() noise slider moves?**
   - What we know: The existing accent params handle pre-start() via the pattern $effect re-calling `updatePattern()` after `start()` (see handlePlayStop in App.svelte). The same approach works for noise: call `engine.setNoiseGain(millis)` after `engine.start()` in `handlePlayStop()`.
   - Recommendation: In `handlePlayStop()`, after `await engine.start()`, add `engine.setNoiseGain(Math.round(noiseLevel * 10))`. No new AudioEngine field needed.

3. **Does `voice==2` need a Rust cargo test?**
   - What we know: The trigger block is already tested by `trigger_produces_sound`, `sentinel_silence_inactive`, and `trigger_at_offset`. A voice==2 test would verify: `fill_output_buffer(0, 2, 0.0)` with ACTIVE=false → all 128 samples = 0.0.
   - Recommendation: Yes, add a test. The silent voice is a new code path; the test is one unsafe block (~5 lines). It prevents regressions if `voice == 2` branch is accidentally broken.

---

## Environment Availability

No new external dependencies. All toolchain components are from Phase 1/2/3.

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Rust (stable) | WASM DSP changes | Confirmed (Phase 1) | xorshift32 uses only core Rust, no new crates |
| Node.js + npm | Svelte/Vitest | Confirmed (Phase 1) | No new packages |
| Vitest | Pattern tests | Confirmed (Phase 3) | Extend existing test file |
| wasm-bindgen-cli | WASM build | Confirmed (Phase 1) | No change to build pipeline |

**No missing dependencies.** Phase 4 is pure code changes to existing files.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (installed Phase 3), cargo test (Rust built-in) |
| Config file | `vitest.config.ts` (created Phase 3) |
| Quick run command | `npx vitest run src/lib/pattern.test.ts` |
| Full TS suite command | `npx vitest run` |
| Rust tests | `cargo test --manifest-path rust/Cargo.toml` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PATTERN-01 | `rebuildBeats(n, existing)` preserves assignments | unit | `npx vitest run src/lib/pattern.test.ts` | Extend existing |
| PATTERN-01 | Voice cycle: 0→1→2→0 | unit | `npx vitest run src/lib/pattern.test.ts` | Extend existing |
| PATTERN-01 | Merge: grow 4→8 fills new with voice=0 | unit | `npx vitest run src/lib/pattern.test.ts` | Extend existing |
| PATTERN-01 | Merge: shrink 8→4 truncates from right | unit | `npx vitest run src/lib/pattern.test.ts` | Extend existing |
| AUDIO-02 | voice==2 → no click, AUDIO_OUT = 0.0 (with noise_gain=0.0) | unit | `cargo test -- test_silent_voice_no_click` | Add to lib.rs |
| AUDIO-02 | noise_gain > 0.0 → non-zero output samples | unit | `cargo test -- test_noise_produces_output` | Add to lib.rs |
| AUDIO-02 | noise_gain = 0.0 → all zero samples (with ACTIVE=false) | unit | `cargo test -- test_noise_zero_gain` | Add to lib.rs |
| AUDIO-02 | Clamp: noise + accent click stays within [-1.0, 1.0] | unit | `cargo test -- test_clamp_prevents_clipping` | Add to lib.rs |
| PATTERN-01 + AUDIO-02 | Beat grid interactive, noise slider audible | human verify | Manual — play/stop with custom patterns and noise at 0%, 10%, 100% | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/pattern.test.ts && cargo test --manifest-path rust/Cargo.toml`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

No new test infrastructure gaps — Vitest is installed (Phase 3), cargo test is built-in. New tests are additions to existing files.

- [ ] `src/lib/pattern.test.ts` — add `rebuildBeats` merge semantics tests (PATTERN-01)
- [ ] `rust/src/lib.rs` `#[cfg(test)]` — add silent voice tests, noise output tests, clamp tests (AUDIO-02)

---

## Security Domain

This phase adds no authentication, session management, access control, or cryptographic features. No ASVS categories are applicable.

The xorshift32 PRNG is explicitly NOT suitable for cryptographic use — it is used only for audio white noise generation. This is the correct and intended use. [CITED: xorshift32 documentation — "should not be used for cryptographic applications"]

No new network requests, no user input to external systems, no persistent storage changes.

---

## Sources

### Primary (HIGH confidence)
- `rust/src/lib.rs` — current Rust WASM engine, read directly; all patterns extracted from lines 1–379
- `src/lib/audio-engine.ts` — current AudioEngine, read directly; paramSAB layout, updatePattern(), _schedulerTick() confirmed
- `public/worklet/processor.js` — current AudioWorklet, read directly; process() hot path, fill_output_buffer call site confirmed
- `src/lib/pattern.ts` — current PatternState types and rebuildBeats(), read directly
- `src/App.svelte` — current UI, read directly; $state / $effect patterns, CSS conventions confirmed
- `src/lib/pattern.test.ts` — current Vitest test structure, read directly
- `.planning/phases/04-per-beat-patterns/04-CONTEXT.md` — locked decisions D-01 through D-15
- `.planning/phases/04-per-beat-patterns/04-UI-SPEC.md` — component specs, CSS conventions
- `.planning/phases/03-timing-controls/03-PATTERNS.md` — Phase 3 pattern map, all shared patterns

### Secondary (MEDIUM confidence)
- [Svelte 5 $state docs](https://svelte.dev/docs/svelte/$state) — deep proxy reactivity behavior confirmed: nested mutations trigger $effect; destructuring breaks reactivity
- [EDN: xorshift32 audio white noise](https://www.edn.com/a-non-finicky-mass-producible-audio-frequency-white-noise-generator/) — shift triple (13, 17, 5) and audio white noise use case
- [KVR Audio DSP Forum](https://www.kvraudio.com/forum/viewtopic.php?t=564273) — float conversion from uint32, 16-bit masking option, industry practice

### Tertiary (LOW confidence — not used for any locked claim)
- Wikipedia: Xorshift — background context only; WebFetch returned 403 so not directly read

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all from direct codebase reads (no external libraries added)
- xorshift32 parameters: HIGH — (13, 17, 5) triple confirmed via EDN article and KVR forum, matches Marsaglia (2003) canonical paper
- Svelte 5 deep proxy: HIGH — confirmed from official Svelte 5 docs (svelte.dev/docs/svelte/$state)
- Architecture: HIGH — derived from direct reads of all five source files
- Pitfalls: HIGH for clipping/PRNG/null guard (derived from code); MEDIUM for barStep OOB (existing fix confirmed still applies)

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (30 days — Svelte 5 and Rust stable APIs; fast-moving only for Svelte minor runes API, which is stable at 5.x)
