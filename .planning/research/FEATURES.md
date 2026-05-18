# Feature Landscape

**Domain:** Browser-based metronome app (TypeScript/WASM audio engine)
**Researched:** 2026-05-18

---

## Table Stakes

Features users expect. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| BPM input (20–300) | Every metronome has it; professional apps extend to 1–900 BPM but 20–300 covers 99% of real use | Low | Numeric input + increment/decrement buttons; keyboard arrow support |
| Play / Stop toggle | Core action; must be instant and unambiguous | Low | Single prominent button; Space bar shortcut essential |
| Time signature selector | Numerator (beats per bar) + denominator (note value); 4/4, 3/4, 6/8, 5/4, 7/8 are the most-used | Medium | Numerator 1–12, denominators 2/4/8/16; defaults to 4/4 |
| Beat subdivision | Quarter, 8th, triplet, 16th; users set to fill slow-tempo gaps and internalize pulse | Medium | Per-bar subdivision multiplier; affects click density, not BPM |
| Accent on beat 1 | Distinguishes downbeat from upbeats; expected in any time-signature-aware tool | Low | Louder or different-pitched click on position 0 of each bar |
| Per-beat sound assignment | Pro users need independent accent types per beat position; drives groove feel | Medium | Array of beat positions, each with a sound/accent level; already in PROJECT.md |
| Multiple bundled click sounds | A single click tone is not enough; wood block, electronic beep, tick, cowbell are baseline | Low | 3–5 synthesized defaults covers most users; WASM synthesis keeps zero external deps |
| Visual beat indicator | Shows which beat is currently active; essential for silent environments or ear protection | Low | Highlighted position or animated pulse in sync with audio |
| Tap tempo | Fastest way to match tempo of a reference track; expected by virtually all musicians | Low | 3–4 taps to compute average BPM; no structural impact; already scoped as future |
| Consistent, drift-free timing | The entire value proposition of the app; timing drift is the #1 complaint in user reviews | High | AudioWorklet + WASM lookahead scheduler; sub-10ms gap requirement already set |

---

## Differentiators

Features that set the product apart. Not universally expected, but meaningful to the target user.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| White noise mixing | Masks environmental sound; helps focus; unique among browser metronomes; already scoped in PROJECT.md | Medium | Controllable mix level (0–100%); synthesized in WASM alongside clicks |
| User-loadable audio files (WAV/MP3) | Musicians who dislike synthetic clicks can use their own samples — a recorded snare crack, cowbell, etc. | Medium | File input → decode via Web Audio API → stored as AudioBuffer; already scoped |
| Mute-beats trainer (gap click) | Develops internal clock by periodically silencing clicks; used by professionals; not in most browser tools | Medium | Configurable: click X bars, silent Y bars; stateless extension of the existing scheduler |
| Gradual tempo increase (speed trainer) | Automates the standard practice method of incrementing BPM over time; saves manual intervention | Medium | Parameters: start BPM, end BPM, step size (2–10 BPM), interval (N beats or bars) |
| Per-beat volume control | Beyond accent on/off — each beat position gets a 0–100% level; enables ghost-note simulation | Medium | Extends the per-beat assignment model; each position stores {sound, volume} |
| Fullscreen / distraction-free mode | Reduces cognitive load during practice; some online tools advertise it as a differentiator | Low | CSS fullscreen API; hide all controls except current BPM and beat indicator |
| Keyboard-first control | Spacebar play/stop, arrow keys for BPM, shortcut to tap tempo; speeds up workflow for desktop users | Low | No structural impact; accessibility benefit is additive |
| Polyrhythm support (multiple tracks) | Advanced drummers and composers layer independent time signatures; niche but high-value | High | Requires multi-track pattern model; PROJECT.md explicitly deferred but architecture must not block it |
| Setlist / preset saving | Musicians switch tempos between pieces; preset recall removes setup friction at rehearsal or performance | Medium | localStorage; list of {name, BPM, timeSig, subdivision, beatMap} objects |

---

## Anti-Features

Features to explicitly NOT build, or to build only in a deliberately stripped-down form.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Song / playlist composition UI | Competing apps have been criticized for introducing "Compose", "Songs", "Playlists" inside a metronome — it confuses the core workflow | If setlist saving is added, keep it as a flat list of named presets, not a DAW-style arrangement view |
| Complex polyrhythm visualizer with animated rings | Users report these are "quite confusing" and distract from practice | Show multiple simple beat-position rows if polyrhythm is added; no animated orbital diagrams |
| Randomly muted beats (randomization mode) | Users cited this as a feature they "couldn't figure out why they'd use" — it generates support questions without driving retention | Stick to deterministic mute patterns (X bars on, Y bars off) |
| Italian tempo markers (Allegro, Andante, etc.) | Adds label complexity with near-zero practical value for digital users who already see the BPM number | Omit entirely; BPM number is the universal reference |
| Tuner integration | Out-of-scope for a precision-timing tool; tuners have a distinct product surface; bundling creates bloat | Keep metronome concerns isolated; tuner can be a separate browser tab |
| MIDI output (v1) | Browser MIDI API has inconsistent support; adds deployment complexity and testing surface | Already scoped out of v1 in PROJECT.md; leave architecture door open |
| Social / sharing features | No evidence of demand in musician reviews; adds backend surface | Client-only; if sharing is needed, encode preset as URL query string |
| Subscription paywall on core features | Musicians resent paywalls on start/stop and BPM setting; several competitor reviews cite this as a reason to switch | All core features free; consider optional premium for advanced practice modes |
| Native app packaging (v1) | PWA install, Electron, or Capacitor add build/distribution complexity with no audio benefit | Browser-only as per PROJECT.md; revisit after timing precision is validated |

