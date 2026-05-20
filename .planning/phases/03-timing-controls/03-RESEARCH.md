# Phase 3: Timing Controls - Research

**Researched:** 2026-05-20
**Domain:** Lookahead scheduler BPM/time-signature wiring, WASM accent voice, Svelte 5 state-to-engine binding
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** BPM widget = horizontal `<input type="range">` slider (20–300) + validated number input + four step buttons: −5, −1, +1, +5 BPM. Editing the number updates the slider and vice versa. Input validates on blur/enter: clamp to 20–300, reject non-numeric. Slider and buttons change BPM immediately; scheduler picks up the new value on its next 25ms tick without stopping playback.
- **D-02:** Accent pitch: fixed at **1400 Hz** (vs. 1000 Hz for normal click). Toggled on/off independently — when off, accent uses 1000 Hz.
- **D-03:** Accent amplitude: configurable multiplier **1.0–1.5**, `step=0.1`. Toggled on/off independently — when off, accent amplitude = 1.0× (same as normal). Both pitch and amplitude toggles default to on.
- **D-04:** Beat 1 (index 0) in every bar is the accent voice (`voice = 1` in the ring protocol). All other positions are normal (`voice = 0`). The WASM `fill_output_buffer` receives the voice value and applies the accent frequency/amplitude accordingly. Accent parameters (freq override, amplitude multiplier) are passed via the paramSAB to WASM at init and on any change.
- **D-05:** `PatternState` is a Svelte `$state` object in `App.svelte`. Shape locked (see below).
- **D-06:** `AudioEngine` gains `updatePattern(state: PatternState): void`. App.svelte calls via `$effect`. No postMessage — engine fields updated synchronously on main thread.
- **D-07:** Step count per bar = `numerator × subdivisionMultiplier` (quarter=×1, 8th=×2, triplet=×3, 16th=×4).
- **D-08:** BPM = quarter-note BPM. Step interval = `(60 / bpm) × (4 / denominator) / subdivisionMultiplier`.
- **D-09:** Scheduler advances `_nextBeatTime` by `stepInterval` each step. Beat array index cycles: `stepIndex = barStep % stepCount`. Voice = `this._beats[stepIndex].voice`.

### Claude's Discretion

- Default PatternState on first load: BPM=120, 4/4, quarter subdivision, tracks[0].beats = [{voice:1}, {voice:0}, {voice:0}, {voice:0}]
- Exact layout of timing controls in App.svelte (BPM block, time signature row, subdivision selector)
- How time signature numerator is picked (number input 1–12) and denominator (select: 2|4|8|16)
- Subdivision picker UI (radio buttons or select, four options)
- Whether accent settings (pitch toggle, amplitude slider) live in a collapsible panel or always visible
- WASM encoding of accent params in paramSAB (e.g., slots 2–4 for accent_freq, accent_amp, unused)

### Deferred Ideas (OUT OF SCOPE)

- Per-beat sound assignment — Phase 4 scope
- Ghost notes (voice=2) and silent beats (voice=3) — Phase 4
- White noise slider — Phase 4 (AUDIO-02)
- Configurable accent pitch multiplier — deferred to v2
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TIMING-01 | User can set BPM in the range 20–300 | Scheduler tick reads `this._bpm`; UI slider+input+buttons write it; `_stepInterval` recomputed by `updatePattern()` |
| TIMING-02 | User can set time signature numerator (1–12) and common denominators (2, 4, 8, 16) | `stepCount = numerator × subdivisionMultiplier`; denominator is an input to step interval formula |
| TIMING-03 | User can select subdivision (quarter, 8th, triplet, 16th) | `subdivisionMultiplier` map drives step count and interval formula |
| PATTERN-02 | Beat 1 defaults to accent; all other positions default to normal | `tracks[0].beats[0].voice = 1`, rest `voice = 0`; WASM accent path gated on `voice === 1` |
</phase_requirements>

---

## Summary

Phase 3 is primarily a **wiring phase**, not a new-capability phase. The SPSC ring, paramSAB, AudioWorklet, and WASM `fill_output_buffer` are all already in place from Phase 2. The work is: (1) replace the hardcoded `60/120` step interval in `_schedulerTick` with a computed `_stepInterval` and add step index cycling, (2) start writing non-zero voice bits into ring events for beat-0, (3) extend the Rust DSP to branch on voice and read accent freq/amp from two new statics, (4) write accent params into paramSAB slots 2 and 3 from the main thread, (5) build the BPM/time-sig/subdivision UI in App.svelte driven by PatternState `$state` through an `$effect` into `engine.updatePattern()`.

The critical correctness invariant is the **step interval formula**: `(60/bpm) × (4/denominator) / subdivisionMultiplier`. This must match DAW convention (quarter-note BPM). A mid-playback BPM change is safe because `_nextBeatTime` is a running accumulator — the new `_stepInterval` just takes effect on the next `while` loop iteration without resetting the clock. A time-signature change must reset `_barStep` to 0 to avoid an out-of-bounds index into the new shorter `_beats` array.

