---
phase: 1
slug: infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-19
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (TS unit tests) + Playwright (browser E2E) + cargo test (Rust unit) |
| **Config file** | `vitest.config.ts` / `playwright.config.ts` / `rust/Cargo.toml` — Wave 0 creates |
| **Quick run command** | `cargo test --manifest-path rust/Cargo.toml && npm run test:unit` |
| **Full suite command** | `npm run test` (runs cargo test + vitest + playwright) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cargo test --manifest-path rust/Cargo.toml`
- **After every plan wave:** Run `npm run test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green + all manual checks below completed
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 01-setup-workspace | 01 | 0 | PLATFORM-04 | manual | — | ⬜ pending |
| 01-vite-coop-coep | 01 | 1 | PLATFORM-04 | manual | `curl -I http://localhost:5173` | ⬜ pending |
| 01-rust-wasm-compile | 01 | 1 | AUDIO-03 | unit | `cargo test --manifest-path rust/Cargo.toml` | ⬜ pending |
| 01-xtask-build | 01 | 1 | AUDIO-03 | manual | `cargo xtask build` | ⬜ pending |
| 01-sab-ring-buffer | 01 | 2 | AUDIO-03 | unit | `npm run test:unit` | ⬜ pending |
| 01-audioworklet-load | 01 | 2 | AUDIO-03 | manual | browser console | ⬜ pending |
| 01-gesture-gate | 01 | 2 | PLATFORM-03 | manual | browser interaction | ⬜ pending |
| 01-zero-alloc | 01 | 3 | AUDIO-04 | manual | Chrome DevTools Memory | ⬜ pending |
| 01-e2e-cross-origin | 01 | 3 | PLATFORM-04 | e2e | `npx playwright test` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `rust/src/lib.rs` — minimal WASM module stub (silence output, #[no_mangle] exports)
- [ ] `src/worklet/processor.js` — AudioWorklet processor stub (returns true, no synthesis)
- [ ] `vitest.config.ts` — unit test config for TS/SAB ring buffer tests
- [ ] `playwright.config.ts` — E2E config targeting localhost:5173 with COOP/COEP

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `crossOriginIsolated === true` in console | PLATFORM-04 | Requires live browser | Open DevTools → Console → check `crossOriginIsolated` |
| WASM runs in AudioWorklet without error | AUDIO-03 | Requires AudioWorkletGlobalScope | Open DevTools → Console, click Play, verify no errors |
| Play button does nothing before gesture | PLATFORM-03 | Requires user interaction | Load page, click Play before any interaction → AudioContext stays suspended |
| Play button resumes AudioContext on click | PLATFORM-03 | Requires user gesture | Click Play → AudioContext.state === "running" |
| Flat heap in `process()` | AUDIO-04 | DevTools Memory profiler | DevTools → Memory → Record allocation timeline during playback → verify flat line |
| Android Chrome audio context resumes | PLATFORM-03 | Physical device required | Phase 5 — deferred |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
