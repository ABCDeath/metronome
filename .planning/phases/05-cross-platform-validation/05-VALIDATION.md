---
phase: 5
slug: cross-platform-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-21
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (existing) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` (regression guard — no new unit tests in this phase, but existing pattern/scheduler tests must stay green)
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + manual Android checklist completed
- **Max feedback latency:** ~5 seconds (Vitest fast; Android audit is manual/separate)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | — | No new code paths | regression | `npx vitest run` | ✅ existing | ⬜ pending |
| 05-01-02 | 01 | 1 | — | `_headers` indentation preserved | manual | inspect `cat -A public/_headers` | ❌ new file | ⬜ pending |
| 05-01-03 | 01 | 1 | — | Rust installed in CI shell | manual | `sh -c '. build.sh 2>&1'` locally | ❌ new file | ⬜ pending |
| 05-02-01 | 02 | 2 | PLATFORM-02 | `crossOriginIsolated === true` on prod | manual | Browser console post-deploy | N/A | ⬜ pending |
| 05-02-02 | 02 | 2 | PLATFORM-02 | Audio plays on Android after gesture | manual | Manual Android test session | N/A | ⬜ pending |
| 05-02-03 | 02 | 2 | AUDIO-03 | Zero GC in process() @ 120 BPM | manual | Performance panel trace | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

No new test stubs needed. This phase adds configuration files and a shell script — no new TypeScript or Rust logic. The existing `npx vitest run` suite guards against regressions in pattern/scheduler math. All primary verification is manual.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| App loads on Android Chrome; audio plays after gesture | PLATFORM-02 | D-11: no Playwright; physical device required | Connect Android via USB, open production URL in Chrome, press Play, verify clicks at 20/120/300 BPM × 60s each |
| `crossOriginIsolated === true` on production URL | PLATFORM-02 | Deployment header; requires live Cloudflare URL | Open production URL in desktop Chrome DevTools console; run `console.log(crossOriginIsolated)` |
| Zero GC events in `process()` during 60-second run | AUDIO-03 / D-04 | AudioWorklet GC cannot be detected by unit tests | USB remote debug via `chrome://inspect`; record Performance panel for 60s at 120 BPM; check AudioWorklet lane for yellow GC blocks |
| `process()` render time < 2.67ms per quantum | D-04 | Requires actual device profile | In same Performance trace, hover individual `process()` calls; verify duration |
| Audible click consistency across tempos | AUDIO-04 | No automated amplitude measurement | Listen at 20 BPM, 120 BPM, 300 BPM; verify no distortion, no dropout, consistent volume |
| WASM binary present in Cloudflare Pages deploy | D-08 | CI build verification | Check Cloudflare Pages build log for `cargo xtask build` success; check Network tab for 200 on `*.wasm` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or are listed as manual-only above
- [ ] Sampling continuity: `npx vitest run` after each file-writing task
- [ ] Wave 0 covers all MISSING references — N/A (no new test files needed)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s (automated); manual checklist is asynchronous
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
