# Phase 6: Training Mode - Research

**Researched:** 2026-05-29
**Domain:** AudioEngine scheduler extension, PatternState isolation, Svelte 5 reactive UI, bar-boundary detection
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Cycle = N normal bars followed by M alt bars. Alt type is "silent" OR "skips" (one at a time). All bars share the same BPM, time sig, subdivision, denominator.
- **D-02:** Bar counts are integers 1–32. Enforced in UI inputs.
- **D-03:** AudioEngine owns all training state: `_trainingEnabled`, `_normalBarCount`, `_altBarCount`, `_altType`, `_altBeats[]`, `_barCount`.
- **D-04:** `_barCount` incremented when `_barStep` wraps to 0. Type = `cyclePos < _normalBarCount ? 'normal' : _altType`.
- **D-05:** Silent bars: scheduler writes NO events to the ring.
- **D-06:** Skips bars: scheduler uses `_altBeats[]` instead of `_beats[]`.
- **D-07:** `onBarTypeChange(type, barIndex)` callback fires at each bar boundary. App.svelte binds to `$state` var.
- **D-08:** `_barCount = 0` reset in `stop()` alongside `_barStep = 0`.
- **D-09:** Training section in App.svelte below Pattern section. Toggle (off = section collapses). When on: bar count inputs, "Silent | Skips" selector. When Skips: collapsible skips pattern grid. Cycle-strip indicator.
- **D-10:** Cycle-strip: row of small labeled blocks — "N" normal, "S" silent, "K" skips. Current bar highlighted. Visible only when training enabled AND engine running.
- **D-11:** `skipsPattern = $state<PatternState>(defaultPatternState())` in App.svelte. Independent of main `pattern`.
- **D-12:** `engine.setTrainingMode(enabled: boolean)`.
- **D-13:** `engine.setTrainingConfig(normalBars, altBars, altType)` — safe to call while running.
- **D-14:** `engine.setAltBeats(beats: BeatPosition[])` — safe to call while running.

### Claude's Discretion

None specified.

### Deferred Ideas (OUT OF SCOPE)

- All three bar types simultaneously (normal + silent + skips) in one cycle.
- Per-bar-type sound selection (different click sound for skips vs. normal).
- Visual beat position indicator (flashing active beat cell).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PATTERN-03 | Training mode: configurable cycle of normal/silent/skips bars for timing-feel practice | AudioEngine scheduler extension (D-03 through D-08), PatternState isolation for skipsPattern (D-11), Svelte $effect bindings (D-12 through D-14), cycle-strip indicator UI (D-09, D-10) |
</phase_requirements>

---

## Summary

This phase extends the existing AudioEngine scheduler with bar-boundary awareness and a three-value bar-type dispatch. The core mechanics are already partially implied by the current code: `_barStep` already wraps every `_stepCount` steps (confirmed by reading `audio-engine.ts`), so bar-boundary detection requires a single comparison at the top of each while-loop iteration — no structural refactor needed.

All training state lives in AudioEngine (`_barCount`, `_trainingEnabled`, `_normalBarCount`, `_altBarCount`, `_altType`, `_altBeats[]`). Three new public methods expose the configuration surface. The worklet (`processor.js`) requires zero changes — silent bars produce no ring events, so the worklet naturally outputs silence; skips bars use a different `beats` source but produce identical ring event format.

The UI follows the exact patterns already established in `App.svelte`: `$state` variables drive reactive inputs, `$effect` hooks call the engine methods, and the existing beat-grid markup is reused verbatim for the skips pattern. The cycle-strip indicator is the only genuinely new UI primitive — a statically-rendered row of blocks whose highlight position updates via the `onBarTypeChange` callback.

**Primary recommendation:** Implement in three parallel-capable tasks: (1) AudioEngine scheduler extension + new API methods, (2) Vitest unit tests for training logic, (3) Svelte UI changes. Tasks 1 and 3 can proceed in parallel only after the AudioEngine API shape is settled; tests can be written TDD-first against the API.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bar-type cycle computation | AudioEngine (main thread) | — | Scheduler owns all timing; bar-boundary is a scheduler event |
| Silent bar enforcement | AudioEngine `_schedulerTick()` | — | Ring-write suppression happens at the write site, not in the worklet |
| Skips bar beat dispatch | AudioEngine `_schedulerTick()` | — | Beat source selection is a scheduler decision; worklet is event-agnostic |
| Bar-boundary notification | AudioEngine → App.svelte callback | — | Mirrors existing `_onStateChange` pattern; no worklet involvement needed |
| Training config storage | App.svelte `$state` | AudioEngine private fields | UI owns user-visible state; engine owns runtime-operative state |
| Skips pattern state | App.svelte `skipsPattern` | — | PatternState shape identical to main pattern; independent $state instance |
| Cycle-strip indicator | App.svelte UI | — | Pure display; updates driven by `onBarTypeChange` callback |
| WorkletNode | No changes | — | Voice dispatch is format-identical for normal and skips bars |

