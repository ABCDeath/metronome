---
phase: 6
slug: training-mode
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-29
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.6 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run src/lib/audio-engine.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green (27 existing + new training tests)
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | PATTERN-03 | — | N/A | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-02-01 | 02 | 1 | PATTERN-03 | — | N/A | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-02-02 | 02 | 1 | PATTERN-03 | — | N/A | unit | `npx vitest run src/lib/audio-engine.test.ts` | ❌ Wave 0 | ⬜ pending |
| 06-03-01 | 03 | 2 | PATTERN-03 | — | N/A | manual | Enable training 2N+2S, play — strip advances | — | ⬜ pending |
| 06-03-02 | 03 | 2 | PATTERN-03 | — | N/A | manual | Toggle training off mid-bar — clicks resume | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/audio-engine.test.ts` — unit tests covering PATTERN-03 training logic
  - Extract `computeBarType(barCount, normalBars, altBars, altType)` as a pure exported helper in `audio-engine.ts`
  - Tests: normal/silent/skips selection at cycle boundaries, cycle wrap after `normalBars + altBars`, single-bar cycles, `_barCount` reset on `stop()`
- [ ] Framework install: none needed — Vitest already configured (`vitest.config.ts` exists)

*Existing test infrastructure covers all other requirements — only new test file needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cycle-strip indicator shows correct active block | PATTERN-03 | Requires AudioContext + visual rendering | Enable training (2 normal, 2 silent), play — verify strip highlight advances each bar |
| Training toggle off restores normal playback immediately | PATTERN-03 | Requires live AudioContext timing | Play with training (2N+2S silent), toggle off mid-silent-bar — verify clicks resume on next step |
| Skips bar UI independent configuration | PATTERN-03 | Requires visual beat grid | Enable skips, edit skips beat grid — verify it doesn't affect main pattern grid |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
