# Phase 1: Infrastructure - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the WASM-AudioWorklet-SharedArrayBuffer stack so every prerequisite for audio is validated before any synthesis code is written. Phase ends when: WASM compiles and runs inside AudioWorklet producing silence, SharedArrayBuffer is confirmed available, the play button is gated behind a user gesture, and zero allocations occur in `process()`. No audible sound is produced in this phase.

</domain>

<decisions>
## Implementation Decisions

### UI Framework
- **D-01:** Use **Svelte 5** with Vite 6 as the frontend framework. Chosen for zero runtime overhead, simpler learning curve for a backend developer, and good fit for a focused single-page audio tool.

### Project Structure
- **D-02:** Single git repo with separate `rust/` and `src/` directories. `rust/` contains the Cargo crate (`Cargo.toml`, `src/lib.rs`). `src/` contains Svelte components and TypeScript. Root holds `package.json` (Vite + Svelte), and the xtask workspace member.
- **D-03:** WASM build output goes to `rust/pkg/` then is **copied to `public/wasm/`** by the build script. Vite serves it as a static asset. No vite-plugin-wasm — explicit copy step keeps the AudioWorklet loading pattern simple and debuggable.

### Dev Workflow / Build Orchestration
- **D-04:** Use **cargo-xtask** as the build orchestrator (a workspace member crate at `xtask/`). This keeps all build logic in Rust, familiar for a backend developer.
- **D-05:** `cargo xtask dev` spawns both the Vite dev server (as a child process) and watches `rust/` for changes, rebuilding WASM and copying output automatically. Single command for full dev loop.
- **D-06:** `cargo xtask build` performs: `cargo build --target wasm32-unknown-unknown` → `wasm-bindgen-cli` → `wasm-opt` → copy to `public/wasm/`.

### WASM + AudioWorklet Loading
- **D-07:** WASM module is compiled via `WebAssembly.compile()` on the main thread (fetch is unavailable in AudioWorkletGlobalScope). The compiled `WebAssembly.Module` is transferred to the AudioWorklet processor via `processorOptions` in the `AudioWorkletNode` constructor.
- **D-08:** The AudioWorklet processor uses `#[no_mangle] pub extern "C" fn` exports only — wasm-bindgen's JS glue (`TextEncoder`/`TextDecoder`) cannot run in AudioWorkletGlobalScope. High-level wasm-bindgen wrappers are for main-thread use only.
- **D-09:** WASM toolchain: `cargo build` → `wasm-bindgen-cli` → `wasm-opt`. **Do not use wasm-pack** — it was deprecated September 2025.

### SharedArrayBuffer / COOP/COEP
- **D-10:** Dev server must serve `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers from day one. Configure in `vite.config.ts` server headers. `crossOriginIsolated === true` is the validation signal.
- **D-11:** SPSC ring buffer (beat events) and Atomics parameter buffer (e.g., noise gain) are pre-allocated at init time. Zero allocations in `process()` — flat heap is a hard requirement, not a nice-to-have.

### AudioContext Gesture Gate
- **D-12:** AudioContext is created on first user gesture (Play button click). Clicking Play before any gesture is a no-op or shows a visual hint. AudioContext state transitions to `"running"` on the gesture.

### Claude's Discretion
- Exact Vite config structure (plugins, resolve aliases) — standard Svelte 5 + Vite 6 setup
- xtask internal implementation details (how it spawns Vite, how it watches files) — use `notify` crate for fs watching, `std::process::Command` for Vite
- Ring buffer size — 256–512 entries is typical; tune based on lookahead window (100ms)
- WASM memory page count — default is sufficient for Phase 1 (silence-only module)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — Phase 1 requirements: PLATFORM-03, PLATFORM-04, AUDIO-03, AUDIO-04
- `.planning/ROADMAP.md` §Phase 1 — Success criteria and phase goal

### Research Findings
- `.planning/research/ARCHITECTURE.md` — WASM + AudioWorklet integration patterns, ring buffer design, white noise algorithm, PatternState model
- `.planning/research/PITFALLS.md` — Critical pitfalls: COOP/COEP setup, WASM loading in AudioWorklet, allocation-free process(), Android quirks
- `.planning/research/STACK.md` — Toolchain specifics: wasm-bindgen-cli version pinning, Vite WASM config, Svelte 5 setup

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project

### Established Patterns
- None yet — this phase establishes the foundational patterns all subsequent phases build on

### Integration Points
- Phase 2 (First Click) depends entirely on the AudioWorklet + WASM pipeline validated here
- The `PatternState` data model shape (`{ bpm, tracks: Track[] }`) should be sketched in Phase 1 even if not wired — Phase 3 will implement it fully

</code_context>

<specifics>
## Specific Ideas

- User is an experienced backend/Rust developer — implementation can use idiomatic Rust patterns without needing JS-friendly abstractions
- xtask is preferred over Makefile or npm scripts — keep build logic in Rust
- The "silence-producing WASM" in Phase 1 is deliberately minimal: validate the pipeline works before adding DSP complexity

</specifics>

<deferred>
## Deferred Ideas

- Deployment target / production COOP/COEP header setup — addressed in Phase 5 (Cross-Platform Validation)
- Hot module replacement for Rust changes — complex to implement; xtask watch + manual browser refresh is sufficient for Phase 1

</deferred>

---

*Phase: 1-Infrastructure*
*Context gathered: 2026-05-19*
