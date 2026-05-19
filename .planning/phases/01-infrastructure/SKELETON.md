# Walking Skeleton — Metronome

**Phase:** 1
**Generated:** 2026-05-19

## Capability Proven End-to-End

A user can click Play and the WASM audio engine runs silence inside an AudioWorklet on the audio thread — proving the entire Rust WASM compilation, main-thread module transfer, AudioWorklet instantiation, and SharedArrayBuffer allocation pipeline works without error.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Audio engine language | Rust compiled to WASM (`wasm32-unknown-unknown`) | No GC pauses; deterministic allocation; SIMD available for DSP |
| WASM build toolchain | `cargo build` + `wasm-bindgen-cli` 0.2.120 + `wasm-opt` | wasm-pack deprecated Sep 2025; manual pipeline gives full control |
| Build orchestration | `cargo-xtask` workspace member at `xtask/` | All build logic in Rust; single `cargo xtask dev` command for full dev loop |
| Audio threading | `AudioWorkletProcessor` (Web Audio API) | Only reliable sub-10ms audio thread in the browser |
| Main-thread to worklet data | `SharedArrayBuffer` + `Atomics` (SPSC ring + param buffer) | Zero-copy, zero-allocation path; `postMessage` introduces latency |
| Cross-origin isolation | COOP/COEP headers via Vite `server.headers` | Required for `SharedArrayBuffer`; `crossOriginIsolated === true` |
| WASM loading strategy | `fetch()` + `WebAssembly.compile()` on main thread, transfer `Module` via `processorOptions` | `fetch`/`TextEncoder` unavailable in AudioWorkletGlobalScope |
| Worklet hot-path exports | `#[no_mangle] pub extern "C" fn` only | wasm-bindgen JS glue uses `TextEncoder`/`TextDecoder`, unavailable in worklet |
| UI framework | Svelte 5 + Vite 6 (standalone SPA, no SvelteKit) | Zero runtime overhead; compiler-based; small bundles |
| WASM static serving | `public/wasm/` (copied by xtask build) — no vite-plugin-wasm | Keeps AudioWorklet loading simple; no bundler processing of WASM |
| Worklet script serving | `public/worklet/processor.js` (plain JS, not bundled) | Stable URL for `addModule()`; no Vite renaming |
| Directory layout | `rust/` (Cargo crate), `xtask/` (build tool), `src/` (Svelte/TS), `public/` (static assets) | Clean separation of Rust engine, build tooling, and frontend |
| Deployment target | Netlify / Vercel / Cloudflare Pages (Phase 5) | All support custom COOP/COEP headers; HTTPS required for SAB |

## Stack Touched in Phase 1

- [x] Project scaffold (Cargo workspace, Vite + Svelte 5, xtask, tsconfig)
- [x] Build pipeline — `cargo xtask build` compiles Rust to WASM and copies to `public/wasm/`
- [x] COOP/COEP headers — `crossOriginIsolated === true` in browser
- [x] Audio thread — AudioWorklet processor loads WASM module and runs `process()` producing silence
- [x] SharedArrayBuffer — SPSC ring buffer and Atomics param buffer allocated and passed to worklet
- [x] User gesture gate — AudioContext created/resumed only on Play button click
- [x] Dev workflow — `cargo xtask dev` spawns Vite + watches Rust for changes

## Out of Scope (Deferred to Later Slices)

- Click synthesis / audible sound (Phase 2)
- Lookahead scheduler writing beat events to SPSC ring (Phase 2)
- BPM / time signature / subdivision controls (Phase 3)
- Per-beat pattern assignment UI (Phase 4)
- White noise synthesis (Phase 4)
- Android Chrome hardware testing (Phase 5)
- Production deployment with COOP/COEP headers (Phase 5)
- Hot module replacement for Rust changes (deferred indefinitely)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: User presses Play and hears a drift-free click at fixed tempo (click synthesis + lookahead scheduler)
- Phase 3: User sets BPM, time signature, subdivision and hears correct pattern (timing controls + PatternState)
- Phase 4: User assigns sounds per beat position and mixes white noise (per-beat UI + noise synthesis)
- Phase 5: Cross-platform validation on real Android hardware + production deployment
