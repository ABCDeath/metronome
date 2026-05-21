# Phase 4: Per-Beat Patterns and White Noise - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a per-beat sound palette grid (each step independently assignable to Normal click, Accent click, or Silent) and a continuous white noise mix slider (0–100%). The beat grid replaces the hardcoded "beat 1 = accent, rest = normal" default with full user control. White noise runs unconditionally on every audio frame — including the silence between clicks — to keep power-saving OTG adapters and wireless headphones awake at low tempos. Phase ends when: the grid is interactive, step assignments persist correctly across pattern changes, and the noise slider is audible and smoothly adjustable during playback.

</domain>

<decisions>
## Implementation Decisions

### Beat Grid UI Interaction
- **D-01:** Each beat cell is a clickable button. Clicking cycles the assignment forward through the palette: **Normal → Accent → Silent → Normal** (wraps). No mode selector, no right-click menu. Simple cycle pattern works on desktop and Android touch.
- **D-02:** The grid is a row of N buttons (one per step in the current pattern). Each button displays the current voice label or icon. The grid updates dynamically when step count changes (subdivision/time-sig change).

### Sound Palette Model
- **D-03:** Phase 4 introduces a **palette model** rather than named note types. Each beat position holds a voice index (integer) that indexes into the available sound palette. The palette for Phase 4 is: `0 = Normal click` (1000 Hz, 0.75 amp), `1 = Accent click` (1400 Hz, 1.3× amp — uses existing ACCENT_FREQ/ACCENT_AMP statics), `2 = Silent` (beat event fires so bar position advances, but no click is synthesized).
- **D-04:** No new DSP types are added (no ghost, no new click character). The palette reuses the two click sounds already built in Phases 2–3. The model is extensible: future phases add more palette entries (new DSP sounds, user-loaded WAV/MP3) without changing the data shape.
- **D-05:** The Phase 3 global accent controls (pitch toggle, amplitude toggle, amplitude slider) remain unchanged. They define the DSP character of the `Accent` palette option — they are now "Accent sound settings" rather than a per-bar override.
- **D-06:** Default beat assignments: beat 0 = Accent (voice 1), all other beats = Normal (voice 0). Same default as Phase 3 — preserves existing behavior when the user hasn't customised anything.

### Step Count Change Policy
- **D-07:** When step count changes (subdivision or time-sig change), **preserve existing assignments** for positions that still exist; fill new positions with Normal (voice 0). Example: [Accent, Normal, Silent, Normal] → 8 steps becomes [Accent, Normal, Silent, Normal, Normal, Normal, Normal, Normal]. If step count shrinks, truncate from the right.
- **D-08:** `rebuildBeats()` in `pattern.ts` must be updated (or a new overload added) to accept an optional `existingBeats` parameter. When provided, it merges existing assignments into the new length rather than resetting. The standalone `rebuildBeats(stepCount)` call path (used on first init) retains its default behaviour.

### White Noise — Delivery and Behaviour
- **D-09:** White noise `noise_gain` is communicated via **paramSAB slot 4** (integer = gain × 1000, same encoding as `accentAmpMillis`). The worklet reads it atomically on every `process()` call and passes it to `fill_output_buffer`. This is the right approach because noise is continuous — it must be current on every ~2.9ms frame, not triggered by events.
- **D-10:** White noise runs **unconditionally on every `process()` frame**, regardless of whether a beat event fires. The Rust `fill_output_buffer` function generates xorshift32 PRNG noise and mixes it into the output buffer on every call, scaled by `noise_gain`. It is NOT gated on click synthesis.
- **D-11:** Use case: continuous white noise keeps power-saving OTG adapters and wireless headphones from entering their silent-gap cutoff mode, which swallows clicks at slow tempos (40–50 BPM). A small amount of noise (e.g., 5–10% on the mix slider) is inaudible to the user but keeps the output stream active.
- **D-12:** Mix slider range: 0–100%. 0% = absolutely no noise added (audio output during silence is digital silence). At 0% the xorshift32 PRNG call is still made but multiplied by 0, so there is no branch in the hot path.
- **D-13:** Silent beats (voice 2) do not synthesize a click but still receive the noise contribution from D-10. The noise output is the same regardless of beat voice.

### Silent Voice Implementation
- **D-14:** Voice 2 = silent. In Rust `fill_output_buffer`, the trigger block (the `if sample_offset != NO_BEAT_SENTINEL` branch) adds a third branch: `voice == 2` → no envelope trigger, do not set ACTIVE. The noise mixing path (D-10) is outside this branch and runs unconditionally.
- **D-15:** The ring event voice field (bits 7–11, 5 bits) already supports 0–31. Voice 2 fits without any ring protocol change.

### Claude's Discretion
- Exact Svelte component structure for the beat grid (inline in App.svelte or extracted to a component)
- Visual styling of the three beat states on the grid buttons (colour, label text, or icon)
- Whether the noise slider appears in the existing controls panel or in its own section
- xorshift32 PRNG seed and state management inside Rust (static mut, same pattern as other statics)
- Whether to add a Vitest test for the updated `rebuildBeats()` merge behaviour

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, technology stack decisions
- `.planning/REQUIREMENTS.md` — Phase 4 requirements: PATTERN-01, AUDIO-02
- `.planning/ROADMAP.md` §Phase 4 — Success criteria and phase goal

