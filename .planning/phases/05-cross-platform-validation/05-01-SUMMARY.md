---
phase: 05-cross-platform-validation
plan: "01"
subsystem: deployment
tags: [cloudflare-pages, coop-coep, rust-toolchain, ci-build]
dependency_graph:
  requires: []
  provides: [cloudflare-pages-build, coop-coep-headers-production, rust-toolchain-pin]
  affects: [dist/_headers, public/wasm/]
tech_stack:
  added: []
  patterns: [cloudflare-pages-headers-file, posix-sh-build-script, rust-toolchain-toml]
key_files:
  created:
    - build.sh
    - public/_headers
    - rust-toolchain.toml
  modified: []
decisions:
  - "build.sh uses #!/bin/sh and POSIX dot-source (. $HOME/.cargo/env) — not bash source — because Cloudflare Pages executes build scripts with /bin/sh"
  - "Rust bootstrap is guarded by CF_PAGES=1 env var so local runs are unaffected"
  - "cargo xtask build precedes npm run build — WASM binary must exist before Vite copies public/ to dist/"
  - "rust-toolchain.toml pins channel=1.95 with profile=minimal to save ~600MB of docs on CI"
  - "public/_headers uses 2-space indent under /* wildcard per Cloudflare Pages _headers spec"
metrics:
  duration: "~10 min"
  completed: "2026-05-21"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
---

# Phase 05 Plan 01: Cloudflare Pages Deployment Infrastructure Summary

**One-liner:** POSIX sh build script bootstraps Rust on CI, COOP/COEP headers file enables SharedArrayBuffer in production, rust-toolchain.toml pins Rust 1.95 with wasm32 target for CI reproducibility.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create rust-toolchain.toml and public/_headers | 3b07283 | rust-toolchain.toml, public/_headers |
| 2 | Create build.sh for Cloudflare Pages CI | 010cb10 | build.sh |

## What Was Built

Three configuration files required to deploy the metronome to Cloudflare Pages with SharedArrayBuffer support:

**`rust-toolchain.toml`** — Pins Rust 1.95 stable with `wasm32-unknown-unknown` target and `profile = "minimal"`. Rustup reads this file automatically when `cargo` is invoked, so the CI build environment installs the exact same toolchain without an explicit `rustup target add` step in the build script.

**`public/_headers`** — Cloudflare Pages static headers file. Sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on all routes (`/*`). These values are character-for-character identical to the `COOP_COEP_HEADERS` constant in `vite.config.ts` that serves the same headers in development. Vite copies everything in `public/` to `dist/` during `vite build`, so the file lands in the correct output directory automatically.

**`build.sh`** — POSIX sh build script set as the Cloudflare Pages build command (`sh build.sh`). Bootstraps Rust from rustup when `CF_PAGES=1` and `cargo` is absent. Uses `. "$HOME/.cargo/env"` (POSIX dot-source, not bash `source`) because Cloudflare Pages executes build scripts with `/bin/sh`. Delegates WASM compilation to `cargo xtask build`, installs JS deps with `npm ci`, then produces `dist/` via `npm run build`. Order is critical: xtask must run before vite build because the WASM binary is gitignored and must exist in `public/wasm/` before Vite copies it.

## Verification

- `sh -n build.sh`: syntax valid for POSIX sh
- `grep -c '^source ' build.sh`: returns 0 (no bare `source` commands)
- `public/_headers` indentation: 2-space indent confirmed via `cat -e`; no trailing whitespace
- `npx vitest run`: 27/27 tests pass (no regressions)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

No new threat surface introduced. T-05-01 (missing COOP/COEP) is mitigated by `public/_headers`. T-05-04 (curl-pipe-to-sh) is accepted per threat register — guarded by `CF_PAGES` env var and enforces TLS via `--proto '=https' --tlsv1.2`.

## Next Steps

User action required to complete deployment:
1. Connect the GitHub repo to Cloudflare Pages (Dashboard > Workers & Pages > Create > Pages > Connect to Git)
2. Set build command: `sh build.sh`
3. Set output directory: `dist`
4. Trigger first deploy and verify `crossOriginIsolated === true` in browser console on the production URL

## Self-Check: PASSED

- build.sh exists and is executable: FOUND
- public/_headers exists with correct content: FOUND
- rust-toolchain.toml exists with correct content: FOUND
- Commits 3b07283 and 010cb10: FOUND (verified via git log)
- vitest: 27/27 pass