---

## Standard Stack

No new packages are required. This phase uses only existing project dependencies.

### Core (existing — verified in codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte 5 | `^5.55.5` [VERIFIED: package.json] | Component UI, `$state`/`$effect` reactivity | Already in use; runes model maps directly to training state |
| TypeScript | `~6.0.2` [VERIFIED: package.json] | Type safety for new engine API | Already in use; strict types for `_altType: 'silent' \| 'skips'` union prevent dispatch errors |
| Vitest | `^4.1.6` [VERIFIED: package.json] | Unit tests for training logic | Already in use; `environment: node` config works for pure scheduler logic |

### Supporting (existing)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pattern.ts` (project module) | n/a | `PatternState`, `BeatPosition`, `rebuildBeats()` | `skipsPattern` uses same types; no new types needed |

### Alternatives Considered
None — all locked decisions use existing stack.

**Installation:** No new packages.

---

## Package Legitimacy Audit

No external packages are being installed in this phase.

**Packages removed due to slopcheck:** none
**Packages flagged as suspicious:** none

---

## Architecture Patterns

### System Architecture Diagram

```
App.svelte
  ├── $state: trainingEnabled, normalBarCount, altBarCount, altType
  ├── $state: skipsPattern (PatternState)
  ├── $state: currentBarType, currentBarIndex   ← updated by onBarTypeChange callback
  │
  ├── $effect → engine.setTrainingMode(trainingEnabled)
  ├── $effect → engine.setTrainingConfig(normalBarCount, altBarCount, altType)
  ├── $effect → engine.setAltBeats(skipsPattern.tracks[0].beats)
  │
  └── AudioEngine
        ├── _trainingEnabled, _normalBarCount, _altBarCount, _altType, _altBeats[]
        ├── _barCount                ← incremented at bar boundary in _schedulerTick()
        │
        └── _schedulerTick() [25ms interval]
              ├── while (nextBeatTime < currentTime + lookahead):
              │     ├── if _barStep % _stepCount === 0:   ← bar boundary
              │     │     _barCount++
              │     │     derive cyclePos, barType
              │     │     fire onBarTypeChange(barType, _barCount)
              │     │
              │     ├── if barType === 'silent':
              │     │     skip ring write, advance _nextBeatTime + _barStep only
              │     ├── if barType === 'skips':
              │     │     use _altBeats[stepIndex] for voice
              │     │     write ring event (same format)
              │     └── if barType === 'normal':
              │           use _beats[stepIndex] for voice
              │           write ring event (same format)
              │
              └── AudioWorkletProcessor (unchanged)
                    └── reads ring, calls fill_output_buffer(offset, voice, noiseGain)
```

### Recommended Project Structure

No new files are strictly required. All changes are concentrated in:

```
src/
├── lib/
│   ├── audio-engine.ts    ← extend with training state + 3 new methods
│   └── pattern.ts         ← no changes needed (types already support this)
├── App.svelte             ← add Training section (~100 lines)
└── lib/
    └── audio-engine.test.ts  ← NEW: Wave 0 test file for training logic
```

The existing `vitest.config.ts` `include` pattern (`src/**/*.test.ts`) will automatically pick up the new test file.

---

### Pattern 1: Bar-Boundary Detection in `_schedulerTick()`

**What:** Detect when `_barStep` wraps to 0 at the start of each while-loop iteration to trigger bar-type selection and the `onBarTypeChange` callback.
**When to use:** The only correct insertion point is at the TOP of the while loop body, before the voice lookup.