The only new communication path needed is **paramSAB slots 2 and 3 for accent parameters** (freq as integer Hz, amplitude multiplier as integer milliunits). The WASM `fill_output_buffer` reads them via `Atomics.load` from the `_paramBuffer` the worklet already holds. No new postMessage, no new SAB allocation.

**Primary recommendation:** Implement in three sequential waves — (A) pure Rust DSP extension with `cargo test` coverage, (B) scheduler extension + paramSAB wiring, (C) Svelte UI + `$effect` binding.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| BPM input validation and clamping | Main thread (UI) | — | UI-only concern; engine accepts any value updatePattern() provides |
| Step interval computation | Main thread (AudioEngine) | — | Runs in `updatePattern()` once per user action, not per audio frame |
| Beat array cycling (barStep) | Main thread (AudioEngine) | — | `_schedulerTick` owns `_barStep`; scheduler is main-thread |
| Voice bit encoding into ring events | Main thread (AudioEngine) | — | `_beats[stepIndex].voice` packed into ring u32 by the scheduler |
| Accent freq/amp application | WASM (AudioWorklet thread) | — | Called inside `fill_output_buffer`; reads statics derived from paramSAB |
| paramSAB accent slots write | Main thread (AudioEngine) | — | `updatePattern()` writes slots 2 and 3 via `Atomics.store` |
| paramSAB accent slots read | AudioWorklet (WASM) | — | WASM reads via imported memory or worklet passes as args |
| PatternState shape and ownership | Main thread (App.svelte $state) | — | Svelte reactive state; engine is a consumer not owner |
| Time-sig change reset (barStep=0) | Main thread (AudioEngine) | — | Must happen synchronously in `updatePattern()` before next tick |

---

## Standard Stack

Phase 3 adds no new npm packages or Rust crates. All libraries are already installed.

### Core (unchanged from Phase 2)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte | 5.x (5.55.5 installed) | `$state`, `$effect` reactive primitives | Already installed; runes are the Phase 3 binding mechanism |
| TypeScript | ~6.0.2 (installed) | AudioEngine `updatePattern()` method typing | Already installed |
| Rust stable | 1.77+ | WASM accent DSP extension | Already in use; `static mut` + `#[no_mangle]` pattern established |
| Web Audio API / Atomics | Browser-native | paramSAB slot writes from main thread | Already in use |

### No New Packages Required

The Phase 2 install surface is sufficient. Vitest is NOT yet installed (see Validation Architecture section — Wave 0 gap for TypeScript unit tests).

---

## Package Legitimacy Audit

No new packages are installed in Phase 3. This section is not applicable.

---

## Architecture Patterns

### System Architecture Diagram (Phase 3 additions highlighted)

```
User interaction
  → App.svelte ($state: PatternState)
      bpm, tracks[0].{stepCount, subdivision, denominator, beats[]}
  → $effect → engine.updatePattern(pattern)
      [NEW] Recomputes _stepInterval, _beats, _stepCount
      [NEW] Resets _barStep if stepCount changed
      [NEW] Atomics.store(paramBuffer, 2, accentFreqHz)     ← slot 2
      [NEW] Atomics.store(paramBuffer, 3, accentAmpMillis)  ← slot 3

  Main thread setInterval (25ms)
  → AudioEngine._schedulerTick()
      while _nextBeatTime < currentTime + 0.1:
        [NEW] stepIndex = _barStep % _stepCount
        [NEW] voice = _beats[stepIndex].voice   (0 or 1)
        event = (sampleOffset & 0x7F) | (voice << 7) | (quantumIndex << 12)
        → write to controlRingSAB
        [CHANGED] _nextBeatTime += _stepInterval   (was: += 60/120)
        [NEW] _barStep++

AudioWorklet process() (unchanged)
  → reads ring event → extracts voice, sampleOffset
  → calls fill_output_buffer(sampleOffset, voice, 0.0)

WASM fill_output_buffer(sample_offset, voice, _noise_gain)
  [NEW] if voice == 1:
    freq  = read ACCENT_FREQ static (set at init from paramSAB or via set_accent_params())
    amp   = read ACCENT_AMP static
  else:
    freq = CLICK_FREQ (1000 Hz)
    amp  = 1.0
  [NEW] PHASE_INC = freq / SAMPLE_RATE
  ... existing envelope synthesis ...
  output *= amp
```

**paramSAB slot layout (updated):**
```
slot 0: noise_gain_milliunits   (0–1000)       — Phase 2, unused until Phase 4
slot 1: is_playing              (0 or 1)        — Phase 2, currently unused
slot 2: accent_freq_hz          (integer Hz)    — NEW Phase 3 (1000 or 1400)
slot 3: accent_amp_milliunits   (1000–1500)     — NEW Phase 3 (maps to 1.0–1.5)
slots 4–7: reserved
```

