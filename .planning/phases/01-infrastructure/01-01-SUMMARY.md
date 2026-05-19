---
phase: 01-infrastructure
plan: 01
subsystem: build-pipeline
tags: [rust, wasm, vite, svelte, xtask, coop-coep]
dependency_graph:
  requires: []
  provides:
    - cargo-xtask-build-pipeline
    - wasm-binary-public-wasm
    - vite-dev-server-coop-coep
    - svelte5-ui-scaffold
  affects:
    - phase-02-first-click
    - phase-03-scheduling
tech_stack:
  added:
    - Rust 1.95.0 (stable, aarch64-apple-darwin)
    - wasm32-unknown-unknown target
    - wasm-bindgen-cli 0.2.120 (installed but not used in Phase 1 — see deviations)
    - wasm-opt 129 (binaryen, via homebrew)
    - Vite 8.0.12
    - Svelte 5.55.5
    - "@sveltejs/vite-plugin-svelte" 7.1.2
    - TypeScript 6.0.2
    - xtask-watch 0.3.4
    - clap 4.x
  patterns:
    - cargo-xtask build orchestration (D-04, D-05, D-06)
    - "#[no_mangle] pub extern C fn exports — pure C ABI WASM (D-08)"
    - static mut arrays for zero-allocation audio buffer (D-11)
    - COOP/COEP headers in vite.config.ts server.headers + preview.headers (D-10)
    - WASM served as static asset from public/wasm/ (D-03)
key_files:
  created:
    - Cargo.toml
    - .cargo/config.toml
    - rust/Cargo.toml
    - rust/src/lib.rs
    - xtask/Cargo.toml
    - xtask/src/main.rs
    - public/wasm/.gitkeep
    - package.json
    - vite.config.ts
    - tsconfig.json
    - tsconfig.app.json
    - tsconfig.node.json
    - svelte.config.js
    - index.html
    - src/main.ts
    - src/App.svelte
    - src/app.css
    - src/vite-env.d.ts
    - .gitignore
  modified: []
decisions:
  - "wasm-bindgen-cli skipped in pipeline: pure #[no_mangle] WASM has no wasm_bindgen markers; CLI fails with clone_ref intrinsics error — cargo output copied directly with _bg.wasm naming"
  - "wasm-bindgen crate removed from rust/Cargo.toml: not needed for #[no_mangle] C ABI exports; including it causes CLI incompatibility"
  - "Profile (opt-level=3, lto=true) moved to workspace Cargo.toml root to eliminate Cargo warnings"
  - "TypeScript target set to es2020 (not es2023) to match vite.config.ts build.target: es2020"
metrics:
  duration: "~40 minutes (includes Rust toolchain install, wasm-opt install, npm install)"
  completed: "2026-05-19T05:55:30Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 19
  files_modified: 0
requirements_completed:
  - PLATFORM-04
  - AUDIO-03
  - AUDIO-04
---

# Phase 1 Plan 1: Infrastructure Scaffold Summary

**One-liner:** Cargo workspace with xtask build pipeline (cargo→wasm-opt→public/wasm/), Svelte 5/Vite 8 app with COOP/COEP headers enabled, silence-only WASM exported via three `#[no_mangle] extern "C"` functions.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Scaffold Cargo workspace, Rust WASM crate, xtask build orchestrator | a98d059 | Cargo.toml, rust/src/lib.rs, xtask/src/main.rs |
| 2 | Scaffold Svelte 5 + Vite app with COOP/COEP headers and Play button UI | f4d8fd8 | vite.config.ts, src/main.ts, src/App.svelte |

## Verification Results