### Prior Phase Decisions (all apply)
- `.planning/phases/02-first-click/02-CONTEXT.md` — D-04/D-05: ring buffer event encoding (bits 0–6 sample offset, bits 7–11 voice, bits 12–31 quantum index); D-06: Atomics ring protocol
- `.planning/phases/03-timing-controls/03-CONTEXT.md` — PatternState shape, BeatPosition type, paramSAB slot layout (slots 0–3 used), updatePattern() pattern, $effect binding
- `.planning/phases/03-timing-controls/03-PATTERNS.md` — All established codebase patterns: addr_of_mut! static writes, Atomics.store/load, null guard before SAB ops, zero-allocation hot path, $state + $effect reactive binding

### Current Implementation
- `rust/src/lib.rs` — WASM exports; `fill_output_buffer(sample_offset, voice, noise_gain)` signature; ACCENT_FREQ/ACCENT_AMP statics; existing voice branch (Phase 4 adds voice==2 silent branch and noise mixing)
- `src/lib/audio-engine.ts` — AudioEngine; `updatePattern()`; `_schedulerTick()` voice packing; paramSAB layout (Int32Array, 8 slots, slots 0–3 used — Phase 4 uses slot 4 for noise_gain)
- `public/worklet/processor.js` — `process()` hot path; paramBuffer reads; `fill_output_buffer` call site (Phase 4 passes slot 4 as noise_gain every frame)
- `src/lib/pattern.ts` — PatternState, Track, BeatPosition types; `rebuildBeats()` (Phase 4 adds merge-preserving overload); `defaultPatternState()` (Phase 4 keeps voice 1 for beat 0)
- `src/App.svelte` — existing UI; Phase 4 adds beat grid component and noise slider

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BeatPosition { voice: number }` — already the correct shape; voice 2 is a new palette value, no type change needed
- `paramSAB` (8 slots, Int32Array) — slots 4–7 are free; slot 4 used for noise_gain × 1000
- `fill_output_buffer(sample_offset, voice, noise_gain)` — `noise_gain` parameter already exists; currently always called with `0.0`; no signature change needed
- `SUBDIV_MULT`, `computeStepInterval`, `rebuildBeats` — Phase 3 utilities; `rebuildBeats` needs a merge-preserving variant

### Established Patterns
- `static mut` + `addr_of_mut!().write()` / `addr_of!().read()` — all Rust static writes/reads follow this pattern; new PRNG state follows the same form
- `Atomics.store(paramBuffer, slot, value)` / `Atomics.load(paramBuffer, slot)` — all SAB param reads/writes; slot 4 noise_gain follows the same encoding (integer × 1000)
- Zero-allocation in `process()` — no `new`, no object literals, all views created once; noise_gain read is a single `Atomics.load` — no allocation
- `$state` + `$effect` reactive binding — `pattern` state drives `engine.updatePattern()`; beat grid mutations are mutations on `pattern.tracks[0].beats[i].voice` — the existing `$effect` already picks them up

### Integration Points
- `_schedulerTick()` already packs `beat.voice` into ring events (bits 7–11); voice 2 passes through unchanged — the worklet and WASM are the consumers
- `updatePattern()` in AudioEngine writes `_beats = track.beats`; no change needed — the scheduler reads `_beats` directly
- `process()` in worklet currently calls `fill_output_buffer(sampleOffset, voice, 0.0)` per beat event; Phase 4 changes to `fill_output_buffer(sampleOffset, voice, noiseGain)` where `noiseGain` is read from paramBuffer slot 4 every frame

</code_context>

<specifics>
## Specific Ideas

- **OTG adapter / wireless headphone use case:** White noise at a low level (5–10% on the slider) keeps power-saving audio adapters from entering their silence-gap cutoff mode. At slow tempos (40–50 BPM) these adapters swallow clicks because the silence between beats is long enough to trigger their power-down. Continuous low-level noise prevents this. The user must be able to set noise to 0% for a completely clean output.
- **Palette extensibility:** The `voice: number` field on `BeatPosition` is an index into an implicit palette. Phase 4 uses 0/1/2. Future phases can add palette entries (new DSP sounds, user WAV/MP3) by adding more voice values and palette entries without changing the data model.

</specifics>

<deferred>
## Deferred Ideas

- **Ghost note sound** — A "ghost" click (soft, recessed) was considered for Phase 4 but deferred. Will be revisited when multiple custom sound options are implemented (v2 milestone: "User-loadable WAV/MP3 click sounds").
- **More palette entries** — Expanding the palette beyond Normal/Accent/Silent (e.g., cowbell, rimshot, handclap) is v2 scope. The data model supports it without changes.
- **Visual beat indicator** — Highlighting the currently-playing beat cell while the metronome runs. Deferred to v2 (already in roadmap backlog).

</deferred>

---

*Phase: 4-Per-Beat-Patterns-and-White-Noise*
*Context gathered: 2026-05-21*