### Recommended Project Structure

No new directories. Changes are in-place modifications to existing files:

```
rust/src/
└── lib.rs          ← add ACCENT_FREQ / ACCENT_AMP statics + set_accent_params() export
                      branch fill_output_buffer on voice param

src/lib/
└── audio-engine.ts ← add updatePattern(), _stepInterval, _beats, _barStep, _stepCount fields
                      extend _schedulerTick for voice + step cycling
                      add paramSAB slot writes

src/
└── App.svelte      ← add PatternState $state, BPM controls, time-sig row, subdivision picker
                      accent panel; wire $effect → engine.updatePattern()
```

### Pattern 1: Dynamic Step Interval (replacing hardcoded 120 BPM)

**What:** `updatePattern()` computes `_stepInterval` once and stores it. `_schedulerTick` reads the stored value each tick.

**When to use:** Any time BPM, denominator, or subdivision changes.

```typescript
// Source: D-08 formula from 03-CONTEXT.md (locked decision)
private _stepInterval: number = 60.0 / 120; // seconds per step
private _beats: BeatPosition[] = [{ voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 0 }];
private _stepCount: number = 4;
private _barStep: number = 0;

updatePattern(state: PatternState): void {
  const track = state.tracks[0];
  const multMap: Record<string, number> = {
    quarter: 1, eighth: 2, triplet: 3, sixteenth: 4,
  };
  const mult = multMap[track.subdivision] ?? 1;
  const newInterval = (60.0 / state.bpm) * (4 / track.denominator) / mult;
  const newStepCount = track.stepCount; // numerator × mult, pre-computed by UI layer

  // Reset bar position when step count changes to prevent OOB index (Pitfall P3-03)
  if (newStepCount !== this._stepCount) {
    this._barStep = 0;
  }

  this._stepInterval = newInterval;
  this._stepCount    = newStepCount;
  this._beats        = track.beats;

  // Write accent params to paramSAB (slots 2 and 3)
  if (this._paramBuffer) {
    const accentFreq = /* from state or fixed 1400 */ 1400;
    const accentAmp  = /* from state */ 1300; // 1.3 × 1000
    Atomics.store(this._paramBuffer, 2, accentFreq);
    Atomics.store(this._paramBuffer, 3, accentAmp);
  }
}
```

**_schedulerTick inner loop change:**

```typescript
// BEFORE (Phase 2):
this._nextBeatTime += 60.0 / 120;

// AFTER (Phase 3):
const stepIndex = this._barStep % this._stepCount;
const voice     = this._beats[stepIndex]?.voice ?? 0;
const event     = (sampleOffset & 0x7F) | ((voice & 0x1F) << 7) | ((quantumIndex & 0xFFFFF) << 12);
// ... write event to ring ...
this._nextBeatTime += this._stepInterval;
this._barStep++;
```

### Pattern 2: WASM Accent Voice Branch

**What:** `fill_output_buffer` branches on `voice` to select freq and amplitude statics. A new `set_accent_params(freq_hz, amp_milliunits)` export lets the worklet set these from paramSAB values.

**Key insight:** The worklet cannot easily pass paramSAB values into `fill_output_buffer` without adding parameters (breaking the existing signature). The simplest allocation-free path is a dedicated `set_accent_params` export called once at init and again whenever the worklet detects a slot 2/3 change. This keeps `fill_output_buffer` to 3 arguments and avoids per-frame paramSAB reads.

**Alternative:** Read slots 2 and 3 inside `fill_output_buffer` by having the worklet pass them as arguments 4 and 5. This is also valid but requires signature change. Either approach works; the planner chooses.

```rust
// Source: established static mut pattern from lib.rs (Phase 2)
static mut ACCENT_FREQ: f32 = 1400.0;
static mut ACCENT_AMP:  f32 = 1.0;    // will be set to 1.0–1.5

#[no_mangle]
pub extern "C" fn set_accent_params(freq_hz: f32, amp: f32) {
    unsafe {
        std::ptr::addr_of_mut!(ACCENT_FREQ).write(freq_hz);
        std::ptr::addr_of_mut!(ACCENT_AMP).write(amp);
        // Recompute phase inc for accent voice
        let sample_rate = std::ptr::addr_of!(SAMPLE_RATE).read();
        // ACCENT_PHASE_INC is read per-trigger, so no separate static needed:
        // voice branch in fill_output_buffer recomputes from ACCENT_FREQ on trigger
    }
}

// In fill_output_buffer, on trigger (sample_offset != NO_BEAT_SENTINEL):
// unsafe block:
//   let (use_freq, use_amp) = if voice == 1 {
//     (addr_of!(ACCENT_FREQ).read(), addr_of!(ACCENT_AMP).read())
//   } else {
//     (CLICK_FREQ, 1.0_f32)
//   };
//   let new_phase_inc = use_freq / addr_of!(SAMPLE_RATE).read();
//   addr_of_mut!(PHASE_INC).write(new_phase_inc);
//   addr_of_mut!(ENVELOPE_GAIN).write(use_amp);
//   addr_of_mut!(PHASE_ACCUM).write(0.0);
//   addr_of_mut!(ACTIVE).write(true);
```

