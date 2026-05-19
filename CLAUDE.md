<!-- GSD:project-start source:PROJECT.md -->
## Project

**Metronome**

A browser-based metronome with a TypeScript/JS UI and a Rust-compiled WebAssembly audio engine. Runs on macOS and Android browsers. The WASM layer synthesizes clicks and mixes white noise directly, communicating with an AudioWorklet for sub-10ms timing precision.

**Core Value:** Clicks that land on time, every time — the audio engine must be low-latency and drift-free, or the app is useless.

### Constraints

- **Platform**: Browser only (macOS + Android Chrome/Safari) — no native runtime
- **Audio latency**: Scheduling gaps must not exceed 10ms; clicks must not drift
- **WASM toolchain**: Rust + wasm-pack + wasm-bindgen
- **UI**: TypeScript (framework TBD in requirements phase)
- **No backend**: Fully client-side; any persistence is localStorage
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Rust → WASM Toolchain
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Rust (stable) | 1.77+ | Audio engine source language | No GC pauses; deterministic allocation; SIMD available; the right language for sample-level DSP |
| `wasm-bindgen` | 0.2.120 | JS/WASM FFI glue + TypeScript bindings | De-facto standard; 225M+ downloads; active maintenance under new `wasm-bindgen` org after rustwasm org retirement (Sep 2025). Generates TypeScript types automatically. |
| `wasm-bindgen-cli` | match crate version | CLI that post-processes the `.wasm` and emits JS/TS glue | Must be pinned to exact same version as the `wasm-bindgen` crate — version mismatch produces cryptic failures. |
| `wasm-opt` (Binaryen) | latest from binaryen releases | Binary size + performance optimizer | Reduces `.wasm` size 10–30% beyond LLVM output; used by wasm-pack, Emscripten, Kotlin/Wasm. Required pass for production. |
# Step 1: compile
# Step 2: generate JS/TS glue
# Step 3: optimize binary
### AudioWorklet + WASM Integration
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Web Audio API (`AudioWorkletProcessor`) | Browser-native | Real-time audio rendering thread | Only reliable sub-10ms audio thread in the browser; avoids main-thread GC jank; sample-accurate scheduling |
| `SharedArrayBuffer` + `Atomics` | Browser-native | Lock-free ring buffer between main thread and AudioWorklet | Message-passing via `postMessage` introduces latency and allocations; `SharedArrayBuffer` provides the zero-copy path needed for click-scheduling data |
| COOP/COEP headers | Server config | Required to unlock `SharedArrayBuffer` | Mandatory since Chrome 92; without these headers `typeof SharedArrayBuffer === "undefined"` in the page |
### Build Tooling
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vite | 6.x | Dev server + production bundler | Native ESM, HMR under 50ms, Rollup-based production output, Brotli compression, esbuild minifier. Vite 6 explicitly supports Svelte 5 runes + `.svelte.ts` extensions. |
| `vite-plugin-wasm` | latest | WASM ESM integration | Adds WebAssembly ESM integration to Vite (mirrors Webpack's `asyncWebAssembly`). Supports Vite 2–8, wasm-pack output, dev + production + SSR + Vitest. Must be applied to both `plugins` and `worker.plugins` arrays to support Firefox. |
| `vite-plugin-top-level-await` | latest | Enables top-level `await` for broader browser compat | Required alongside `vite-plugin-wasm` unless targeting `esnext` only. Needed for Firefox Worker support. |
### UI Framework
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Svelte | 5.x | Component UI layer | Compiler-based: zero runtime shipped to browser. No Virtual DOM. Runes provide fine-grained reactivity without GC-heavy re-render cycles. 45% smaller bundles than React in real-world measurements. The 62.4% "most admired" framework in Stack Overflow 2025 survey. |
| TypeScript | 5.x | Language for all UI + glue code | Structural type safety; Vite transpiles via Oxc (fast); `wasm-bindgen` generates `.d.ts` files that TypeScript will consume directly — the types bridge Rust structs to TypeScript with no manual declaration. |
### Testing
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `cargo test` (native) | Rust toolchain | Unit tests for pure DSP logic | Runs on the host CPU — no browser needed. Test oscillator math, envelope curves, beat-scheduling logic by extracting them into pure Rust functions with no `wasm-bindgen` dependencies. This is the primary unit test surface. |
| `wasm-bindgen-test` | matches wasm-bindgen | Integration tests for WASM/JS boundary | Tests can run in headless Chrome/Firefox via `wasm-bindgen-test-runner`. Use for verifying the FFI boundary (e.g., parameter serialization), not for AudioWorklet-specific behavior. |
| Vitest | 3.x | TypeScript/UI unit tests | Vite-native, Jest-compatible API. Use `vite-plugin-wasm` in vitest config to resolve WASM ESM issues. Test UI components and scheduling logic that runs on the main thread. |
| Playwright | latest | E2E browser tests | Only tool that can test actual AudioWorklet behavior in a real browser context. Verify: app loads, WASM initializes, COOP/COEP headers are present (`crossOriginIsolated === true`), clicks fire. Android Chrome can be tested via remote debug or BrowserStack. |
### Deployment
| Technology | Purpose | Notes |
|------------|---------|-------|
| Netlify / Vercel / Cloudflare Pages | Static hosting | All three support custom response headers natively — critical for COOP/COEP |
| HTTPS (any provider) | Required for `SharedArrayBuffer` | Must be a Secure Context; no exceptions |
### Android Chrome Considerations
- AudioContext creation requires a user gesture on Android; autoplay policy is stricter than desktop.
- AudioWorklet processor initialization latency on mid-range Android devices is higher — test on a real device, not just emulators.
- `sampleRate` may vary (44100 vs 48000Hz) between devices; the WASM DSP layer must be `sampleRate`-agnostic.
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| WASM toolchain | Manual cargo + wasm-bindgen-cli | wasm-pack | Deprecated Sep 2025; musl allocator perf regression; broken v0.14.0 npm dist |
| WASM build orchestration | mise + manual pipeline | Trunk | Trunk is opinionated, primarily for Yew/Dioxus apps; adds complexity for a standalone WASM library |
| UI framework | Svelte 5 | React 19 | React runtime overhead unnecessary; WASM binary already large; Svelte compiles away |
| UI framework | Svelte 5 | SolidJS | Smaller ecosystem; fewer third-party components; less tooling integration |
| Build tool | Vite 6 | Webpack | Webpack WASM support works but config is more complex; slower HMR; no native Svelte 5 support |
| E2E testing | Playwright | Puppeteer | Playwright has better multi-browser support (Chromium + Firefox + WebKit), better Android remote debug, maintained by Microsoft |
| Deployment | Netlify/Vercel | GitHub Pages | GitHub Pages cannot set COOP/COEP headers; SharedArrayBuffer requires these |
## Installation
# Rust toolchain
# Install wasm-opt from binaryen releases (not via wasm-pack)
# e.g., via mise: mise install binaryen
# Node/JS packages
# Testing
# Cargo.toml dev-dependencies
# wasm-bindgen-test = "0.3"   (matches wasm-bindgen minor version)
## Key Version Constraints
- `wasm-bindgen` crate version **must exactly match** `wasm-bindgen-cli` binary version. Use a `.cargo/config.toml` or CI check to enforce this.
- Vite build `target` must be `"es2020"` or higher when using `vite-plugin-wasm`.
- `vite-plugin-wasm` must appear in both `plugins` (main thread) and `worker.plugins` (worker thread) in `vite.config.ts` to avoid Firefox breakage.
## Sources
- wasm-bindgen crates.io: https://crates.io/crates/wasm-bindgen (v0.2.120, active)
- wasm-bindgen GitHub (new org): https://github.com/wasm-bindgen/wasm-bindgen
- wasm-pack latest release (v0.15.0): https://github.com/wasm-bindgen/wasm-pack/releases
- rustwasm org sunsetting announcement: https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org/
- Life after wasm-pack: https://nickb.dev/blog/life-after-wasm-pack-an-opinionated-deconstruction/
- Official wasm-bindgen AudioWorklet example: https://rustwasm.github.io/docs/wasm-bindgen/examples/wasm-audio-worklet.html
- Chrome AudioWorklet design pattern: https://developer.chrome.com/blog/audio-worklet-design-pattern/
- SharedArrayBuffer AudioWorklet + Worker pattern: https://googlechromelabs.github.io/web-audio-samples/audio-worklet/design-pattern/shared-buffer/
- COOP/COEP making cross-origin isolation: https://web.dev/articles/coop-coep
- vite-plugin-wasm (Menci): https://github.com/Menci/vite-plugin-wasm
- Binaryen wasm-opt optimizer: https://github.com/WebAssembly/binaryen
- wasm-bindgen-test guide: https://rustwasm.github.io/docs/wasm-bindgen/wasm-bindgen-test/index.html
- WASM + AudioWorklet WASM Synth real-world example: https://joellof.com/rs-wasm-ts-worklet/
- FM Synthesis in browser with Rust WASM: https://cprimozic.net/blog/fm-synth-rust-wasm-simd/
- waw-rs framework (Rust AudioWorklet abstraction): https://github.com/Marcel-G/waw-rs
- Svelte 5 vs React bundle size case study: https://dev.to/johalputt/case-study-we-cut-bundle-size-by-45-using-svelte-50-and-vite-60-10jp
- Netlify COOP/COEP support forum: https://answers.netlify.com/t/react-website-getting-sharedarraybuffer-error-due-to-coop-and-coep/41705
- Setting COOP/COEP on static hosts: https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