```typescript
// Source: audio-engine.ts:215 (existing while loop structure)
while (this._nextBeatTime < this._audioCtx.currentTime + lookahead) {
  // BAR BOUNDARY DETECTION — insert here (before stepIndex computation)
  if (this._trainingEnabled && this._barStep % this._stepCount === 0) {
    const cycleLen = this._normalBarCount + this._altBarCount;
    const cyclePos = this._barCount % cycleLen;
    const barType: 'normal' | 'silent' | 'skips' =
      cyclePos < this._normalBarCount ? 'normal' : this._altType;
    this._onBarTypeChange?.(barType, this._barCount);
    this._barCount++;
    // Cache barType for remainder of this bar — see Pattern 2
  }

  const stepIndex = this._barStep % this._stepCount;
  // ... rest of existing scheduler logic
}
```

**Critical detail:** `_barCount` must be incremented AFTER the callback fires, so `barIndex` reported to the UI matches the bar being entered (0-indexed). The `cyclePos` computation uses `_barCount` before increment.

---

### Pattern 2: Bar-Type Caching Across Steps

**What:** The bar type must be consistent across all steps within a bar. Computing it per-step from `_barCount` is safe because `_barCount` only increments at bar boundaries, but requires `_barCount` to reflect "the bar currently playing" throughout. The increment-after-callback approach above achieves this.

**When to use:** Silent-bar suppression and skips-beats selection both read the current bar type for every step of the bar.

```typescript
// Source: [ASSUMED] — derived from audio-engine.ts existing structure
// _currentBarType is a private field set at bar boundary, read per-step
private _currentBarType: 'normal' | 'silent' | 'skips' = 'normal';

// At bar boundary:
this._currentBarType = barType;

// Per-step:
if (!this._trainingEnabled || this._currentBarType !== 'silent') {
  const voice = (this._currentBarType === 'skips')
    ? (this._altBeats[stepIndex]?.voice ?? 0)
    : (this._beats[stepIndex]?.voice ?? 0);
  // ... write ring event
}
```