### Pattern 3: Svelte 5 $effect for Engine Binding

**What:** A single `$effect` watches `pattern` (the `$state` object) and calls `engine.updatePattern()`. Svelte 5 tracks deep reads on `$state` objects — any change to `pattern.bpm`, `pattern.tracks[0].subdivision`, etc. re-runs the effect.

**When to use:** Any time a reactive `$state` value must drive a non-reactive class method call.

```typescript
// Source: [ASSUMED] Svelte 5 $effect documentation pattern
let pattern = $state<PatternState>({
  bpm: 120,
  tracks: [{
    stepCount: 4,
    subdivision: 'quarter',
    denominator: 4,
    beats: [{ voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 0 }],
  }],
});

$effect(() => {
  // Svelte 5 tracks all reactive reads inside $effect
  // Accessing pattern.bpm, pattern.tracks[0].beats, etc. subscribes to them
  engine.updatePattern(pattern);
});
```

**Caution:** `$effect` runs after the DOM update cycle, not synchronously. For a metronome, this is fine — the scheduler has a 100ms lookahead buffer, so a 1–16ms delay before `updatePattern()` is called is imperceptible. [ASSUMED — based on Svelte 5 runes semantics from training data]

### Pattern 4: BPM Step Buttons (±1, ±5)

**What:** Four buttons modify `pattern.bpm` directly. Because `pattern` is `$state`, Svelte invalidates and re-runs the `$effect` automatically.

```typescript
// No engine.updatePattern() call needed here — $effect handles it
function adjustBpm(delta: number) {
  pattern.bpm = Math.max(20, Math.min(300, pattern.bpm + delta));
}
```

### Pattern 5: PatternState Reconstruction on Time-Sig Change

**What:** When numerator or subdivision changes, the `beats` array must be rebuilt to the new length. Beat 0 always gets `voice: 1`; all other positions get `voice: 0`.

```typescript
function rebuildBeats(stepCount: number): BeatPosition[] {
  return Array.from({ length: stepCount }, (_, i) => ({ voice: i === 0 ? 1 : 0 }));
}

function onTimeSigChange(numerator: number, denominator: number, subdivision: Subdivision) {
  const mult = { quarter: 1, eighth: 2, triplet: 3, sixteenth: 4 }[subdivision];
  const stepCount = numerator * mult;
  pattern.tracks[0].stepCount   = stepCount;
  pattern.tracks[0].denominator = denominator;
  pattern.tracks[0].subdivision = subdivision;
  pattern.tracks[0].beats       = rebuildBeats(stepCount);
}
```

### Anti-Patterns to Avoid

- **Calling `updatePattern()` inside `_schedulerTick()`:** `_schedulerTick` runs every 25ms and reads already-computed fields. `updatePattern()` is for external callers only — mixing them creates circular state mutation.
- **Resetting `_nextBeatTime` on BPM change:** A BPM change should NOT reset `_nextBeatTime`. The accumulator remains valid; the new `_stepInterval` takes effect naturally on the next `while` loop iteration. Resetting causes a gap or burst of events.
- **Resetting `_barStep` on BPM change:** `_barStep` tracks position within the bar and is independent of tempo. Only reset on step count change.
- **Writing paramSAB slots inside `_schedulerTick()`:** Accent params are stable between user changes; writing them every 25ms adds unnecessary Atomics overhead. Write only in `updatePattern()`.
- **Using `Array.from` or `map` inside `_schedulerTick()`:** Allocates. `_beats` is a reference to the array set by `updatePattern()` — read it directly by index.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Svelte reactive binding to engine | Custom event bus or observer | Svelte 5 `$effect` | `$effect` already tracks `$state` reads — one line replaces a whole subscription system |
| BPM input validation | Custom parser | Clamp + `isNaN` check on blur/enter | Three lines; no library needed for 20–300 integer clamping |
| Step interval math | Lookup table | Formula D-08 directly | The formula is exact for all combinations; a table would need 4×12×4=192 entries and still be wrong for non-integer multiples |
| Beats array rebuild | Stateful diffing | Reconstruct from scratch | `stepCount` entries, beat-0 = accent, rest = normal — O(n) reconstruction is correct and fast |

---

## Common Pitfalls

### Pitfall P3-01: BPM Change Causes Ring Flood or Gap

