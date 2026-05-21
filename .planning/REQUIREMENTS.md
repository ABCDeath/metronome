# Requirements

## v1 Requirements

### Timing

- [x] **TIMING-01**: User can set BPM in the range 20–300
- [x] **TIMING-02**: User can set time signature with a numerator and common denominators (e.g. 4/4, 3/4, 7/8, 5/4, 6/8)
- [x] **TIMING-03**: User can select subdivision (quarter notes, 8th notes, triplets, 16th notes)
- [x] **TIMING-04**: User can start and stop the metronome via a play/stop control

### Pattern

- [x] **PATTERN-01**: Each beat position in the pattern has an independently assignable click sound
- [x] **PATTERN-02**: Beat 1 defaults to an accent sound; all other positions default to a normal click sound

### Audio

- [x] **AUDIO-01**: Default click sounds are synthesized by the Rust WASM engine (no external audio files required)
- [ ] **AUDIO-02**: User can mix white noise into the output with a controllable mix level (0–100%)
- [ ] **AUDIO-03**: Audio engine achieves scheduling gaps of no more than 10ms between clicks at any BPM
- [ ] **AUDIO-04**: Clicks are consistent in length and amplitude across all tempos and subdivisions

### Platform

- [x] **PLATFORM-01**: App runs in browser on macOS (Chrome and Safari)
- [ ] **PLATFORM-02**: App runs in browser on Android Chrome
- [ ] **PLATFORM-03**: AudioContext is activated only after a user gesture (browser autoplay policy compliance)
- [ ] **PLATFORM-04**: Server/dev server serves COOP and COEP headers (required for SharedArrayBuffer access)

---

## v2 (Deferred)

- Visual beat indicator — highlight current beat position while playing
- User-loadable audio files — custom WAV/MP3 samples per beat position
- Tap tempo — tap a button to set BPM
- Practice modes — gradual BPM ramp, mute-beats trainer
- Preset save/load — persist and recall patterns (localStorage)

---

## Out of Scope

- **Polyrhythm / multiple tracks** — future milestone; architecture accommodates it (multi-track PatternState model) but UI and engine not built for v1
- **MIDI output** — future milestone
- **Native app packaging** (Electron, Capacitor, PWA install) — browser-only
- **Backend / server-side persistence** — client-only
- **iOS Safari v1 support** — AudioWorklet bugs on iOS 18 need validation; support deferred to after cross-platform testing phase
- **Italian tempo labels** (Andante, Allegro, etc.) — anti-feature per user research

---

## Traceability

| REQ-ID | Phase |
|--------|-------|
| TIMING-01 | Phase 3 |
| TIMING-02 | Phase 3 |
| TIMING-03 | Phase 3 |
| TIMING-04 | Phase 2 |
| PATTERN-01 | Phase 4 |
| PATTERN-02 | Phase 3 |
| AUDIO-01 | Phase 2 |
| AUDIO-02 | Phase 4 |
| AUDIO-03 | Phase 1 |
| AUDIO-04 | Phase 1 |
| PLATFORM-01 | Phase 2 |
| PLATFORM-02 | Phase 5 |
| PLATFORM-03 | Phase 1 |
| PLATFORM-04 | Phase 1 |
