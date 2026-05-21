# Phase 4: Per-Beat Patterns and White Noise — Discussion Log

**Session:** 2026-05-21
**Areas covered:** Beat grid interaction, Sound palette model, Step count change policy, White noise delivery

---

## Area 1: Beat grid interaction

**Question:** How does the user change the sound for a beat position?

**Options presented:** Click to cycle / Mode + tap (toolbar) / Right-click menu

**Decision:** Click to cycle — Normal → Accent → Silent → wraps back to Normal. No mode selector, works on mobile/Android touch.

---

## Area 2: Sound palette model

**Context from user:** "I don't want different types of notes (like accent, ghost, silent, regular), I want different sound options for every note (including silent)."

**Key reframe:** Shifted from named note *types* (accent/normal/ghost/silent) to a *palette model* — each beat position holds a voice index into an available set of sounds. This is extensible to future custom sounds without changing the data model.

**Options presented:** 3 options (Normal → Accent → Silent) / 2 options (Click → Silent) / Claude decides

**Decision:** 3 options — Normal click (voice 0), Accent click (voice 1), Silent (voice 2). Uses the two DSP sounds already built plus a new silent value. No new DSP (ghost deferred).

**Follow-up clarification:** Phase 3 global accent controls (pitch toggle, amplitude toggle, amp slider) remain — they now define the character of the "Accent" palette option rather than a per-bar override.

---

## Area 3: Step count change policy

**Question:** When step count changes (subdivision or time-sig), should beat assignments be preserved or reset?

**Options presented:** Reset all (rebuild from default) / Preserve existing positions, fill new with Normal

**Decision:** Preserve where possible. Existing assignments kept for positions that still exist; new positions filled with Normal (voice 0). `rebuildBeats()` gets a merge-preserving overload.

---

## Area 4: White noise delivery

**Context from user:** "White noise should be in the whole mix including silent gaps between clicks. I need this because some wireless headphones or OTG mini-jack adapters have output lag — at slow tempo like 40–50 BPM they swallow clicks because the adapter stops working during the silence. A slight amount of white noise keeps the adapter awake. I want a mix knob/slider including completely off."

**Options presented:** paramSAB slot (polled per frame, zero-copy) / postMessage (consistent with update-accent pattern)

**Claude recommendation:** paramSAB slot 4, because noise must be current on every ~2.9ms audio frame — it is not triggered by beat events. postMessage goes through the event queue and is wrong for a value needed continuously. Also, noise runs unconditionally on every frame (not gated on beat events) to keep the output stream active.

**Decision:** paramSAB slot 4 (noise_gain × 1000 as integer). Worklet reads atomically every `process()` call. Noise generated unconditionally in Rust `fill_output_buffer` using xorshift32 PRNG.

---

## Summary

All 4 areas resolved. No scope creep. Ghost note deferred to v2. CONTEXT.md written.