**What goes wrong:** The scheduler continues writing events using the old `_stepInterval` for up to 100ms (the lookahead window) after a BPM change, then abruptly switches. This is expected and fine. The danger is if `_nextBeatTime` is reset to `currentTime` on BPM change — this causes the scheduler `while` loop to write many events instantly (flood) or skip events (gap).

**Why it happens:** Confusion between "the next beat time should change" (false) and "the scheduler should pick up the new interval" (true, automatically).

**How to avoid:** Never touch `_nextBeatTime` in `updatePattern()`. The scheduler `while` loop reads `_stepInterval` on each iteration — new value is used immediately for the next scheduled beat.

**Warning signs:** Burst of clicks immediately after a BPM change, or one skipped beat at the transition.

---

### Pitfall P3-02: Time-Sig Change With Stale barStep

**What goes wrong:** User changes 4/4 to 3/4. `_stepCount` drops from 4 to 3. On the next scheduler tick, `_barStep` might be 3 or greater — `_beats[3 % 3]` = `_beats[0]` (accent again, wrong position). More dangerously, if `_beats` has already been rebuilt to length 3, `_beats[3]` is `undefined`, and `?.voice ?? 0` silently emits voice=0 (no crash, but wrong accent pattern for one bar).

**Why it happens:** `_barStep` is a monotonic counter; it does not automatically clamp to the new `_stepCount`.

**How to avoid:** In `updatePattern()`, when `newStepCount !== this._stepCount`, set `this._barStep = 0` before updating `this._stepCount`. The scheduler will restart from beat 0 on the next tick.

**Warning signs:** Accent appears on beat 2 instead of beat 1 after a time-signature change.

---

### Pitfall P3-03: PHASE_INC Not Restored After Accent Trigger

**What goes wrong:** The accent trigger sets `PHASE_INC` to `ACCENT_FREQ / SAMPLE_RATE` (1400/44100 ≈ 0.0317). If the next beat is a normal click, `fill_output_buffer` must reset `PHASE_INC` to `CLICK_FREQ / SAMPLE_RATE` (1000/44100 ≈ 0.0227) on that trigger. If it only sets `PHASE_INC` on trigger and leaves it between beats, the normal click plays at 1400 Hz until the next accent.

**Why it happens:** `PHASE_INC` was a static set once in `init()`. With two voice types, it must be set on every trigger.

**How to avoid:** The trigger branch (`sample_offset != NO_BEAT_SENTINEL`) in `fill_output_buffer` must always set `PHASE_INC` and `ENVELOPE_GAIN` from the voice parameter — not just on accent. Envelope gain for normal voice is always 1.0; freq for normal voice is always `CLICK_FREQ`.

**Warning signs:** Normal clicks sound at 1400 Hz after the first bar (first accent has fired).

---

### Pitfall P3-04: `$effect` Runs Before Engine Is Initialized

**What goes wrong:** `$effect` runs immediately on component mount. If `engine.updatePattern()` is called before `engine.start()` and before the SAB is allocated (the first `start()` call allocates paramSAB), `this._paramBuffer` is null and the `Atomics.store` calls inside `updatePattern()` are silently skipped.

**Why it happens:** AudioEngine defers SAB allocation to the first `start()` call (correct, for gesture gating). But `updatePattern()` also writes to paramSAB.

**How to avoid:** Guard the `Atomics.store` calls in `updatePattern()` with `if (this._paramBuffer)` — which is already the pattern for other SAB operations in the engine. The scheduler tick also starts null-guarded. The accent params will be written on the first `updatePattern()` call after `start()` initializes the SAB — which happens because the `$effect` re-runs on any state change (or re-runs once the engine is started if bpm is changed).

**Alternative safety:** Call `engine.updatePattern(pattern)` at the end of `start()` to ensure accent params are always written after SAB init.

**Warning signs:** Accent frequency not applied on first playback session; works after changing BPM once.

---

### Pitfall P3-05: Subdivision "triplet" Is ×3, Not ×1.5

**What goes wrong:** A triplet subdivision on a 4/4 bar produces 4×3=12 steps. The step interval is `(60/120) × (4/4) / 3 = 0.5/3 ≈ 0.1667s`. Each step is a triplet eighth note. This is correct for "eighth-note triplets per quarter note." However, if the intent were "quarter-note triplets" (÷3 of a half note), the multiplier would be different.

**Why it matters:** The locked decision (D-07) says triplet = ×3 against the quarter-note grid. This matches Ableton/Reaper's triplet subdivision behavior. The formula in D-08 is correct — this pitfall is purely about confirming the interpretation is intentional.

**How to avoid:** Confirm with the user if unclear. The CONTEXT.md D-07 is explicit: triplet = ×3. Implement exactly as specified.

---

## Code Examples

### Step Interval Formula Verification (unit-testable)

