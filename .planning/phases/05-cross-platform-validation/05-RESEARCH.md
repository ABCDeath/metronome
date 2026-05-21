# Phase 5: Cross-Platform Validation - Research

**Researched:** 2026-05-21
**Domain:** Cloudflare Pages CI/CD, Android Chrome remote debugging, AudioWorklet timing audit
**Confidence:** MEDIUM-HIGH (CI build and wasm-opt availability require real-world validation; remote-debugging procedure is HIGH confidence from official docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Testing on physical devices owned by the user — no BrowserStack or remote device cloud.
- **D-02:** Single physical Android device = v1 gate.
- **D-03:** Test matrix per device: 20 BPM, 120 BPM, and 300 BPM sustained for 60 seconds each. Verify: no dropout, no drift, `crossOriginIsolated === true`, no TypeError or GC events in the DevTools performance panel during `process()`.
- **D-04:** Timing budget: `process()` render budget <= 2.9ms per callback. Zero GC events inside `process()` during a 60-second run. Verified via Chrome DevTools Performance panel via USB remote debugging (`chrome://inspect`).
- **D-05:** macOS Safari is fully deferred to post-v1. No Safari work in this phase.
- **D-06:** Deploy to Cloudflare Pages free tier. Production serves `dist/` output of `vite build`.
- **D-07:** COOP/COEP headers configured via `public/_headers` file (Cloudflare Pages static headers syntax).
- **D-08:** Build command compiles WASM in CI: `cargo xtask build && npm run build`. WASM binary is gitignored; always freshly compiled from `rust/src/` during Pages build.
- **D-09:** Cloudflare Pages build environment must have Rust + `wasm32-unknown-unknown` target. Plan must include build environment configuration (`RUSTUP_TOOLCHAIN` env var or `rust-toolchain.toml`).
- **D-10:** Post-deploy verification: open production URL in Chrome, confirm `crossOriginIsolated === true`, run app for 60 seconds at 120 BPM. Manual checklist — no Playwright.
- **D-11:** No Playwright in this phase.

### Claude's Discretion
- Whether `rust-toolchain.toml` is added to pin the Rust version for CI reproducibility.
- Exact `wasm-opt` availability on the Cloudflare build image (plan may skip if unavailable, matching existing xtask fallback behavior).
- Structure of the manual verification checklist document.
- Whether AUDIO-03 (scheduling gaps <= 10ms) and AUDIO-04 (consistent amplitude) are formally audited in this phase or deferred with existing implementation assumed correct.
- Exact Cloudflare Pages project name and connect-to-GitHub steps.

### Deferred Ideas (OUT OF SCOPE)
- macOS Safari full validation.
- Playwright E2E automation.
- Second Android OEM family.
- BrowserStack / remote device testing.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLATFORM-02 | App runs in browser on Android Chrome | Android USB remote debug procedure; AudioContext autoplay gate already implemented; sampleRate agnosticism already implemented |
| AUDIO-03 | Scheduling gaps no more than 10ms at any BPM | Can be audited via `chrome://tracing` or Performance panel during Android test; existing lookahead scheduler implementation assumed correct |
| AUDIO-04 | Clicks consistent in length and amplitude across tempos | Audible test during 20/120/300 BPM matrix; no automated measurement tool; mark as manual-verify |
</phase_requirements>

---

## Summary

Phase 5 is a deployment and validation phase, not a feature-build phase. The work falls into three independent tracks: (1) add a `rust-toolchain.toml` and a Cloudflare Pages build command that installs Rust from scratch, builds the WASM binary, and runs `vite build`; (2) commit a `public/_headers` file to enable COOP/COEP in production; (3) USB-remote-debug the app on a physical Android device and record a Performance panel trace to verify zero GC inside `process()` across the 20/120/300 BPM test matrix.

The biggest non-obvious challenge is that **Rust is not pre-installed on Cloudflare Pages**. Every build must bootstrap Rust via `curl | sh` and source `$HOME/.cargo/env` using a POSIX-compatible dot-source (`. "$HOME/.cargo/env"`), not the bash-specific `source` command. `wasm-opt` (binaryen) is also absent from the Pages build image and cannot be installed via `apt`; the xtask pipeline already handles this gracefully with a warning-and-continue fallback, so no code change is needed. If wasm-opt optimization is desired, the binary can be downloaded from the Binaryen GitHub releases page as a curl step in the build command.

The `_headers` file format is well-specified and the exact content needed (two header lines under a `/*` wildcard) is confirmed from Cloudflare's official documentation. Android USB remote debugging setup is a well-documented four-step procedure. The AudioWorklet `process()` timing audit uses the Performance panel's AudioWorklet thread lane.

**Primary recommendation:** Use a `build.sh` script as the Cloudflare Pages build command to avoid shell quoting issues with chained `&&` commands. Add `rust-toolchain.toml` to the repo for version pinning. The `_headers` file and `rust-toolchain.toml` are the only new files. No source code changes are expected.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| COOP/COEP headers in production | CDN/Static (Cloudflare `_headers`) | — | Dev headers already in `vite.config.ts`; production replicates via `public/_headers` |
| WASM build in CI | Build pipeline (Cloudflare Pages CI) | — | xtask orchestrates Rust compile + copy; CI must install Rust |
| Android timing audit | Manual / DevTools | AudioWorklet thread | No automated harness; Performance panel + chrome://inspect is the tool |
| AudioContext gesture gate | Frontend (existing) | — | Already implemented in Phase 1/2; needs verification on Android |
| sampleRate agnosticism | AudioWorklet / WASM (existing) | — | Already implemented in processor.js; needs verification at 48000 Hz on Android |

---

## Standard Stack

### Core — No New Libraries

This phase adds no npm or Rust dependencies. All work is configuration files, a shell build script, and a manual testing procedure.

### Configuration Files Added

| File | Purpose | Notes |
|------|---------|-------|
| `rust-toolchain.toml` | Pin Rust stable version for CI reproducibility | Allows rustup to self-configure; eliminates "toolchain drift" across rebuilds |
| `public/_headers` | COOP/COEP headers for Cloudflare Pages production | Replicates what `vite.config.ts` already does in dev |
| `build.sh` (or inline build command) | Bootstrap Rust + compile WASM + `vite build` | Needed because Rust is not pre-installed on Cloudflare Pages |
| `CHECKLIST.md` (in `.planning/phases/05-cross-platform-validation/`) | Manual verification checklist | Not shipped; used during Android testing session |

### Package Legitimacy Audit

> No external packages are installed in this phase. N/A.

---

## Architecture Patterns

### System Architecture Diagram

```
GitHub push
    |
    v
Cloudflare Pages CI build image (Ubuntu, no Rust pre-installed)
    |
    +--> build.sh
          |
          +--> curl | sh (install rustup, stable toolchain, wasm32-unknown-unknown target)
          +--> . "$HOME/.cargo/env"
          +--> cargo xtask build   (compiles rust/ -> public/wasm/metronome_engine_bg.wasm)
          +--> npm ci
          +--> npm run build        (vite build -> dist/)
    |
    v
dist/ output deployed to Cloudflare CDN edge nodes
    |
    +--> public/_headers applied to all routes (/* pattern)
          Cross-Origin-Opener-Policy: same-origin
          Cross-Origin-Embedder-Policy: require-corp
    |
    v
Browser (production URL)
    |
    crossOriginIsolated === true
    SharedArrayBuffer available
    AudioWorklet + WASM engine running
```

### Recommended Project Structure Changes

```
/
├── rust-toolchain.toml          # NEW — pins Rust stable for CI
├── build.sh                     # NEW — Cloudflare Pages build command
├── public/
│   ├── _headers                 # NEW — COOP/COEP for production
│   ├── wasm/                    # gitignored, built in CI
│   └── worklet/processor.js     # unchanged
```

### Pattern 1: Cloudflare Pages Build Script (Bootstrap Rust in CI)

**What:** A `build.sh` at the repo root that installs Rust, sources the environment, builds WASM via xtask, and runs `vite build`.

**When to use:** Required whenever the CI environment does not pre-install Rust. Cloudflare Pages v3 build image does not include Rust or Cargo. [VERIFIED: developers.cloudflare.com/pages/configuration/build-image/]

**Critical detail:** The build environment uses `/bin/sh`, not `/bin/bash`. The `source` built-in is bash-only; use `. "$HOME/.cargo/env"` (POSIX dot-source) instead. Using `source` will produce `/bin/sh: 1: source: not found` and fail the build silently or with a confusing error. [MEDIUM: confirmed by multiple community reports; docs imply sh environment]

```bash
#!/bin/sh
set -e

# Install Rust stable if not already available (Cloudflare Pages has no Rust pre-installed).
# CF_PAGES=1 is injected by Cloudflare automatically — use it to guard local runs.
if [ "${CF_PAGES:-0}" = "1" ] && ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  # POSIX dot-source — NOT bash 'source' (Cloudflare build env is /bin/sh)
  . "$HOME/.cargo/env"
fi

# Compile Rust -> WASM -> public/wasm/ (wasm-opt applied if available, skipped if not)
cargo xtask build

# Install JS deps and build the frontend
npm ci
npm run build
```

**Cloudflare Dashboard setting:** Build command = `sh build.sh`, Output directory = `dist`.

### Pattern 2: `public/_headers` File Syntax

**What:** A plain-text file in the static asset directory that Cloudflare Pages uses to set HTTP response headers for matched URL patterns. [VERIFIED: developers.cloudflare.com/pages/configuration/headers/]

**Exact format** (indentation is required; leading spaces before header lines):

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

**Rules confirmed from official docs:**
- The file is named `_headers` (no file extension). [VERIFIED: developers.cloudflare.com/pages/configuration/headers/]
- Header lines MUST be indented under the URL pattern line. Failing to indent causes the rule to be silently ignored. [VERIFIED: developers.cloudflare.com/pages/configuration/headers/]
- The `/*` wildcard is a greedy splat matching all paths. [VERIFIED: developers.cloudflare.com/pages/configuration/headers/]
- Maximum 100 header rules; each line max 2,000 characters. [VERIFIED: developers.cloudflare.com/pages/configuration/headers/]
- This file must land in the build output directory (`dist/`). Since Vite copies everything in `public/` to `dist/`, placing it in `public/_headers` is correct.
- Headers from `_headers` are **NOT** applied to Pages Functions responses — only static asset responses. Not relevant here (pure static site). [VERIFIED: developers.cloudflare.com/pages/configuration/headers/]

**Pitfall — trailing spaces:** A trailing space after the header value (e.g., `same-origin `) can cause the header to fail COOP/COEP validation in browsers even though it is technically set. Verify by inspecting response headers in DevTools Network panel after deploy.

### Pattern 3: `rust-toolchain.toml`

**What:** Pins the Rust toolchain version so CI always uses the same stable release. Rustup reads this file automatically when `cargo` is invoked. [VERIFIED: rust-lang.github.io/rustup/overrides.html]

```toml
[toolchain]
channel = "1.95"
targets = ["wasm32-unknown-unknown"]
profile = "minimal"
```

**Recommendation (Claude's discretion):** Add this file. It prevents silent toolchain drift between local development (currently `rustc 1.95.0`) and CI. The `profile = "minimal"` reduces install time by ~600 MB (no HTML docs). Including `targets` ensures the wasm32 target is auto-installed on fresh CI environments without an explicit `rustup target add` step in the build script.

### Pattern 4: USB Remote Debug + Performance Panel Procedure

**What:** Chrome's `chrome://inspect` allows a desktop DevTools instance to attach to Chrome tabs running on a USB-connected Android device. [VERIFIED: developer.chrome.com/docs/devtools/remote-debugging]

**Setup steps:**
1. On Android: Settings > About phone > tap Build number 7x → enables Developer Options.
2. Developer Options > enable USB Debugging.
3. Connect Android device to Mac via USB cable (direct connection, not hub).
4. On Mac Chrome: navigate to `chrome://inspect#devices` and check "Discover USB devices".
5. Accept the authorization prompt on the Android device.
6. The device and its open Chrome tabs appear in the list. Click "inspect" on the metronome tab.
7. A full DevTools window opens, attached to the Android Chrome process.

**Gotchas:**
- Desktop Chrome version must be newer than Android Chrome version on the device. Update both before testing. [CITED: developer.chrome.com/docs/devtools/remote-debugging]
- Disable screencasting (the live screen mirror) during performance recordings — it adds overhead that skews timing measurements. [CITED: developer.chrome.com/docs/devtools/remote-debugging]
- Screen and device must stay unlocked and active during the debugging session; screenlock during recording will produce invalid results.
- On some Samsung devices, additional OEM USB driver setup may be required (Windows only; not relevant on macOS).
- Keep both screens unlocked during recording.

### Pattern 5: Timing/GC Audit in Performance Panel

**What:** The Performance panel shows a dedicated "AudioWorklet" thread lane in the flame chart when the worklet is active. GC events appear as yellow blocks labeled "Minor GC" or "Major GC" in this lane. [CITED: web.dev/profiling-web-audio-apps-in-chrome]

**Audit procedure:**
1. Open DevTools (via `chrome://inspect`) on the running metronome at 120 BPM.
2. Click Record in the Performance panel.
3. Let it record for at least 10 seconds (longer is better; 60 seconds per D-03).
4. Click Stop.
5. In the flame chart, find the "AudioWorklet" thread lane (labeled with the processor class name).
6. Zoom in on `process()` calls. Look for yellow blocks within the AudioWorklet lane.
7. Any yellow block labeled "Minor GC" or "Major GC" is a violation of D-04.
8. Check the duration of individual `process()` calls by hovering: must stay under 2.9ms.

**Budget math:** 128 samples / 44100 Hz = 2.9ms per quantum. At 48000 Hz (Android default) = 2.67ms. The 2.9ms figure in D-04 is the 44100 Hz budget; actual Android budget may be tighter (2.67ms) depending on device sample rate. [ASSUMED — standard formula, no browser-specific verification needed]

**Web Audio DevTools extension:** An optional Chrome extension (not shipped with DevTools) provides a real-time "render capacity" percentage showing workload vs. budget. Useful for a quick sanity check before recording a full Performance trace. Install from Chrome Web Store if desired. [CITED: web.dev/profiling-web-audio-apps-in-chrome]

**`about://tracing` (advanced):** For more granular thread-level timing (audio callback jitter, OS scheduler interference), `about://tracing` with Web Audio categories enabled gives microsecond-level data. This is rarely needed unless Performance panel results are ambiguous.

### Anti-Patterns to Avoid

- **Using `source` instead of `.` in shell scripts:** Fails on Cloudflare Pages' `/bin/sh` environment. Always use `. "$HOME/.cargo/env"`. [MEDIUM: multiple community reports]
- **Relying on `apt-get install binaryen` in CI:** `apt-get` is unavailable in Cloudflare Pages build containers (no root / no `sudo`). [MEDIUM: Cloudflare community reports]
- **Recording Performance while screencasting is active:** Screencasting overhead inflates CPU usage numbers, producing false positives for timing violations.
- **Omitting the `npm ci` step in `build.sh`:** Cloudflare may auto-run `npm install` but behavior with `SKIP_DEPENDENCY_INSTALL` and custom build commands varies. Explicit `npm ci` in the script is unambiguous.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Custom headers middleware | Express/CF Worker returning headers | `public/_headers` file | Native Pages feature; zero code; versioned in git |
| Script to check sample rate | Manual detection code | `audioCtx.sampleRate` (already used in processor.js) | Already implemented in Phase 2; no new code needed |
| Rust install detection logic | Complex version checks | `rust-toolchain.toml` + `rustup` auto-detection | rustup reads the file automatically; no script needed |
| Timing measurement inside process() | `performance.now()` calls in hot path | Chrome DevTools Performance panel | In-process timing adds allocations; external profiler is correct tool |

**Key insight:** This phase is configuration, not code. Resist the urge to add runtime telemetry, automated header-checking scripts, or Playwright tests — all locked out by D-10 and D-11.

---

## Common Pitfalls

### Pitfall 1: `source` vs `.` in Cloudflare Pages Build Script
**What goes wrong:** The build script includes `source "$HOME/.cargo/env"` and the build fails with `/bin/sh: 1: source: not found`. The error may appear mid-build after Rust is successfully installed, making debugging confusing.
**Why it happens:** Cloudflare Pages build environment executes scripts with `/bin/sh`, not `/bin/bash`. `source` is a bash builtin; it does not exist in POSIX sh.
**How to avoid:** Always use `. "$HOME/.cargo/env"` (dot + space + path). Test locally with `sh build.sh` instead of `bash build.sh`.
**Warning signs:** Build log shows "source: not found" after the rustup install completes.

### Pitfall 2: WASM Binary Missing from `dist/`
**What goes wrong:** `vite build` succeeds but the deployed site has no WASM binary, producing a "module not found" error in the browser.
**Why it happens:** `public/wasm/metronome_engine_bg.wasm` is gitignored. If `cargo xtask build` runs after `npm run build` (or fails silently), the file does not exist when Vite copies `public/` to `dist/`.
**How to avoid:** In `build.sh`, always run `cargo xtask build` before `npm run build`. Verify with `ls dist/wasm/` at the end of the build script.
**Warning signs:** No `wasm` subdirectory in Cloudflare Pages build artifacts. Network tab shows 404 for `*.wasm`.

### Pitfall 3: `_headers` File Not Reaching `dist/`
**What goes wrong:** Production URL serves no COOP/COEP headers; `crossOriginIsolated === false`; `SharedArrayBuffer` is undefined; app crashes.
**Why it happens:** The `_headers` file was placed in the wrong directory (e.g., repo root instead of `public/`), or the Cloudflare output directory is misconfigured (should be `dist`, not `public`).
**How to avoid:** File goes in `public/_headers`. Confirm Cloudflare Dashboard: Output directory = `dist`.
**Warning signs:** DevTools Network panel shows no `Cross-Origin-Opener-Policy` header on the production response.

### Pitfall 4: 20-Minute Build Timeout
**What goes wrong:** The first Cloudflare Pages build times out. Rust compilation from scratch on cold CI can be slow (10–15 minutes for a debug build; 3–7 minutes for release with LTO).
**Why it happens:** Free tier CI has limited CPU. Rust compile caches are not persisted between builds by default.
**How to avoid:** The project uses `--release` with `lto = true`, which is slower to compile but acceptable given the binary size goal. If timeouts occur, consider switching `lto = "thin"` or `lto = false` in `Cargo.toml` release profile for CI builds only (using `CF_PAGES` env var). Current project build is small (single-crate audio engine); 20-minute limit is unlikely to be hit but should be monitored on first deploy.
**Warning signs:** Cloudflare Pages build log ends with "Build timed out after 20 minutes."

### Pitfall 5: Android AudioContext Autoplay — `context.state` Unreliable
**What goes wrong:** On Android Chrome, `AudioContext.state` returns `'running'` before a user gesture, even though audio is actually blocked. The app may appear to start but produce no sound.
**Why it happens:** Autoplay policy on Android Chrome is stricter than desktop; `context.state` property is not a reliable indicator of actual audio permission on all Android devices. [CITED: developer.chrome.com/blog/autoplay]
**How to avoid:** The existing implementation gates audio on the Play button click (user gesture) and calls `ctx.resume()` — this is the correct pattern. The testing procedure should verify by loading the page fresh, not clicking anything for 5 seconds, then pressing Play. If audio plays, the gesture gate works.
**Warning signs:** Audio plays without the user pressing Play, or fails to play after the user presses Play on first gesture.

### Pitfall 6: `_headers` Indentation Stripped by Editors
**What goes wrong:** Cloudflare Pages ignores the header rules silently; no COOP/COEP headers served.
**Why it happens:** The `_headers` spec requires header lines to be indented (at least one leading space or tab). If a text editor or git config strips trailing/leading whitespace, the file becomes malformed.
**How to avoid:** After committing, `cat -A public/_headers` and verify the header lines begin with whitespace. Add a `.editorconfig` rule or note in the file comment.
**Warning signs:** Headers are present in the file but not served in production.

---

## Code Examples

### Verified `_headers` content for this project
```
# Source: developers.cloudflare.com/pages/configuration/headers/
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### Verified `rust-toolchain.toml` format
```toml
# Source: rust-lang.github.io/rustup/overrides.html
[toolchain]
channel = "1.95"
targets = ["wasm32-unknown-unknown"]
profile = "minimal"
```

### Verified `build.sh` pattern
```sh
#!/bin/sh
# Source: Cloudflare community (answeroverflow.com/m/1234538596107554816)
# and rust-lang.github.io/rustup/installation/index.html
set -e

if [ "${CF_PAGES:-0}" = "1" ] && ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  . "$HOME/.cargo/env"
fi

cargo xtask build
npm ci
npm run build
```

### Verify COOP/COEP in browser console
```js
// Run in browser DevTools console after loading production URL
console.log('crossOriginIsolated:', crossOriginIsolated);
// Expected: true
console.log('SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');
// Expected: true
```

### Verify sampleRate on Android (DevTools console)
```js
// Run in DevTools console connected to the Android Chrome tab
// (AudioContext is created by AudioEngine; query its state)
// Not directly inspectable unless AudioEngine exposes ctx — use the console
// of the remote-debug session:
document.title; // quick connectivity check
// Then navigate to the network tab and look for 200 on the WASM file
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GitHub Pages for static hosting | Cloudflare Pages / Workers Static Assets | Ongoing (GitHub Pages cannot set COOP/COEP) | GitHub Pages is categorically excluded; Cloudflare Pages works |
| `source` in CI shell scripts | `. "$HOME/.cargo/env"` (POSIX) | Always true in POSIX sh environments | Bash-isms in CI scripts are a common silent failure mode |
| wasm-pack for Rust WASM builds | Manual cargo + xtask pipeline | Sep 2025 (wasm-pack deprecated by rustwasm org) | Already handled in earlier phases; xtask is the standard for this project |
| Cloudflare Pages as distinct product | Cloudflare Workers with Static Assets | Announced April 2025; no forced migration yet | `_headers` file is supported in both systems; no action needed for v1 |

**Deprecated/outdated:**
- `wasm-pack`: Deprecated by the rustwasm org September 2025. Already excluded from this project.
- Performance Insights panel (Chrome DevTools): Removed in Chrome 132. Use Performance > Insights tab instead. [CITED: developer.chrome.com/blog/perf-tooling-2024]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `cargo xtask build` completes within 20-minute Cloudflare Pages build timeout for this project | Pitfall 4 | Build fails on every deploy; need to reduce LTO or split build |
| A2 | The Cloudflare Pages v3 build image uses `/bin/sh` as the default shell (not bash) | Pitfall 1, Pattern 1 | Using `. "$HOME/.cargo/env"` still works even in bash; risk is low but check is cheap |
| A3 | wasm-opt is not available on the Cloudflare Pages build image (cannot be installed via apt) | Pitfall 4, Architecture Patterns | If available, wasm-opt runs automatically via xtask; if absent, xtask warns and continues; no functional impact |
| A4 | Android test device defaults to 48000 Hz sample rate | Pattern 5 (budget math) | Budget is 2.67ms not 2.9ms at 48kHz; still well within any reasonable render time for this WASM engine |
| A5 | AUDIO-03 (scheduling gap <= 10ms) is considered satisfied by the existing lookahead scheduler implementation (25ms interval, 100ms lookahead) unless the Android test reveals regressions | Phase Requirements | If gaps are observed during Android test, a code fix is needed post-phase-plan |

---

## Open Questions

1. **wasm-opt on CI**
   - What we know: wasm-opt is not listed as a pre-installed tool on Cloudflare Pages v3 build image; apt-get is not available.
   - What's unclear: Whether downloading a binaryen binary via curl in build.sh is worth the extra build time vs. simply accepting the unoptimized WASM.
   - Recommendation: Accept the xtask fallback (warn-and-continue without wasm-opt) for v1. The WASM binary for this project is small; size savings are marginal. Document as a follow-up if binary size becomes a concern.

2. **AUDIO-03 and AUDIO-04 formal audit**
   - What we know: Context.md marks these as Claude's discretion. AUDIO-03 (scheduling gap) is traceable to Phase 1 but not formally verified on Android. AUDIO-04 (amplitude consistency) has no automated test.
   - What's unclear: Whether a 60-second manual listen + Performance trace is sufficient evidence or whether a more rigorous test is required.
   - Recommendation: Include both in the manual checklist (listen-only for AUDIO-04; Performance trace confirms no GC for AUDIO-03 by implication). Mark both requirements as verified-manually in REQUIREMENTS.md after successful test. Defer automated measurement to v2.

3. **Cloudflare Pages vs. Workers migration**
   - What we know: Cloudflare announced in April 2025 that Pages is deprecated in favor of Workers with Static Assets; `_headers` is supported in both.
   - What's unclear: The user may prefer to deploy directly to Workers Static Assets to avoid a future migration. The difference for a pure static site is minimal.
   - Recommendation: Deploy to Cloudflare Pages (as locked by D-06). The `_headers` file works identically. Note the migration path in the checklist for awareness.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust stable | `cargo xtask build` on CI | CI: must install; Local: yes | Local: 1.95.0; CI: installed via rustup | None — must install |
| `wasm32-unknown-unknown` target | `cargo build --target wasm32-unknown-unknown` | CI: installed via rust-toolchain.toml; Local: yes | — | `rustup target add wasm32-unknown-unknown` in build.sh |
| wasm-opt (binaryen) | xtask Step 3 | CI: not pre-installed; Local: unknown | — | xtask warns and continues without it |
| npm / Node.js | `npm ci && npm run build` | CI: Node 22 pre-installed; Local: yes | Local: per package.json | None — already available |
| Physical Android device + USB cable | Android testing (D-01) | ✓ (user owns one) | Chrome for Android (version TBD) | None — no emulator fallback |
| Desktop Chrome newer than Android Chrome | USB remote debugging | ✓ (assumed) | Must be verified before test session | Update Chrome on either device |

**Missing dependencies with no fallback:**
- Physical Android device (user-owned; confirmed available per D-01 and D-02).
- Rust on CI (must be bootstrapped in build.sh; no pre-install).

**Missing dependencies with fallback:**
- wasm-opt: xtask already handles absence gracefully with a warning.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLATFORM-02 | App loads and produces audio on Android Chrome | manual | N/A — manual checklist | N/A |
| AUDIO-03 | Scheduling gaps <= 10ms | manual | N/A — Performance panel trace | N/A |
| AUDIO-04 | Consistent click length/amplitude | manual | N/A — audible verification | N/A |

**Note:** D-11 explicitly excludes Playwright. All PLATFORM-02, AUDIO-03, and AUDIO-04 verification is manual. Vitest (unit tests) verifies no regressions in pattern/scheduler math but does not cover the live audio path.

### Sampling Rate
- **Per task commit:** `npx vitest run` (no new unit tests expected; protects existing pattern tests)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Successful manual Android test session + `crossOriginIsolated === true` on production URL

### Wave 0 Gaps
None — no new test files required for this phase. The existing `src/lib/pattern.test.ts` covers pattern logic. No new source code logic is introduced.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | No new user inputs in this phase |
| V6 Cryptography | no | — |
| Cross-Origin Isolation | yes | COOP + COEP headers via `public/_headers` |

### Known Threat Patterns for Static WASM Deployment

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Missing COOP/COEP allows Spectre-style side-channel | Information Disclosure | `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` in `_headers` |
| WASM binary served without HTTPS | Tampering | Cloudflare Pages enforces HTTPS automatically; no action needed |
| Stale/cached WASM after deploy | Tampering | Vite content-hashes WASM filename in import; Cloudflare cache is busted automatically on new deploy |

---

## Sources

### Primary (HIGH confidence)
- [developers.cloudflare.com/pages/configuration/headers/](https://developers.cloudflare.com/pages/configuration/headers/) — `_headers` syntax, rules, limits
- [developers.cloudflare.com/pages/configuration/build-image/](https://developers.cloudflare.com/pages/configuration/build-image/) — v3 build image tools (Rust absent)
- [developers.cloudflare.com/pages/platform/limits/](https://developers.cloudflare.com/pages/platform/limits/) — 20-minute timeout, 500 builds/month free tier
- [rust-lang.github.io/rustup/overrides.html](https://rust-lang.github.io/rustup/overrides.html) — `rust-toolchain.toml` format and fields
- [developer.chrome.com/docs/devtools/remote-debugging](https://developer.chrome.com/docs/devtools/remote-debugging) — USB remote debug setup
- [web.dev/profiling-web-audio-apps-in-chrome](https://web.dev/profiling-web-audio-apps-in-chrome) — AudioWorklet GC and timing profiling

### Secondary (MEDIUM confidence)
- [answeroverflow.com/m/1234538596107554816](https://www.answeroverflow.com/m/1234538596107554816) — Community report: `source` fails on Cloudflare Pages, `. "$HOME/.cargo/env"` workaround
- [community.cloudflare.com/t/support-for-leptos-for-cloudflare-pages/641931](https://community.cloudflare.com/t/support-for-leptos-for-cloudflare-pages/641931) — Working Rust install command for Cloudflare Pages
- [developer.chrome.com/blog/autoplay](https://developer.chrome.com/blog/autoplay) — Android Chrome AudioContext autoplay policy
- [developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) — `_headers` still supported post-Pages-deprecation

### Tertiary (LOW confidence — single source or unverified)
- Community reports: `apt-get install binaryen` unavailable in Cloudflare Pages containers (no root access). [LOW — confirmed by community, not official docs]

---

## Metadata

**Confidence breakdown:**
- `_headers` file format: HIGH — verified from official docs
- Rust not pre-installed on Cloudflare Pages: HIGH — confirmed from official build image docs
- `source` vs `.` pitfall: MEDIUM — community reports + logical inference from sh environment
- wasm-opt absent from CI: MEDIUM — build image docs don't list it; community confirms apt unavailable
- Android debugging procedure: HIGH — official Chrome docs
- GC audit in Performance panel: HIGH — official web.dev guide
- Build timeout risk: MEDIUM — depends on actual compile time; small project likely safe

**Research date:** 2026-05-21
**Valid until:** 2026-08-21 (Cloudflare Pages build image docs stable; Chrome DevTools procedures stable)
