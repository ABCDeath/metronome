# Phase 5: Cross-Platform Validation - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate the app on real Android hardware, deploy to production with correct COOP/COEP headers on Cloudflare Pages (including WASM CI build), and verify timing/memory budgets. Phase ends when: the app produces drift-free audio on a physical Android device, the production URL serves SharedArrayBuffer-enabled headers, and a timing budget audit confirms no GC inside `process()` at a sustained tempo.

**macOS Safari is fully deferred to post-v1.** No Safari testing or smoke testing in this phase.

**E2E automation (Playwright) is not in scope.** Verification uses a manual checklist against the production URL.

</domain>

<decisions>
## Implementation Decisions

### Android Testing
- **D-01:** Testing is done on **physical devices you own** — no BrowserStack or remote device cloud required.
- **D-02:** **Single physical device = v1 gate.** The ROADMAP's "two OEM families" requirement is relaxed to a stretch goal. One device passing all checks is sufficient to ship v1.
- **D-03:** Test matrix per device: 20 BPM, 120 BPM, and 300 BPM sustained for 60 seconds each. Verify: no dropout, no drift, `crossOriginIsolated === true` in the browser console, no TypeError or GC events in the DevTools performance panel during `process()`.
- **D-04:** Timing budget: `process()` render budget ≤ 2.9ms per callback (one 128-sample quantum at 44100 Hz). Zero GC events inside `process()` during a 60-second run. Verified via **Chrome DevTools → Performance panel** connected via USB remote debugging (`chrome://inspect`).

### macOS Safari
- **D-05:** macOS Safari is **fully deferred to post-v1**. Do not include any Safari testing, smoke tests, or Safari-specific code in this phase. The iOS 18 AudioWorklet bug risk (noted in STATE.md) remains open — to be investigated in a follow-up milestone.

### Deployment — Cloudflare Pages
- **D-06:** Deploy to **Cloudflare Pages** (free tier). The production deployment serves the static `dist/` output of `vite build`.
- **D-07:** COOP/COEP headers are configured via a **`public/_headers` file** (Cloudflare Pages static headers syntax). This file is committed to the repo and is served for all routes:
  ```
  /*
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
  ```
- **D-08:** The Cloudflare Pages **build command compiles WASM in CI**: `cargo xtask build && npm run build` (or equivalent). The WASM binary remains gitignored — it is always freshly compiled from `rust/src/` during the Pages build. This prevents WASM getting out of sync with the Rust source.
- **D-09:** The build environment on Cloudflare Pages must have the Rust toolchain and `wasm32-unknown-unknown` target installed. The plan must include the necessary build environment configuration (e.g., `RUSTUP_TOOLCHAIN` env var or `.node-version` / `rust-toolchain.toml` for consistent versions).
- **D-10:** Post-deploy verification: open the production URL in Chrome, confirm `crossOriginIsolated === true` in the console, and run the app for 60 seconds at 120 BPM. Manual checklist — no Playwright automation.

### E2E Testing
- **D-11:** No Playwright setup in this phase. Verification is a **manual checklist** against the production URL. Future phases may add Playwright automation.

### Claude's Discretion
- Exact Cloudflare Pages project name and connect-to-GitHub steps (UI workflow, not code)
- Whether `rust-toolchain.toml` is added to the repo to pin the Rust version for CI reproducibility
- Exact `wasm-opt` availability on the Cloudflare build image (plan may skip wasm-opt in CI if unavailable, matching the xtask fallback behavior)
- Structure of the manual verification checklist document
- Whether AUDIO-03 (scheduling gaps ≤10ms) and AUDIO-04 (consistent amplitude) are formally audited in this phase or deferred with the existing implementation assumed correct

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, platform constraints, key decisions
- `.planning/REQUIREMENTS.md` — PLATFORM-02 (Android Chrome); AUDIO-03, AUDIO-04 (timing budget)
- `.planning/ROADMAP.md` §Phase 5 — Success criteria and goal

### Prior Phase Decisions (carried forward)
- `.planning/phases/01-infrastructure/01-CONTEXT.md` — COOP/COEP headers (already working in dev via Vite config)
- `.planning/phases/02-first-click/02-CONTEXT.md` — sampleRate passed to WASM at init; already 44100/48000 agnostic
- `.planning/STATE.md` — macOS Safari deferral note; Android testing risk note

### Existing Implementation
- `xtask/src/main.rs` — WASM build pipeline (`cargo xtask build`); CI build command derives from this
- `vite.config.ts` — Dev server COOP/COEP headers (reference for what the `_headers` file must replicate in production)
- `public/worklet/processor.js` — `process()` hot path; subject of timing/GC audit
- `rust/src/lib.rs` — WASM DSP engine; compiled in CI

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `xtask/src/main.rs`: `build_wasm()` function is the canonical WASM build script. CI build command = `cargo xtask build && npm run build`.
- `vite.config.ts`: already sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` in dev — the `public/_headers` file replicates these for Cloudflare Pages production.

### Key Facts for the Plan
- WASM binary is gitignored (`public/wasm/metronome_engine_bg.wasm`) — must be built in CI.
- `wasm-opt` is used in the xtask pipeline but is optional (the xtask logs a warning and continues if not found) — CI may or may not have it.
- `sampleRate` is already read from `AudioWorkletGlobalScope` and passed to `this._exports.init(sampleRate)` — 44100/48000 Hz agnosticism is already implemented, just needs verification on Android.

</code_context>

<specifics>
## Specific Ideas

- User has one physical Android device. Single-device pass is the v1 gate.
- USB remote debugging via `chrome://inspect` is the primary tooling for Android DevTools access.
- Cloudflare Pages free tier is the deployment target.

</specifics>

<deferred>
## Deferred Ideas

- **macOS Safari full validation** — Deferred to post-v1. iOS 18 AudioWorklet bug risk still open.
- **Playwright E2E automation** — Deferred. Manual checklist is v1 sufficient.
- **Second Android OEM family** — ROADMAP stretch goal; not required for v1 ship.
- **BrowserStack / remote device testing** — Not needed given physical device access.

</deferred>

---

*Phase: 05-cross-platform-validation*
*Context gathered: 2026-05-21*