```typescript
// Source: D-08 from 03-CONTEXT.md (locked decision)
// All examples verified by hand calculation:

// 4/4, quarter, 120 BPM: (60/120) × (4/4) / 1 = 0.5s per step (matches 120 BPM)
// 4/4, eighth, 120 BPM:  (60/120) × (4/4) / 2 = 0.25s per step
// 4/4, triplet, 120 BPM: (60/120) × (4/4) / 3 ≈ 0.1667s
// 4/4, sixteenth, 120 BPM: (60/120) × (4/4) / 4 = 0.125s
// 6/8, eighth, 120 BPM:  (60/120) × (4/8) / 1 = 0.25s per step
// 3/4, quarter, 100 BPM: (60/100) × (4/4) / 1 = 0.6s per step
// 7/8, eighth, 100 BPM:  (60/100) × (4/8) / 1 = 0.3s per step

function computeStepInterval(bpm: number, denominator: number, subdivMult: number): number {
  return (60.0 / bpm) * (4 / denominator) / subdivMult;
}
```

### Bar Step Cycling (unit-testable pure logic)

```typescript
// Source: D-09 from 03-CONTEXT.md
// stepIndex cycles within [0, stepCount); beat 0 = accent (voice=1)
function getVoiceForStep(barStep: number, stepCount: number, beats: BeatPosition[]): number {
  const idx = barStep % stepCount;
  return beats[idx]?.voice ?? 0;
}
```

### PatternState Initialization (unit-testable)

```typescript
// Source: Claude's Discretion from 03-CONTEXT.md
function defaultPatternState(): PatternState {
  return {
    bpm: 120,
    tracks: [{
      stepCount: 4,
      subdivision: 'quarter',
      denominator: 4,
      beats: [{ voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 0 }],
    }],
  };
}
// Invariant: beats[0].voice === 1 for all default patterns
// Invariant: beats.length === stepCount
```

### Rust Accent Branch Sketch (unit-testable)

```rust
// Source: established pattern from lib.rs Phase 2 + D-04 from 03-CONTEXT.md
static mut ACCENT_FREQ: f32 = 1400.0;
static mut ACCENT_AMP:  f32 = 1.3;   // default multiplier (D-03: both toggles on)

// On trigger inside fill_output_buffer:
// unsafe {
//   let (freq, base_amp) = if voice == 1 {
//     (addr_of!(ACCENT_FREQ).read(), addr_of!(ACCENT_AMP).read())
//   } else {
//     (CLICK_FREQ, 1.0_f32)
//   };
//   addr_of_mut!(PHASE_INC).write(freq / addr_of!(SAMPLE_RATE).read());
//   addr_of_mut!(ENVELOPE_GAIN).write(base_amp);
//   addr_of_mut!(PHASE_ACCUM).write(0.0);
//   addr_of_mut!(ACTIVE).write(true);
// }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded 120 BPM in _schedulerTick | `_stepInterval` computed by `updatePattern()` | Phase 3 | Enables real-time BPM change |
| Fixed voice=0 in ring events | `voice = _beats[stepIndex].voice` | Phase 3 | Enables accent on beat 1 |
| PHASE_INC set once in Rust `init()` | PHASE_INC set per-trigger based on voice | Phase 3 | Enables two distinct pitches |
| No PatternState shape | `{ bpm, tracks: Track[] }` multi-track model | Phase 3 | Enables Phase 4 per-beat UI without refactor |

---

## Validation Architecture

`nyquist_validation: true` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework (Rust) | `cargo test` (built into Rust toolchain) |
| Config file (Rust) | `#[cfg(test)] mod tests` in `rust/src/lib.rs` |
| Quick run command | `cargo test --manifest-path rust/Cargo.toml` |
| Full suite command | `cargo test --manifest-path rust/Cargo.toml` |
| Framework (TS) | Vitest — NOT YET INSTALLED (Wave 0 gap) |
| Config file (TS) | None yet (Wave 0 gap) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TIMING-01 | Step interval formula is correct at BPM extremes (20, 120, 300) | unit (Rust) | `cargo test --manifest-path rust/Cargo.toml step_interval` | ❌ Wave 0 |
| TIMING-01 | BPM clamping: values outside 20–300 are rejected | unit (TS/Vitest) | `npx vitest run` | ❌ Wave 0 (Vitest not installed) |
| TIMING-02 | Step count formula: numerator × subdivisionMultiplier | unit (Rust or TS) | `cargo test step_count` | ❌ Wave 0 |
| TIMING-03 | Step interval for each subdivision matches formula | unit (Rust) | `cargo test subdivision_interval` | ❌ Wave 0 |
| PATTERN-02 | Default PatternState has beats[0].voice=1, all others voice=0 | unit (TS/Vitest) | `npx vitest run` | ❌ Wave 0 |
| PATTERN-02 | fill_output_buffer with voice=1 produces different amplitude than voice=0 | unit (Rust) | `cargo test accent_amplitude` | ❌ Wave 0 |
| PATTERN-02 | fill_output_buffer with voice=1 uses 1400 Hz phase inc (not 1000 Hz) | unit (Rust) | `cargo test accent_pitch` | ❌ Wave 0 |
| TIMING-01 | BPM change mid-playback: no ring flood or gap | integration (browser) | Manual listen test | manual-only |
| TIMING-02 | Time-sig change resets barStep to beat 0 | integration (browser) | Manual listen test | manual-only |
| PATTERN-02 | Beat 1 accent audibly distinct from normal beats | Nyquist (listening) | N/A — human ear required | manual-only |

