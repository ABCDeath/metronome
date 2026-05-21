---
phase: 4
slug: per-beat-patterns
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-21
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x (installed Phase 3) + cargo test (Rust built-in) |
| **Config file** | `vitest.config.ts` (created Phase 3) |
| **Quick run command** | `npx vitest run src/lib/pattern.test.ts && cargo test --manifest-path rust/Cargo.toml` |
| **Full TS suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/pattern.test.ts && cargo test --manifest-path rust/Cargo.toml`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | AUDIO-02 | — | N/A | unit | `cargo test --manifest-path rust/Cargo.toml -- test_silent_voice_no_click` | ❌ W0 | ⬜ pending |
| 4-01-02 | 01 | 1 | AUDIO-02 | — | N/A | unit | `cargo test --manifest-path rust/Cargo.toml -- test_noise_produces_output` | ❌ W0 | ⬜ pending |
| 4-01-03 | 01 | 1 | AUDIO-02 | — | N/A | unit | `cargo test --manifest-path rust/Cargo.toml -- test_noise_zero_gain` | ❌ W0 | ⬜ pending |
| 4-01-04 | 01 | 1 | AUDIO-02 | — | N/A | unit | `cargo test --manifest-path rust/Cargo.toml -- test_clamp_prevents_clipping` | ❌ W0 | ⬜ pending |
| 4-02-01 | 02 | 2 | AUDIO-02 | — | N/A | integration | `npx vitest run` (TypeScript compiles) | ✅ exists | ⬜ pending |
| 4-03-01 | 03 | 1 | PATTERN-01 | — | N/A | unit | `npx vitest run src/lib/pattern.test.ts -- --testNamePattern "rebuildBeats merge"` | ❌ W0 | ⬜ pending |
| 4-03-02 | 03 | 1 | PATTERN-01 | — | N/A | human | Covered by 04-04 T3 human-verify checkpoint (cycleBeatVoice is a one-liner in App.svelte; no unit test needed) | N/A | ⬜ pending |
| 4-04-01 | 04 | 3 | PATTERN-01 + AUDIO-02 | — | N/A | human | Manual browser verify — beat grid interaction + noise slider audible | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New test infrastructure gaps — additions to existing files, no new framework install needed:

- [ ] `src/lib/pattern.test.ts` — add `rebuildBeats` merge semantics tests covering grow (4→8), shrink (8→4), preserve existing assignments, voice cycle (0→1→2→0) (PATTERN-01)
- [ ] `rust/src/lib.rs` `#[cfg(test)]` block — add `test_silent_voice_no_click`, `test_noise_produces_output`, `test_noise_zero_gain`, `test_clamp_prevents_clipping` (AUDIO-02)

*Existing infrastructure (Vitest config, cargo test) covers all other phase requirements. No new packages.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Beat grid interactive: click cycles N→A→— on each cell; pattern plays correctly | PATTERN-01 | AudioWorklet + AudioContext required; cannot verify from static analysis | Open app, press Play at 120 BPM / 4/4 / Quarter. Click each beat cell and verify: (1) cell label cycles N→A→— correctly; (2) audio matches the displayed voice on the next bar |
| Noise slider audible at 10%, silent at 0%, audible at 100% | AUDIO-02 | Web Audio output cannot be verified programmatically without a running AudioContext | With metronome stopped, move noise slider; press Play; verify noise is audible at 10–100% and absent at 0%; verify no distortion at 100% |
| Step count change preserves beat assignments | PATTERN-01 | UI state and audio engine interaction requires browser | Set beats [Accent, Normal, Silent, Normal]; change subdivision to 8th; verify beat cells show [Accent, Normal, Silent, Normal, Normal, Normal, Normal, Normal] |
| Noise keeps OTG adapter awake at 40 BPM | AUDIO-02 | Requires physical OTG hardware | Set BPM to 40, noise to 5–10%; verify with OTG adapter that clicks are not swallowed (hardware-dependent, conditional test) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
