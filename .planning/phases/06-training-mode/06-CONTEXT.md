# Phase 6: Training Mode - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a training mode where the metronome plays a repeating cycle of bar types (normal / silent / skips) instead of continuous identical bars. The user configures how many normal bars and how many alt bars (silent or skips) appear per cycle, edits the skips bar's independent beat pattern, and sees a real-time cycle-strip indicator showing which bar type is currently active.

This phase does NOT change BPM controls, time signature, subdivision, accent parameters, noise gain, or click sound selection — those remain unchanged.

</domain>

<decisions>
## Implementation Decisions

### Cycle Shape
- **D-01:** A training cycle consists of N normal bars followed by M alt bars, where alt bar type is either "silent" OR "skips" (user picks one, not both simultaneously). All bars share the same BPM, time signature, subdivision, and denominator as the main pattern — no per-bar timing differences.
- **D-02:** Bar counts are configurable integers (minimum 1, maximum 32 each). Range enforced in UI inputs.

### Scheduler / AudioEngine Integration
- **D-03:** AudioEngine owns all training state internally: `_trainingEnabled: boolean`, `_normalBarCount: number`, `_altBarCount: number`, `_altType: 'silent' | 'skips'`, `_altBeats: BeatPosition[]`, `_barCount: number`. No external orchestration.
- **D-04:** `_barCount` is incremented each time `_barStep` wraps to 0 (bar boundary) inside `_schedulerTick()`. The current bar type is derived as: `const cyclePos = _barCount % (_normalBarCount + _altBarCount); type = cyclePos < _normalBarCount ? 'normal' : _altType`.
- **D-05:** Silent bars: the scheduler writes **no events** to the ring for all steps in a silent bar. The worklet produces silence by default when no events arrive — zero ring traffic.
- **D-06:** Skips bars: the scheduler uses `_altBeats[]` instead of `_beats[]` when computing the voice for each step. The step interval, step count, and denominator remain the same as the main pattern.
- **D-07:** `onBarTypeChange(type: 'normal' | 'silent' | 'skips', barIndex: number)` callback added to AudioEngine constructor (mirrors the existing `_onStateChange` pattern). Fired at each bar boundary from `_schedulerTick`. App.svelte binds it to a reactive `$state` variable for the indicator.
- **D-08:** Training state is reset (`_barCount = 0`) on `stop()` alongside the existing `_barStep = 0` reset, so the next `start()` begins the cycle at bar 0.

### UI Layout — Training Section
- **D-09:** A new "Training" section is added to App.svelte below the existing Pattern section. It contains:
  - A toggle (on/off) — when off, the section shows only the toggle.
  - When on: numeric inputs for normal bar count and alt bar count.
  - A radio/toggle for alt bar type: "Silent" | "Skips".
  - When alt type = "Skips": a collapsible "Skips pattern" sub-section with its own beat grid (same UI as the existing Pattern beat grid).
  - The cycle-strip indicator (see D-10).
- **D-10:** Cycle-strip indicator: a row of small labeled blocks representing each bar in the cycle. Normal bars show "N", silent bars show "S", skips bars show "K". The current bar is highlighted (filled background). Only visible when training mode is enabled AND the engine is running. Rendered in the Training section.
- **D-11:** The skips beat pattern is stored as `skipsPattern = $state<PatternState>(defaultPatternState())` in App.svelte, independent of the main `pattern` state. Its `tracks[0].beats` is what gets passed to `engine.setAltBeats()`.

