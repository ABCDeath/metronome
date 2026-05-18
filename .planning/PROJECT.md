# Metronome

## What This Is

A browser-based metronome with a TypeScript/JS UI and a Rust-compiled WebAssembly audio engine. Runs on macOS and Android browsers. The WASM layer synthesizes clicks and mixes white noise directly, communicating with an AudioWorklet for sub-10ms timing precision.

## Core Value

Clicks that land on time, every time — the audio engine must be low-latency and drift-free, or the app is useless.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User can set time signature (numerator and common denominators: 4/4, 3/4, 7/8, 5/4, etc.)
- [ ] User can set subdivision (quarter notes, 8th notes, triplets, 16th notes, etc.)
- [ ] User can set BPM
- [ ] User can assign a click sound to each beat position in the pattern independently (defaults to same sound for all)
- [ ] Click sounds include bundled synthesized defaults (generated in WASM) and user-loadable audio files (WAV/MP3)
- [ ] User can play and stop the metronome
- [ ] User can mix white noise with controllable mix level
- [ ] Audio engine achieves <10ms scheduling gaps (AudioWorklet + WASM)
- [ ] Clicks are consistent in length and amplitude
- [ ] App runs in browser on macOS and Android without native installation

### Out of Scope

- Native app packaging (Electron, Capacitor, PWA install) — browser-only for v1
- MIDI output — considered for future milestone
- Polyrhythm/multiple tracks — future milestone (architecture should not block it)
- Practice modes (gradual BPM ramp, mute beats) — future milestone
- Tap tempo — future milestone (additive, no structural impact)
- Backend / server-side persistence — client-only

## Context

- Audio precision is the core constraint. The Web Audio API clock is the most reliable timing source in the browser; the standard approach is a lookahead scheduler running in AudioWorklet, with WASM handling synthesis.
- SharedArrayBuffer (requires COOP/COEP headers) will likely be needed for lock-free WASM <-> AudioWorklet communication. This has deployment implications (server must serve correct headers).
- Rust → WASM via `wasm-pack` / `wasm-bindgen` is the established toolchain.
- White noise mixing happens in the WASM layer, keeping audio processing consolidated.
- Beat position data model should be designed as a track/pattern array from the start to allow polyrhythm extension without refactoring.
- Android Chrome has historically had AudioWorklet quirks; needs explicit testing.

## Constraints

- **Platform**: Browser only (macOS + Android Chrome/Safari) — no native runtime
- **Audio latency**: Scheduling gaps must not exceed 10ms; clicks must not drift
- **WASM toolchain**: Rust + wasm-pack + wasm-bindgen
- **UI**: TypeScript (framework TBD in requirements phase)
- **No backend**: Fully client-side; any persistence is localStorage

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rust for WASM audio engine | No GC pauses, deterministic performance, strong WASM ecosystem | — Pending |
| AudioWorklet as scheduling layer | Only reliable real-time audio thread in browser; avoids main thread jank | — Pending |
| Per-beat-position sound assignment | Maximum flexibility; natural extension to polyrhythm (each track has its own pattern) | — Pending |
| Both synthesized and user-loaded sounds | Synthesized = zero-dependency default; user files = customization | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-18 after initialization*