---

## Feature Dependencies

```
Play/Stop
  └─ requires: AudioWorklet + WASM scheduler (timing engine)

BPM input
  └─ requires: Play/Stop (engine must be running or accept param update)

Time signature
  └─ requires: Per-beat model (array of N positions)

Subdivision
  └─ requires: Time signature (multiplies positions within each beat)

Per-beat sound assignment
  └─ requires: Time signature + Subdivision (defines the full position array)
  └─ requires: Bundled click sounds (something to assign)

User-loadable audio
  └─ requires: Per-beat sound assignment (assign loaded buffer to a position)

Accent on beat 1
  └─ requires: Per-beat sound assignment (simplified case: position 0 uses accent sound)

Visual beat indicator
  └─ requires: Play/Stop + time signature (knows which position is current)

Tap tempo
  └─ requires: BPM input (writes back computed BPM)

White noise mixing
  └─ requires: WASM audio engine (noise generated alongside clicks)

Mute-beats trainer
  └─ requires: Play/Stop + time signature (scheduler must track bar count)

Gradual tempo increase
  └─ requires: BPM input + Play/Stop (scheduler updates BPM at intervals)

Polyrhythm (future)
  └─ requires: Per-beat model as multi-track array (already in PROJECT.md architecture note)
  └─ requires: Play/Stop (all tracks run from single clock)

Setlist / presets
  └─ requires: All core inputs (BPM, time sig, subdivision, beat map) to be serializable
```

---

## MVP Recommendation

The minimum viable product that feels complete to a musician:

**Must ship in v1:**
1. Play / Stop with drift-free timing (core value)
2. BPM input (20–300, increment/decrement, keyboard arrows)
3. Time signature (numerator 1–12, denominators 2/4/8/16)
4. Subdivision (quarter, 8th, triplet, 16th)
5. Per-beat sound assignment with 3–5 bundled synthesized sounds
6. Accent on beat 1 (default behavior of the beat assignment model)
7. Visual beat indicator
8. White noise mix control (already scoped, low marginal cost once WASM engine exists)
9. User-loadable WAV/MP3 click sounds (already scoped)

**Defer to next milestone:**
- Tap tempo: additive, no structural dependencies — fast follow
- Mute-beats trainer: depends on bar-count tracking in scheduler
- Gradual tempo increase: depends on BPM-update-while-running
- Setlist/presets: depends on all core params being stable
- Polyrhythm: requires multi-track model; architecture must not block it

**Do not build:**
- Everything in the Anti-Features table above

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| Table stakes features | HIGH | Cross-verified across Pro Metronome, Soundbrenner, Melodics review, BulletproofMusician |
| Practice modes (mute, speed trainer) | HIGH | Documented in multiple app feature lists and practice guides |
| Polyrhythm requirements | MEDIUM | Well-documented in specialized apps; complexity and scope for browser unclear |
| Anti-features / UX pitfalls | MEDIUM | Drawn from user reviews and critic commentary; subjective but consistent pattern |
| Accessibility requirements | HIGH | W3C WCAG / WAI-ARIA authoritative sources; not metronome-specific but directly applicable |
| White noise as differentiator | MEDIUM | No competing browser metronome explicitly offers this; based on absence in reviews |

---

## Sources

- [Best Metronome Apps for Drummers 2026 — Melodics](https://melodics.com/blog/best-metronome-apps-for-drummers-2026)
- [Five Best Metronome Apps — Bulletproof Musician](https://bulletproofmusician.com/five-best-metronome-apps/)
- [Features and Types of Metronomes — Douglas Niedt](https://douglasniedt.com/metronomes-features-and-types.html)
- [How to Practice Polyrhythms — Soundbrenner](https://www.soundbrenner.com/blogs/articles/how-to-practice-polyrhythms-with-the-soundbrenner-metronome)
- [Tempo Advance — AirTurn (polyrhythm + setlists)](https://www.airturn.com/blogs/apps/tempo-advance-metronome-with-polyrhythms-and-setlists)
- [6 Signs It's Time to Dump Your Metronome App — NineBuzz](https://ninebuzz.com/6-signs-its-time-to-dump-your-metronome-app/)
- [How to Practice with a Metronome — Tunable](https://tunableapp.com/metronome/)
- [WAI-ARIA Overview — W3C](https://www.w3.org/WAI/standards-guidelines/aria/)
- [Keyboard Accessibility — WebAIM](https://webaim.org/techniques/keyboard/)
- [Gibson App Online Metronome (BPM range, time sigs reference)](https://www.gibson.app/tools/metronome)
