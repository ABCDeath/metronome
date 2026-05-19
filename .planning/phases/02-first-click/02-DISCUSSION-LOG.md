# Phase 2: First Click - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 2-First Click
**Areas discussed:** Click sound character, Trigger precision, Safari compatibility scope

---

## Click Sound Character

### Oscillator Frequency

| Option | Description | Selected |
|--------|-------------|----------|
| ~1000 Hz | Warm, mid-range tick — sits well in a mix, clear but not piercing | ✓ |
| ~1500–2000 Hz | Brighter, more penetrating — easier to hear over loud instruments | |
| You decide | Claude picks a reasonable value based on psychoacoustic norms | |

**User's choice:** ~1000 Hz

---

### Decay Duration

| Option | Description | Selected |
|--------|-------------|----------|
| ~10–15ms | Short, punchy — feels precise and tight. Standard for DAW click tracks | ✓ |
| ~30–50ms | Slightly longer tail, warmer feel. Audible overlap at very high BPM | |
| You decide | Claude picks ~12ms exponential decay | |

**User's choice:** ~10–15ms

---

### Envelope Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Sine + exponential decay | Pure sine wave × exponential envelope. Clean, no harmonics | |
| Noise burst + decay | Band-filtered white noise with decay. More mechanical/woodblock feel | |
| Triangle wave + exponential decay | User specified: Reaper-style woodblock click | ✓ |

**User's choice:** Triangle wave + exponential decay (free text: "2 or triangle like one of default clicks in Reaper DAW")
**Notes:** User explicitly referenced Reaper's default click sounds. Woodblock character — triangle wave gives odd harmonics (1/n²) for a harder, more percussive transient than pure sine. Still trivial to synthesize in Rust without external files.

---

## Trigger Precision

| Option | Description | Selected |
|--------|-------------|----------|
| Sample-accurate | u32 encodes exact sample offset (bits 0–6) + voice type (bits 7–11). WASM renders at that offset. ±0 samples error. | ✓ |
| Quantum-accurate | u32 is just a trigger flag; click always starts at sample 0. ±2.9ms error. Simpler protocol. | |

**User's choice:** Sample-accurate
**Notes:** User confirmed sample-accurate encoding. Agreed on the bit layout shown in the preview: bits 0–6 = sample offset, bits 7–11 = voice type, bits 12–31 = reserved.

---

## Safari Compatibility Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Strict parity | Same behavior on Chrome and Safari. Fix all Safari-specific bugs before phase ends. | |
| Chrome primary, Safari best-effort | Get click working on Chrome; fix obvious Safari blockers; defer rest to Phase 5. | |
| Skip Safari entirely | User's explicit preference | ✓ |

**User's choice:** Skip Safari entirely
**Notes:** User stated: "You can skip Safari at all: I don't use it, so it has the lowest priority." PLATFORM-01 (macOS Chrome + Safari) will only be partially satisfied by Phase 2 (Chrome only). Safari support deferred indefinitely.

---

## Claude's Discretion

- Exact sentinel value for "no beat this quantum" in the fill_output_buffer call
- Triangle wave generation algorithm in Rust (standard phase accumulator approach)
- Whether scheduler uses `setInterval` or recursive `setTimeout`
- Absolute sample count vs. AudioContext.currentTime float for scheduler timing

## Deferred Ideas

- Safari support — deferred indefinitely (user's lowest priority)
- BPM controls — Phase 3
- Accent vs. normal click distinction — Phase 3 (voice type bits reserved in protocol)
- Worker thread scheduler — defer until drift observed empirically
