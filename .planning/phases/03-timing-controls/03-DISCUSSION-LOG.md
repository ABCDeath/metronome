# Phase 3: Timing Controls - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 3-Timing Controls
**Areas discussed:** BPM control widget, Accent sound character, PatternState → scheduler wiring, Subdivision + time sig step count

---

## BPM Control Widget

| Option | Description | Selected |
|--------|-------------|----------|
| Slider + numeric input | Slider for feel, numeric for precision (standard DAW style) | |
| Numeric input only | Precise but no haptic sweep feel | |
| Slider only | Fast but imprecise | |
| **Slider + number input + ±1/±5 buttons** | User-specified: horizontal slider, validated number input, four step buttons (−5, −1, +1, +5) | ✓ |

**User's choice:** Horizontal slider + text input with number validation + ±1 and ±5 BPM buttons.
**Notes:** User explicitly said the step buttons are "really useful" — should be prominent. Slider chosen over rotary knob (simpler, touch-friendly). Number input validates on entry; clamp to 20–300.

---

## Accent Sound Character

### Pitch

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed higher frequency | Fixed 1400 Hz (toggle on/off), no slider | ✓ |
| Configurable multiplier | Ratio slider 1.0×–1.5× of base frequency | |

**User's choice:** Fixed 1400 Hz, toggle on/off.
**Notes:** User clarified both pitch and amplitude should be independently optional (not a single "use accent" toggle). Amplitude step=0.1 noted as "fine granularity not really useful" — 0.1 steps are sufficient.

### Amplitude

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed 1.5× | Always louder, no slider | |
| Configurable slider 1.0–1.5 | Continuous range, step=0.1 | ✓ |

**User's choice:** Slider 1.0–1.5, step=0.1, toggle on/off.
**Notes:** User initiated this option — not one of the presented choices. Both toggles (pitch, amplitude) default to on.

---

## PatternState → Scheduler Wiring

| Option | Description | Selected |
|--------|-------------|----------|
| Svelte $state in App.svelte → engine.updatePattern() via $effect | PatternState lives in UI layer; AudioEngine reads it on each tick | ✓ |
| Dedicated Svelte store / context | More scalable for multi-component state | |

**User's choice:** $state in App.svelte, engine.updatePattern() via $effect.
**Notes:** Chosen for simplicity — Phase 3 only has one component writing PatternState. Phase 4 may reconsider if multiple components need to write simultaneously.

---

## Subdivision + Time Sig Step Count

### Step count formula

| Option | Description | Selected |
|--------|-------------|----------|
| Steps = numerator × subdivision multiplier | 4/4 + 8th = 8 steps; 3/4 + triplet = 9 steps | ✓ |
| Numerator-only steps | Subdivision = click rate only; grid always = numerator | |

**User's choice:** Steps = numerator × subdivision multiplier.

### BPM meaning

| Option | Description | Selected |
|--------|-------------|----------|
| Always quarter-note BPM | DAW standard; 120 BPM = 120 quarter notes/min regardless of denominator | ✓ |
| Denominator-note BPM | 6/8 at 120 BPM = 120 eighth notes/min | |

**User's choice:** Quarter-note BPM (DAW standard).
**Notes:** User explicitly asked what Ableton, Reaper, Cubase, and FL Studio do — all use quarter-note BPM. User confirmed this standard. Step interval formula: `(60/bpm) × (4/denominator) / subdivisionMultiplier`.

---

## Claude's Discretion

- Default PatternState on first load (BPM=120, 4/4, quarter, beat 0 = accent)
- Exact layout of controls in App.svelte
- Numerator picker (number input 1–12) and denominator picker (select: 2|4|8|16)
- Subdivision picker UI (radio or select)
- Whether accent settings are in a collapsible panel or always visible
- paramSAB slot allocation for accent params

## Deferred Ideas

- Per-beat sound assignment → Phase 4
- Ghost notes (voice=2) and silent beats (voice=3) → Phase 4
- White noise slider → Phase 4
- Configurable accent pitch multiplier → possible v2