### Engine API (new methods)
- **D-12:** `engine.setTrainingMode(enabled: boolean)` — enables/disables training mode. When disabled, engine behaves as today (continuous normal bars).
- **D-13:** `engine.setTrainingConfig(normalBars: number, altBars: number, altType: 'silent' | 'skips')` — updates cycle configuration. Safe to call while running (takes effect at next bar boundary).
- **D-14:** `engine.setAltBeats(beats: BeatPosition[])` — updates the skips beat array. Safe to call while running.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Implementation Files
- `src/lib/audio-engine.ts` — AudioEngine class; add `_barCount`, `_trainingEnabled`, `_normalBarCount`, `_altBarCount`, `_altType`, `_altBeats[]`, `onBarTypeChange` callback, and new methods (D-03 through D-14)
- `src/lib/pattern.ts` — `PatternState`, `BeatPosition`, `rebuildBeats()`, `defaultPatternState()` — skips pattern uses same types
- `src/App.svelte` — UI; add Training section with toggle, inputs, skips beat grid, cycle-strip indicator (D-09, D-10, D-11)
- `public/worklet/processor.js` — AudioWorklet processor; no changes needed (silent bars produce no events; skips bars use normal voice dispatch)

### Prior Phase Patterns
- `.planning/phases/03-timing-controls/` — established `$state` + `$effect` → `engine.updatePattern()` pattern; Training section follows the same reactive binding approach
- `.planning/phases/04-per-beat-patterns/` — beat grid UI component patterns, `cycleBeatVoice()` interaction model

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Beat grid markup (both `.beat-grid` single-row and `.beat-grid-2d` two-dimensional): can be composed directly for the skips pattern grid inside the Training section — no new component needed
- `rebuildBeats(stepCount, existingBeats?)` in `pattern.ts:65`: use to keep skips beats array in sync when time signature or subdivision changes (same call sites as the main pattern)
- `defaultPatternState()` in `pattern.ts:78`: initialise `skipsPattern` with this, same as `pattern`
- `_onStateChange` callback pattern in `audio-engine.ts:17`: `_onBarTypeChange` follows the same constructor-injection pattern
- Toggle (`<input type="checkbox" class="toggle">`) and section layout CSS already defined in App.svelte — reuse directly

### Established Patterns
- `_barStep` in `audio-engine.ts:27`: already wraps 0 → `_stepCount - 1`; bar boundary is detected when `_barStep % _stepCount === 0` at the **start** of a scheduler tick's while-loop iteration (before incrementing). Adding `_barCount++` at that point is the correct insertion site.
- Atomics-based paramSAB: no new SAB slots needed for training mode — bar-type is decided on the main thread, not the worklet thread.
- `$effect(() => { engine.updatePattern(pattern) })` pattern: add a parallel `$effect` for `engine.setAltBeats(skipsPattern.tracks[0].beats)` and another for `engine.setTrainingConfig(...)`.

### Integration Points
- `_schedulerTick()` at `audio-engine.ts:215`: insert bar-boundary detection and bar-type branching at the top of the while loop body
- `stop()` at `audio-engine.ts:132`: add `_barCount = 0` reset alongside existing `_barStep = 0`
- App.svelte constructor call for `new AudioEngine(callback)`: add `onBarTypeChange` as a second callback parameter
- `onTimeSigChange()` / `onSubdivisionChange()` in App.svelte: also call `rebuildBeats` on `skipsPattern` when step count changes (keep skips beats array length in sync)

</code_context>

<specifics>
## Specific Ideas

- User's mental model: the cycle strip is the primary feedback mechanism — they want to see "[N] [N] [S] [S]" with the current block highlighted, not just a text counter.
- The skips bar is identical to normal in all audio parameters except beat voice assignments — same BPM, same time signature, same subdivision. It's not a "different pattern" but a "same-length bar with different which-beats-play assignments."
- "Skips" terminology: the user calls it "skips" (not "mute" or "alt") — use this label in the UI.

</specifics>

<deferred>
## Deferred Ideas

- All three bar types in a single cycle (normal + silent + skips simultaneously) — user's phrasing was "silent/skips" (pick one); supporting all three in one cycle is a potential enhancement for a future phase.
- Per-bar-type sound selection (different click sound for skips vs. normal) — mentioned in MEMORY.md as a future settings panel item; not in scope here.
- Visual beat position indicator (flashing active beat cell) — separate deferred item from v2 roadmap.

</deferred>

---

*Phase: 6-training-mode*
*Context gathered: 2026-05-29*