### Testable Units (cargo test candidates)

The following pure functions can be extracted and tested in Rust without browser or WASM:

1. **`step_interval_formula`** — test the formula `(60/bpm) * (4/denom) / mult` against known values from D-08 examples (6/8 at 120 = 0.25s, etc.)
2. **`bar_step_cycling`** — test `barStep % stepCount` gives correct beat index across multiple bars, including wrap-around
3. **`accent_amplitude_differs`** — call `fill_output_buffer(0, 1, 0.0)` (accent) and `fill_output_buffer(0, 0, 0.0)` (normal); verify peak amplitude differs by the `ACCENT_AMP` multiplier
4. **`accent_pitch_differs`** — trigger accent vs. normal and verify that `PHASE_INC` after trigger differs by the ratio 1400/1000
5. **`phase_inc_reset_on_normal`** — trigger accent, then trigger normal; verify `PHASE_INC` is reset to `CLICK_FREQ / SAMPLE_RATE` (Pitfall P3-03)
6. **`set_accent_params_roundtrip`** — call `set_accent_params(1400.0, 1.3)`, verify statics are set correctly
7. **`beats_rebuild_length`** — `rebuildBeats(stepCount)` returns exactly `stepCount` elements with beats[0].voice=1

### Integration Checks (browser, manual)

These require actual playback and cannot be automated without browser test infrastructure (Playwright — not installed):

- **BPM change mid-playback:** Start at 120 BPM, change to 200 BPM while playing. Verify: no burst of extra clicks, no skipped click at the transition, tempo stabilizes within one 100ms lookahead window.
- **Time-sig change (4/4 → 3/4):** Verify accent returns to beat 1 of each bar (not beat 2 or beat 4) immediately after change.
- **Subdivision change (quarter → 16th):** Verify click rate quadruples; all clicks audible without clipping.
- **BPM extremes:** Play at 20 BPM (3s between clicks) and 300 BPM (~5 clicks/s). No drift audible over 60 seconds.

### Nyquist Gaps (require human listening)

The following cannot be mechanically verified — they require a human ear:

- **Accent pitch distinctness:** 1400 Hz vs. 1000 Hz. The pitch difference is 40% — audible on any speaker. Human confirms: "beat 1 sounds higher than other beats."
- **Accent amplitude distinctness:** 1.0–1.5× amplitude. At 1.3× (default), the difference is mild; at 1.5× it is pronounced. Human confirms the default setting is perceptibly louder.
- **No audio artifacts at extreme BPMs:** 300 BPM at 16th subdivision = 1200 clicks/second (outside musical range but a stress test). Human confirms no dropout, pops, or ring overflow audible.
- **Smooth BPM change feel:** No jarring tempo jump during in-progress BPM change; the transition should feel musically natural.

### Wave 0 Gaps

- [ ] `rust/src/lib.rs` — add test functions: `step_interval_formula`, `accent_amplitude_differs`, `accent_pitch_differs`, `phase_inc_reset_on_normal`, `set_accent_params_roundtrip` (covers TIMING-01, TIMING-03, PATTERN-02)
- [ ] Vitest installation: `npm install --save-dev vitest` — needed for TypeScript unit tests of `defaultPatternState()`, `rebuildBeats()`, BPM clamping logic
- [ ] `vitest.config.ts` — minimal config pointing at `src/**/*.test.ts`
- [ ] `src/lib/pattern.test.ts` — covers `defaultPatternState`, `rebuildBeats`, BPM clamping

**Note on Vitest install:** Vitest is not in `package.json` devDependencies. The planner must include an install task in Wave 0 before any TypeScript unit tests can run. The slopcheck/legitimacy gate applies.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust + cargo | WASM DSP extension, cargo test | ✓ | stable (1.77+) | — |
| Node.js / npm | Vite dev server, Vitest (Wave 0) | ✓ | detected via package.json | — |
| Vitest | TypeScript unit tests | ✗ | Not installed | Skip TS unit tests (cargo tests still run) |
| Browser (Chrome macOS) | Integration / Nyquist manual tests | ✓ | assumed (Phase 2 passed PLATFORM-01) | — |

**Missing dependencies with no fallback:** None that block implementation.