| Check | Result |
|-------|--------|
| `cargo xtask build` exits 0 | PASS |
| `public/wasm/metronome_engine_bg.wasm` exists | PASS |
| `npm run typecheck` exits 0 | PASS |
| `vite.config.ts` has `Cross-Origin-Opener-Policy` in `server.headers` | PASS |
| `vite.config.ts` has `Cross-Origin-Embedder-Policy` in `server.headers` | PASS |
| `vite.config.ts` has both headers in `preview.headers` | PASS |
| `rust/src/lib.rs` exports: get_output_buffer_ptr, fill_output_buffer, init | PASS |
| No heap allocations in lib.rs (no Vec/Box/String) | PASS |
| `cargo test --manifest-path rust/Cargo.toml` passes | PASS (0 tests, compilation verified) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] wasm-bindgen-cli fails on pure #[no_mangle] WASM**
- **Found during:** Task 1 — Step 2 of build pipeline
- **Issue:** `wasm-bindgen --target web ... metronome_engine.wasm` exits 1 with error: "failed to find intrinsics to enable `clone_ref` function". The wasm-bindgen-cli expects the WASM binary to contain `#[wasm_bindgen]` annotations when processing. A pure C ABI module (D-08) has no wasm-bindgen markers, causing the CLI to fail.
- **Root cause:** D-08 (no wasm-bindgen macros in hot path) conflicts with D-09's pipeline step 2 (wasm-bindgen-cli post-processing). The plan listed wasm-bindgen-cli in the pipeline for JS/TS glue generation, but glue is unnecessary when: (a) the WASM is loaded via `WebAssembly.compile()` directly (D-07), and (b) the AudioWorklet calls `instance.exports.fn()` on pure C ABI exports.
- **Fix:** Skip wasm-bindgen-cli in `build_wasm()`. Copy `target/wasm32-unknown-unknown/release/metronome_engine.wasm` directly to `rust/pkg/metronome_engine_bg.wasm` (preserving the `_bg` naming convention). wasm-opt still applies to the file.
- **Second fix:** Remove `wasm-bindgen = "=0.2.120"` from `rust/Cargo.toml` — the crate is not needed for `#[no_mangle]` exports and including it adds internal intrinsics that cause the CLI to expect markers.
- **Impact:** Zero — the plan's end goal (WASM binary in `public/wasm/`) is achieved without the intermediate wasm-bindgen glue files. Phase 2 will re-evaluate if wasm-bindgen is needed for main-thread TypeScript types.
- **Files modified:** `xtask/src/main.rs`, `rust/Cargo.toml`

**2. [Rule 1 - Bug] Rust `static_mut_refs` lint in lib.rs**
- **Found during:** Task 1 — cargo build warnings
- **Issue:** `AUDIO_OUT.as_ptr()` and `AUDIO_OUT.fill()` create shared/mutable references to a `static mut` — Rust 2024 edition warns this is UB. The compiler emitted warnings that would become errors in future editions.
- **Fix:** Use `std::ptr::addr_of!` for the read-only pointer return and raw pointer iteration for the fill loop. No behavior change.
- **Files modified:** `rust/src/lib.rs`

**3. [Rule 1 - Bug] Cargo workspace profile warning**
- **Found during:** Task 1 — cargo xtask build output
- **Issue:** `[profile.release]` in `rust/Cargo.toml` generated "profiles for the non root package will be ignored" warning.
- **Fix:** Moved `[profile.release]` to root `Cargo.toml`. Removed from `rust/Cargo.toml`.
- **Files modified:** `Cargo.toml`, `rust/Cargo.toml`

### Tool Installation Required (pre-task)

- **Rust toolchain:** Not installed on the machine. Installed via `rustup` (`cargo 1.95.0`, `rustc 1.95.0`).
- **wasm32-unknown-unknown target:** Added via `rustup target add wasm32-unknown-unknown`.
- **wasm-bindgen-cli 0.2.120:** Installed via `cargo install wasm-bindgen-cli --version 0.2.120`.
- **wasm-opt (binaryen):** Installed via `brew install binaryen` (version 129).

These were expected missing dependencies from the RESEARCH.md Environment Availability table — not deviations.

## Decisions Made

- wasm-bindgen-cli is installed but bypassed in Phase 1. Revisit in Phase 2 if main-thread TypeScript code needs `.d.ts` types from wasm-bindgen.
- The `_bg.wasm` suffix naming is preserved (the plan specified this filename) even though wasm-bindgen-cli did not generate it — the xtask copies cargo output under that name directly.
- TypeScript `target` set to `es2020` in `tsconfig.app.json` and `tsconfig.node.json` to match `vite.config.ts build.target: 'es2020'` (the scaffold default was `es2023`).

## Known Stubs

- **src/App.svelte** — Play button has `onclick` not yet wired to AudioContext (intentional Phase 1 stub — AudioWorklet wiring is Phase 2, Plan 02).
- **src/main.ts** — `crossOriginIsolated` accessed via `(self as unknown as {...})` cast; this avoids a TypeScript lib target type issue and is acceptable for Phase 1.

Both stubs are intentional and documented. Phase 2 will wire the Play button to AudioContext creation.

## Threat Flags

No new threat surface beyond what the plan's threat model describes. COOP/COEP headers are in place in `vite.config.ts` (T-01-01 mitigation). WASM served from `public/wasm/` under same origin (T-01-02 mitigation).

## Self-Check: PASSED

Files verified:
- [x] `Cargo.toml` — exists
- [x] `.cargo/config.toml` — exists
- [x] `rust/src/lib.rs` — exists, has 3 `#[no_mangle]` exports
- [x] `xtask/src/main.rs` — exists, has `build_wasm()` function
- [x] `vite.config.ts` — exists, has `Cross-Origin-Opener-Policy` in server + preview headers
- [x] `src/App.svelte` — exists, has `id="play-btn"` button
- [x] `src/main.ts` — exists, has `typeof SharedArrayBuffer === 'undefined'` check

Commits verified:
- [x] a98d059 — Task 1 commit
- [x] f4d8fd8 — Task 2 commit