**Why cache:** Avoids recomputing `_barCount % cycleLen` on every step. More importantly, it ensures that if `_barCount` changes unexpectedly (though it shouldn't mid-bar), steps don't split across bar types.

---

### Pattern 3: Svelte 5 `$effect` Binding for Training Config

**What:** Three `$effect` blocks wire the UI state to the engine API, following the exact pattern established by `engine.updatePattern(pattern)`.
**When to use:** All training-related engine calls.

```typescript
// Source: App.svelte:40 (existing $effect pattern)
$effect(() => {
  engine.setTrainingMode(trainingEnabled)
})

$effect(() => {
  engine.setTrainingConfig(normalBarCount, altBarCount, altType)
})

$effect(() => {
  engine.setAltBeats(skipsPattern.tracks[0].beats)
})
```

**Important:** The `skipsPattern.tracks[0].beats` dependency will be tracked automatically by Svelte 5 runes because `skipsPattern` is a `$state` — mutations to individual beat voices (via `cycleSkipsBeatVoice(i)`) trigger the effect.

---

### Pattern 4: `onBarTypeChange` Callback Binding in Constructor

**What:** Second callback parameter added to `AudioEngine` constructor, following the `_onStateChange` pattern (line 17 of audio-engine.ts).
**When to use:** App.svelte passes the callback at construction time.

```typescript
// Source: audio-engine.ts:29 (constructor, existing pattern)
// New constructor signature:
constructor(
  onStateChange?: (state: AudioEngineState) => void,
  onBarTypeChange?: (type: 'normal' | 'silent' | 'skips', barIndex: number) => void,
) {
  this._onStateChange = onStateChange ?? null;
  this._onBarTypeChange = onBarTypeChange ?? null;
}
```

In App.svelte:
```typescript
// Source: App.svelte:10 (existing engine construction)
let currentBarType = $state<'normal' | 'silent' | 'skips'>('normal')
let currentBarIndex = $state(0)

const engine = new AudioEngine(
  (state) => { engineState = state },
  (type, barIndex) => {
    currentBarType = type
    currentBarIndex = barIndex
  }
)
```

---

### Pattern 5: skipsPattern Sync on Time Sig / Subdivision Change

**What:** When `onTimeSigChange()` or `onSubdivisionChange()` rebuild the main pattern's beats, they must also rebuild `skipsPattern.tracks[0].beats` to keep step counts in sync.
**When to use:** Both handlers in App.svelte.

```typescript
// Source: App.svelte:94 (existing onTimeSigChange)
function onTimeSigChange() {
  const subdivMult = SUBDIV_MULT[pattern.tracks[0].subdivision]
  const stepCount = numerator * subdivMult
  pattern.tracks[0].stepCount = stepCount
  pattern.tracks[0].beats = rebuildBeats(stepCount, pattern.tracks[0].beats)
  // ADD: keep skips pattern in sync
  skipsPattern.tracks[0].stepCount = stepCount
  skipsPattern.tracks[0].beats = rebuildBeats(stepCount, skipsPattern.tracks[0].beats)
}
```

**Why:** If stepCount drifts, `_altBeats[stepIndex]` will index out of bounds on some steps (returns `undefined`, falls back to `voice = 0` via `?? 0` — not a crash, but incorrect behavior for steps beyond the old length).

---

### Pattern 6: Cycle-Strip Indicator Rendering

**What:** A static row of blocks rendered from the cycle config, with the active bar highlighted based on `currentBarIndex % cycleLength`.
**When to use:** Visible only when `trainingEnabled && engineState === 'running'`.

```svelte
<!-- Source: [ASSUMED] — derived from existing beat-grid pattern in App.svelte -->
{#if trainingEnabled && engineState === 'running'}
  <div class="cycle-strip">
    {#each Array.from({length: normalBarCount + altBarCount}, (_, i) => i) as i}
      {@const label = i < normalBarCount ? 'N' : (altType === 'skips' ? 'K' : 'S')}
      {@const isActive = (currentBarIndex % (normalBarCount + altBarCount)) === i}
      <span class="cycle-block {isActive ? 'cycle-block-active' : ''}">{label}</span>
    {/each}
  </div>
{/if}
```

---

### Anti-Patterns to Avoid

- **Computing bar type per-step from `_barCount`:** Causes a race if `_barCount` is ever modified outside `_schedulerTick`. Cache `_currentBarType` at bar boundary.
- **Firing `onBarTypeChange` from the first step of the cycle before `_barCount` is initialized:** The detection `this._barStep % this._stepCount === 0` is true on step 0 of the very first bar. `_barCount` is 0 at that point, which is correct — bar index 0 is the first bar. No special-casing needed.
- **Resetting `_barCount` on pattern changes mid-playback:** The CONTEXT.md specifies only `stop()` resets `_barCount`. Resetting it inside `updatePattern()` would interrupt the cycle mid-practice. Do NOT add a `_barCount = 0` to `updatePattern()`.
- **Resetting `_barCount` when training mode is toggled while running:** D-12 says `setTrainingMode(enabled)` is safe to call while running. If enabled is toggled off then on, the bar count should reset at the next `stop()` only, not at the toggle. This allows re-enabling training without disrupting playback.
- **Passing `skipsPattern` to `engine.updatePattern()`:** `skipsPattern` is NOT the main pattern. Only `_altBeats` (the beats array extracted from `skipsPattern`) is passed to the engine. `engine.updatePattern()` takes the main `pattern` only.
- **Using `postMessage` to communicate bar type to worklet:** Bar-type selection is entirely main-thread. The worklet has no concept of bars — it only receives beat events or silence (ring empty). No new message types needed in `processor.js`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bar count clamping UI | Custom validation component | `onNumeratorInput` pattern (App.svelte:101) | Identical pattern: parse int, `Math.max(1, Math.min(32, val))`, revert input display |
| Skips beat grid UI | New grid component | Existing `.beat-grid` / `.beat-grid-2d` CSS + markup (App.svelte:261-300) | Identical layout; compose directly |
| Alt type selector | Custom radio component | Existing `.subdiv-group` button group CSS (App.svelte:498-525) | Two options (Silent/Skips) fit the pill-group pattern exactly |
| Training toggle | Custom toggle component | Existing `.toggle` checkbox CSS (App.svelte:557-589) | Already styled and accessible |
| PatternState for skips | New type | `defaultPatternState()` from `pattern.ts` | Types already cover this; only voice values differ |

**Key insight:** The entire Training section UI can be assembled from existing CSS classes and event handler patterns. No new CSS primitives are needed; only new markup structure and `$state` variables.

---

## Common Pitfalls

### Pitfall 1: Bar Boundary Fire on First Step vs. Step 0

**What goes wrong:** `_barStep % _stepCount === 0` is true at `_barStep = 0` (before the first tick increments it). The first bar's `onBarTypeChange` fires with `barIndex = 0`, which is correct behavior — but if `_barCount` is already 0, the callback fires correctly on the first step of the first bar.

**Why it happens:** The existing scheduler increments `_barStep` at the END of the while-loop body (line 245 of audio-engine.ts), not the beginning. So `_barStep` is 0 entering the first iteration.

**How to avoid:** Insert bar-boundary detection at the TOP of the while-loop body, before `stepIndex` computation. The detection reads `this._barStep % this._stepCount === 0`, which is true for `_barStep = 0, _stepCount, 2*_stepCount, ...`. This is exactly the correct bar-boundary set.

**Warning signs:** If `onBarTypeChange` never fires on the first bar, the detection is placed after `_barStep++` (wrong location).

---

### Pitfall 2: `_barStep` Resets Resetting `_barCount` Inconsistency

**What goes wrong:** `updatePattern()` resets `_barStep = 0` when `stepCount` changes (audio-engine.ts:172). This means a time-sig change mid-training resets `_barStep` to 0 but NOT `_barCount`. On the next tick, `_barStep % _stepCount === 0` is again true — triggering `onBarTypeChange` immediately, as if a new bar is starting. This is actually correct: a step-count change mid-bar is equivalent to starting a new bar.

**Why it happens:** No bug — the behavior is correct. But it must be understood: `_barCount` continues from where it was (not reset), and the bar-type callback fires at the "new bar" that starts from the reset `_barStep`. Document this so the planner doesn't add an unneeded `_barCount = 0` to `updatePattern()`.

**How to avoid:** Do not add `_barCount = 0` to `updatePattern()`. Only `stop()` resets it (D-08).

---

### Pitfall 3: Training Disabled Mid-Playback — Stale `_currentBarType`

**What goes wrong:** If training is disabled via `setTrainingMode(false)` while `_currentBarType` is `'silent'`, the scheduler would continue suppressing ring writes until the next bar boundary resets it. But if training is disabled, bar boundaries are never detected.

**Why it happens:** `_currentBarType` is only updated at bar boundaries when `_trainingEnabled` is true.

**How to avoid:** `setTrainingMode(false)` must also reset `_currentBarType = 'normal'` so normal ring writes resume immediately. Alternatively, the per-step silent-suppression check can be: `if (this._trainingEnabled && this._currentBarType === 'silent')` — which naturally stops suppressing when `_trainingEnabled` is false.

---

### Pitfall 4: skipsPattern Step Count Drift

**What goes wrong:** If `onSubdivisionChange` rebuilds the main pattern from 4 steps to 8 steps but does NOT rebuild `skipsPattern`, `_altBeats` has length 4 while `_stepCount` is 8. Steps 4–7 of skips bars return `voice = 0` (normal) instead of the user-configured voice. Silently wrong behavior.

**Why it happens:** Two independent `PatternState` objects with no automatic coupling.

**How to avoid:** Both `onTimeSigChange()` and `onSubdivisionChange()` in App.svelte must call `rebuildBeats` on `skipsPattern` as well as `pattern` (Pattern 5 above). Add `engine.setAltBeats(skipsPattern.tracks[0].beats)` via `$effect` — the effect will fire automatically after the state mutation.

---

### Pitfall 5: Cycle-Strip Index Wrapping

**What goes wrong:** After `normalBarCount + altBarCount` bars, `_barCount` is `cycleLen`. The cycle-strip highlights based on `currentBarIndex % cycleLen`. If the component uses `currentBarIndex` directly (without modulo), only bars 0 through `cycleLen - 1` are ever highlighted; subsequent cycles appear to have no active bar.

**Why it happens:** `_barCount` is cumulative; it never resets except on `stop()`.

**How to avoid:** Always compute `activeSlot = currentBarIndex % (normalBarCount + altBarCount)` in the template. This is shown in Pattern 6 above.

---

### Pitfall 6: `onBarTypeChange` Closure Captures Stale `barCount` in Svelte

**What goes wrong:** The engine is constructed once in App.svelte. The `onBarTypeChange` callback is defined at construction time. The callback closure correctly assigns to `currentBarType` and `currentBarIndex` Svelte `$state` variables — but only if those variables are declared BEFORE `new AudioEngine(...)` is called (Svelte 5 requires `$state` declarations to be hoisted to the component scope).

**Why it happens:** JavaScript closure timing — the callback captures the variable reference, not the value. This is correct for `$state` proxies, but only if the variables are initialized before the callback is registered.

**How to avoid:** Declare `currentBarType` and `currentBarIndex` as `$state` before the `new AudioEngine(...)` call. This is already the pattern for `engineState` in the current code (line 8 before line 10 in App.svelte).

---

## Code Examples

### Scheduler Tick Extension (AudioEngine core change)

```typescript
// Source: audio-engine.ts:215 — annotated insertion points [ASSUMED: exact structure]
// Additions shown with // +++ comments

// New private fields:
// +++ private _trainingEnabled: boolean = false;
// +++ private _normalBarCount: number = 2;
// +++ private _altBarCount: number = 2;
// +++ private _altType: 'silent' | 'skips' = 'silent';
// +++ private _altBeats: BeatPosition[] = [];
// +++ private _barCount: number = 0;
// +++ private _currentBarType: 'normal' | 'silent' | 'skips' = 'normal';
// +++ private _onBarTypeChange: ((type: 'normal' | 'silent' | 'skips', barIndex: number) => void) | null;

private _schedulerTick(): void {
  if (!this._audioCtx || !this._controlRingIndices || !this._controlRingData) return;

  const sampleRate = this._audioCtx.sampleRate;
  const lookahead = 0.1;

  while (this._nextBeatTime < this._audioCtx.currentTime + lookahead) {
    // +++ BAR BOUNDARY DETECTION
    // +++ _barStep is 0 at start of first bar and after each _stepCount steps.
    if (this._trainingEnabled && this._barStep % this._stepCount === 0) {
      const cycleLen = this._normalBarCount + this._altBarCount;
      const cyclePos = this._barCount % cycleLen;
      this._currentBarType = cyclePos < this._normalBarCount ? 'normal' : this._altType;
      this._onBarTypeChange?.(this._currentBarType, this._barCount);
      this._barCount++;
    }

    const stepIndex = this._barStep % this._stepCount;

    // +++ SILENT BAR: skip ring write entirely
    if (this._trainingEnabled && this._currentBarType === 'silent') {
      this._nextBeatTime += this._stepInterval;
      this._barStep++;
      continue;
    }

    // +++ SKIPS BAR: use _altBeats; NORMAL or training-disabled: use _beats
    const beats = (this._trainingEnabled && this._currentBarType === 'skips')
      ? this._altBeats
      : this._beats;
    const voice = beats[stepIndex]?.voice ?? 0;

    // ... existing ring-write logic unchanged ...
    const beatSampleAbs = this._nextBeatTime * sampleRate;
    const quantumIndex  = Math.floor(beatSampleAbs / 128);
    const sampleOffset  = Math.min(Math.round(beatSampleAbs % 128), 127);
    const event = (sampleOffset & 0x7F) | ((voice & 0x1F) << 7) | ((quantumIndex & 0xFFFFF) << 12);
    const writeIdx  = Atomics.load(this._controlRingIndices, 1);
    const nextWrite = (writeIdx + 1) & 0xFF;
    if (nextWrite !== Atomics.load(this._controlRingIndices, 0)) {
      this._controlRingData[writeIdx] = event;
      Atomics.store(this._controlRingIndices, 1, nextWrite);
    }

    this._nextBeatTime += this._stepInterval;
    this._barStep++;
  }
}
```

### New Public Methods

```typescript
// Source: [ASSUMED] — follows existing setNoiseGain() pattern in audio-engine.ts

setTrainingMode(enabled: boolean): void {
  this._trainingEnabled = enabled;
  if (!enabled) {
    // Immediately restore normal playback — do not wait for next bar boundary
    this._currentBarType = 'normal';
  }
}

setTrainingConfig(normalBars: number, altBars: number, altType: 'silent' | 'skips'): void {
  this._normalBarCount = Math.max(1, Math.min(32, normalBars));
  this._altBarCount = Math.max(1, Math.min(32, altBars));
  this._altType = altType;
}

setAltBeats(beats: BeatPosition[]): void {
  this._altBeats = beats;
}
```

### App.svelte Training Section State

```typescript
// Source: App.svelte:8-15 (existing $state pattern) [ASSUMED: exact additions]

let trainingEnabled = $state(false)
let normalBarCount = $state(2)
let altBarCount = $state(2)
let altType = $state<'silent' | 'skips'>('silent')
let skipsPattern = $state<PatternState>(defaultPatternState())
let currentBarType = $state<'normal' | 'silent' | 'skips'>('normal')
let currentBarIndex = $state(0)
// skipsSubdivPerBeat is derived from skipsPattern subdivision — same as subdivPerBeat
// but independent so skips grid renders correctly even if subdivisions ever diverge
const skipsSubdivPerBeat = $derived(SUBDIV_MULT[skipsPattern.tracks[0].subdivision] ?? 1)
```

### Bar Count Input Handler

```typescript
// Source: App.svelte:101 (onNumeratorInput pattern) [ASSUMED: adaptation]

function onNormalBarCountInput(e: Event) {
  const input = e.target as HTMLInputElement
  const val = parseInt(input.value, 10)
  if (!isNaN(val)) {
    normalBarCount = Math.max(1, Math.min(32, val))
  }
  input.value = String(normalBarCount)
}

function onAltBarCountInput(e: Event) {
  const input = e.target as HTMLInputElement
  const val = parseInt(input.value, 10)
  if (!isNaN(val)) {
    altBarCount = Math.max(1, Math.min(32, val))
  }
  input.value = String(altBarCount)
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Continuous identical bars | Training cycle mode (N normal + M alt) | Phase 6 | AudioEngine now tracks bar-level state |
| Single beats source (`_beats`) | Dual beats source (`_beats` vs `_altBeats`) | Phase 6 | Scheduler selects source per-bar |
| Single PatternState in App.svelte | Two PatternState instances (`pattern` + `skipsPattern`) | Phase 6 | Both sync step count on time sig changes |

**Deprecated/outdated:** Nothing deprecated. Phase 6 is purely additive.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `_barStep % _stepCount === 0` is the correct bar-boundary condition for the existing scheduler structure | Pitfall 1, Pattern 1 | If `_barStep` is ever pre-incremented before the detection point, the first step of each bar would be missed — off-by-one in cycle. Verify exact position of `_barStep++` (confirmed line 245, AFTER the ring write, so detection at top of while body is correct). |
| A2 | `_currentBarType` private field is the cleanest way to carry bar type across steps | Pattern 2 | Alternative: recompute from `_barCount` each step. Both are correct; caching is slightly more readable and avoids repeated modulo. |
| A3 | `setTrainingMode(false)` resetting `_currentBarType = 'normal'` is the correct recovery path | Pitfall 3 | If the silent-suppression check is `this._trainingEnabled && ...`, the reset is unnecessary. Both approaches work; the `$effect` triggers immediately on toggle. |
| A4 | `skipsPattern` does NOT need to mirror `accentFreqHz`/`accentAmpMillis` from the main pattern | Architecture | These are global parameters in `PatternState` but only used by `updatePattern()` on the main pattern. `skipsPattern` accent fields will be ignored — initialized to defaults by `defaultPatternState()`. If future phases want per-bar-type accent, this will need revisiting. |
| A5 | The cycle-strip indicator renders a maximum of 64 blocks (32 + 32) without performance concern | Architecture | 64 small `<span>` elements re-rendering on each `onBarTypeChange` is negligible. At fast tempos (300 BPM, quarter subdivisions), bar boundaries arrive every 4 × 0.2s = 0.8s — well within Svelte's rendering capacity. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

---

## Open Questions

1. **`skipsPattern` subdivision independence**
   - What we know: `skipsPattern` is a full `PatternState` with its own `subdivision` field. The CONTEXT says all bars share the same BPM, time sig, subdivision, denominator (D-01).
   - What's unclear: Should `skipsPattern.tracks[0].subdivision` be kept in sync with `pattern.tracks[0].subdivision`, or is it safe to leave it at the `defaultPatternState()` default and only sync `stepCount` + `beats`?
   - Recommendation: Sync `subdivision` and `denominator` in `onSubdivisionChange` and `onDenominatorChange` alongside `stepCount` + `beats`. The engine only uses `_altBeats[]` (not the full PatternState), so it doesn't matter for audio correctness, but it keeps `skipsSubdivPerBeat` correct for the 2D grid layout.

2. **Bar type during training-disabled playback**
   - What we know: When `trainingEnabled = false`, the engine ignores training state and `_currentBarType` defaults to `'normal'`.
   - What's unclear: What bar type does `onBarTypeChange` report when training is disabled? It should not fire at all.
   - Recommendation: Gate the entire bar-boundary block on `this._trainingEnabled` (Pattern 1 already does this). When training is disabled, `onBarTypeChange` never fires, and `currentBarType` in App.svelte retains its last value from the previous session — harmless since the cycle-strip is hidden when `!trainingEnabled`.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code changes to existing TypeScript and Svelte files. No new external tools, services, runtimes, or CLI utilities are required beyond those already used by the project.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run src/lib/audio-engine.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PATTERN-03 | `setTrainingMode(true)` enables bar-type cycling | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 |
| PATTERN-03 | Silent bars produce no ring events | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 |
| PATTERN-03 | Skips bars use `_altBeats` instead of `_beats` | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 |
| PATTERN-03 | `onBarTypeChange` fires at correct bar boundaries | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 |
| PATTERN-03 | `_barCount` resets on `stop()` | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 |
| PATTERN-03 | Cycle wraps correctly after `normalBars + altBars` | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 |
| PATTERN-03 | skipsPattern step count syncs on time sig change | unit | `npx vitest run src/lib/pattern.test.ts` | patially ✅ (rebuildBeats tests cover the function; sync call-site tests go in audio-engine.test.ts) |
| PATTERN-03 | Training toggle off restores normal playback immediately | manual | Play, enable training (silent), toggle off mid-bar — clicks resume | — |
| PATTERN-03 | Cycle-strip indicator shows correct active block | manual | Enable training 2N+2S, play — strip highlight advances each bar | — |

**Note on testability:** `AudioEngine` has private state and uses `AudioContext` + `setInterval`. Pure training-logic tests require either (a) extracting the scheduler logic into a testable pure function, or (b) mocking `AudioContext` and controlling time. The existing test file (`pattern.test.ts`) tests pure functions only. The recommended approach for Wave 0 is to extract the cycle-position calculation as a pure exported function in `audio-engine.ts` (e.g., `computeBarType(barCount, normalBars, altBars, altType)`), then test that function directly.

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green (27 existing + new training tests) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/audio-engine.test.ts` — covers PATTERN-03 training logic
  - Extract `computeBarType(barCount, normalBars, altBars, altType)` as a pure exported helper
  - Tests: normal/silent/skips selection, cycle wrap, boundary at zero, single-bar cycles
- [ ] Framework install: none needed — Vitest already configured

*(No gaps in existing test infrastructure — only missing test file for new functionality)*

---

## Security Domain

This phase adds no authentication, no network requests, no storage, no cryptography, and no user-uploaded content. It is purely client-side UI state + audio scheduler logic. ASVS categories V2–V6 do not apply.

---

## Sources

### Primary (HIGH confidence)
- `src/lib/audio-engine.ts` — Full source read; scheduler structure, `_barStep` increment location (line 245), `stop()` reset pattern (line 149), `_onStateChange` callback pattern (line 17, 31) verified directly.
- `src/lib/pattern.ts` — Full source read; `PatternState`, `BeatPosition`, `rebuildBeats()`, `defaultPatternState()` verified directly.
- `src/App.svelte` — Full source read; `$state`/`$effect` patterns, `onTimeSigChange`/`onSubdivisionChange` call sites, beat-grid markup, toggle CSS verified directly.
- `public/worklet/processor.js` — Full source read; confirmed no changes needed (ring event format is voice-agnostic; silent bars need only empty ring).
- `.planning/phases/06-training-mode/06-CONTEXT.md` — All decisions D-01 through D-14 read and reflected in research.
- `vitest.config.ts` — Read directly; `environment: node`, `include: ['src/**/*.test.ts']`.
- `src/lib/pattern.test.ts` — Read directly; 27 tests, all passing.

### Secondary (MEDIUM confidence)
- `package.json` — Versions of Svelte (5.55.5), TypeScript (6.0.2), Vite (8.0.12), Vitest (4.1.6) confirmed via grep.
- `cargo test` output — 21 Rust tests passing, unaffected by this phase.
- `npx vitest run` output — 27 JS tests passing, baseline confirmed.

### Tertiary (LOW confidence)
- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all existing versions confirmed from package.json
- Architecture: HIGH — full source read of all 4 key files; insertion points identified with line numbers
- Pitfalls: HIGH — derived from direct code analysis of `_barStep` increment timing, `updatePattern` reset paths, and Svelte 5 `$state` closure behavior
- Test strategy: MEDIUM — AudioEngine testability requires extracting a pure helper; approach is sound but exact test structure is [ASSUMED]

**Research date:** 2026-05-29
**Valid until:** 2026-06-29 (stable project; no external dependencies)