**Missing dependencies with fallback:** Vitest absent — cargo tests cover the Rust DSP math; TS pattern-logic tests deferred until Vitest is installed in Wave 0.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Svelte 5 `$effect` re-runs on any deep read of `$state` object properties | Pattern 3, Pitfall P3-04 | If $effect only tracks shallow reads, changes to `pattern.tracks[0].beats` may not trigger updatePattern(); fix: use `$derived` or read individual fields explicitly inside $effect |
| A2 | `$effect` runs asynchronously after DOM update (not synchronously on assignment) | Pattern 3 | If $effect is synchronous, the 1–16ms latency claim is wrong (would be 0ms); not a correctness risk, only a comment-accuracy issue |
| A3 | Vitest 3.x is compatible with the installed Vite 8.x and Svelte 5.x versions | Validation Architecture | If incompatible, a different Vitest version is needed; check official Vitest ↔ Vite compatibility matrix before install |

**If this table is empty:** Not empty — A1 is the only significant risk and is easy to validate during Wave 0 testing.

---

## Open Questions

1. **How does the worklet deliver accent params from paramSAB to WASM?**
   - What we know: paramSAB slots 2 and 3 will hold accent_freq and accent_amp (written by main thread). The worklet holds `this._paramBuffer` (Int32Array over paramSAB).
   - What's unclear: The worklet currently passes only 3 args to `fill_output_buffer`. Option A: add a dedicated `set_accent_params(freq, amp)` WASM export called once at init + on change (worklet detects slot change by comparing previous values). Option B: pass slots 2 and 3 as args 4 and 5 to `fill_output_buffer` on every call (simple but adds 2 Atomics.load per quantum). Option C: WASM reads paramSAB directly (not possible — WASM cannot hold a reference to SAB; it must be passed explicitly).
   - Recommendation: **Option A** (set_accent_params export) for the init path. The worklet checks if slot 2 or 3 changed on each process() call and calls set_accent_params — but this adds an Atomics.load+compare each frame. Given that accent params change rarely, a lazy approach is fine. Alternatively: call set_accent_params from the worklet's `port.onmessage` handler when the main thread sends an "update-accent" message — cleaner, no per-frame overhead. The planner decides.

2. **Should `_barStep` be reset to 0 on BPM change (not just step count change)?**
   - What we know: `_barStep` is a bar position counter, independent of tempo.
   - What's unclear: At very fast BPM, `_barStep` wraps `Number.MAX_SAFE_INTEGER` only after ~285 million years at 300 BPM × 16th notes — not a practical concern.
   - Recommendation: No reset on BPM change. Reset only on step count change (Pitfall P3-02).

---

## Security Domain

This phase adds UI controls and paramSAB slots. No network requests, no server interaction, no user-uploaded data, no authentication. ASVS categories V2, V3, V4, V6 do not apply. V5 (Input Validation) applies minimally:

- BPM input is clamped to [20, 300] on blur/enter; non-numeric input is rejected. This is sufficient — the value never leaves the browser.
- Time signature numerator is clamped to [1, 12]; denominator is a fixed select (2|4|8|16).
- paramSAB slots accept only integer Hz and integer milliunits; WASM reads them as f32 after dividing — no overflow risk at the stated ranges.

No security-specific libraries are required for this phase.

---

## Sources

### Primary (HIGH confidence)

- `rust/src/lib.rs` — Actual current WASM implementation (Phase 2 complete); read directly
- `src/lib/audio-engine.ts` — Actual current scheduler; read directly
- `public/worklet/processor.js` — Actual current AudioWorklet; read directly
- `.planning/phases/03-timing-controls/03-CONTEXT.md` — Locked decisions D-01 through D-09
- `.planning/phases/02-first-click/02-CONTEXT.md` — Ring event encoding (D-04), fill_output_buffer signature (D-05)
- `.planning/phases/01-infrastructure/01-CONTEXT.md` — `#[no_mangle]` pattern (D-08), zero-alloc rule (D-11)
- `.planning/research/ARCHITECTURE.md` — SPSC ring pattern, lookahead scheduler pattern, paramSAB layout

### Secondary (MEDIUM confidence)

- `.planning/research/PITFALLS.md` — Background tab throttling (Pitfall 8), allocation in process() (Pitfall 4)
- CLAUDE.md technology stack section — confirmed Svelte 5, Vite 6, TypeScript, Vitest 3.x as the testing stack

### Tertiary (LOW confidence — assumptions)

- Svelte 5 `$effect` deep-tracking semantics (A1, A2) — based on training knowledge; should be confirmed against Svelte 5 docs before implementation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed and in use; no new packages
- Architecture: HIGH — direct read of working Phase 2 code; changes are incremental
- Step interval formula: HIGH — mathematically derived from locked decision D-08; verified by hand for 6 example combinations
- Pitfalls P3-01 to P3-05: HIGH — derived from direct code analysis of the scheduler loop and WASM DSP
- Svelte $effect semantics: MEDIUM — training knowledge, should be verified

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (stable ecosystem; no fast-moving dependencies)
