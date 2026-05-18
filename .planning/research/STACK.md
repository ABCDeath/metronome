# Technology Stack

**Project:** Metronome — Browser-based metronome with Rust WASM audio engine
**Researched:** 2026-05-18
**Overall confidence:** HIGH (all core choices verified against current official docs and ecosystem activity)

---

## Recommended Stack

### Rust → WASM Toolchain

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Rust (stable) | 1.77+ | Audio engine source language | No GC pauses; deterministic allocation; SIMD available; the right language for sample-level DSP |
| `wasm-bindgen` | 0.2.120 | JS/WASM FFI glue + TypeScript bindings | De-facto standard; 225M+ downloads; active maintenance under new `wasm-bindgen` org after rustwasm org retirement (Sep 2025). Generates TypeScript types automatically. |
| `wasm-bindgen-cli` | match crate version | CLI that post-processes the `.wasm` and emits JS/TS glue | Must be pinned to exact same version as the `wasm-bindgen` crate — version mismatch produces cryptic failures. |
| `wasm-opt` (Binaryen) | latest from binaryen releases | Binary size + performance optimizer | Reduces `.wasm` size 10–30% beyond LLVM output; used by wasm-pack, Emscripten, Kotlin/Wasm. Required pass for production. |

**Do NOT use:** `wasm-pack` as the primary build orchestrator. It was deprecated in September 2025 alongside the rustwasm GitHub org retirement. Its `wasm-opt` bundling has known 10x performance regressions on Linux (musl allocator), it autogenerates a `package.json` that is almost never what you want, and v0.14.0 had broken npm distribution. The latest release is v0.15.0 (May 2026) with some fixes, but the community is migrating away to a manual pipeline.

**Use instead:** A three-step manual build pipeline:
```bash
# Step 1: compile
cargo build --release --target wasm32-unknown-unknown

# Step 2: generate JS/TS glue
wasm-bindgen --target web \
  ./target/wasm32-unknown-unknown/release/metronome_engine.wasm \
  --out-dir ./src/wasm

# Step 3: optimize binary
wasm-opt -O3 ./src/wasm/metronome_engine_bg.wasm \
  -o ./src/wasm/metronome_engine_bg.wasm
```

Pin `wasm-bindgen-cli` and `wasm-opt` versions in a `.tool-versions` or `mise.toml` to prevent version drift.

**Target:** `wasm32-unknown-unknown` (not `wasm32-wasi`). AudioWorklet runs in a browser environment with no WASI host, so `unknown-unknown` is correct.

---

### AudioWorklet + WASM Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Web Audio API (`AudioWorkletProcessor`) | Browser-native | Real-time audio rendering thread | Only reliable sub-10ms audio thread in the browser; avoids main-thread GC jank; sample-accurate scheduling |
| `SharedArrayBuffer` + `Atomics` | Browser-native | Lock-free ring buffer between main thread and AudioWorklet | Message-passing via `postMessage` introduces latency and allocations; `SharedArrayBuffer` provides the zero-copy path needed for click-scheduling data |
| COOP/COEP headers | Server config | Required to unlock `SharedArrayBuffer` | Mandatory since Chrome 92; without these headers `typeof SharedArrayBuffer === "undefined"` in the page |

**WASM loading pattern for AudioWorklet:** AudioWorklet runs in an isolated `AudioWorkletGlobalScope` that cannot make network requests. The `.wasm` binary must be transferred to the worklet thread via `postMessage` (as an `ArrayBuffer`) from the main thread, then instantiated inside the worklet using `WebAssembly.instantiate()`. Do NOT attempt to `fetch()` inside the worklet processor.

The official `wasm-bindgen` AudioWorklet example demonstrates encapsulating this in Rust so the application developer avoids maintaining custom JS scaffolding. See: https://rustwasm.github.io/docs/wasm-bindgen/examples/wasm-audio-worklet.html

**For threading (if needed):** `wasm-bindgen-rayon` enables Rayon-based parallelism in WASM via SharedArrayBuffer + Web Workers. This metronome does not require multi-threaded WASM DSP in v1 (click synthesis is simple), but the architecture should not preclude it.

**Timing strategy:** The AudioWorklet `process()` callback is called every ~2.67ms (128 frames at 48kHz). Use a lookahead scheduler: on each `process()` call, check how many beats fall within the next ~100ms window and pre-schedule them sample-accurately using `currentTime`. This is the standard drift-free approach; it completely avoids `setTimeout`/`setInterval` drift.

---

### Build Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vite | 6.x | Dev server + production bundler | Native ESM, HMR under 50ms, Rollup-based production output, Brotli compression, esbuild minifier. Vite 6 explicitly supports Svelte 5 runes + `.svelte.ts` extensions. |
| `vite-plugin-wasm` | latest | WASM ESM integration | Adds WebAssembly ESM integration to Vite (mirrors Webpack's `asyncWebAssembly`). Supports Vite 2–8, wasm-pack output, dev + production + SSR + Vitest. Must be applied to both `plugins` and `worker.plugins` arrays to support Firefox. |
| `vite-plugin-top-level-await` | latest | Enables top-level `await` for broader browser compat | Required alongside `vite-plugin-wasm` unless targeting `esnext` only. Needed for Firefox Worker support. |

**Vite config skeleton:**
```typescript
// vite.config.ts
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  build: { target: "es2020" },
  worker: {
    plugins: () => [wasm(), topLevelAwait()]
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  }
});
```

The `server.headers` block injects COOP/COEP during `vite dev`. Production deployment requires the same headers at the HTTP layer (see Deployment section).

**Do NOT use:** `vite-plugin-wasm-pack` (the nshen/vite-plugin-wasm-pack variant) — it wraps wasm-pack which is being deprecated. `vite-plugin-wasm` (Menci) handles wasm-pack output directly and is more broadly maintained.

---

### UI Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Svelte | 5.x | Component UI layer | Compiler-based: zero runtime shipped to browser. No Virtual DOM. Runes provide fine-grained reactivity without GC-heavy re-render cycles. 45% smaller bundles than React in real-world measurements. The 62.4% "most admired" framework in Stack Overflow 2025 survey. |
| TypeScript | 5.x | Language for all UI + glue code | Structural type safety; Vite transpiles via Oxc (fast); `wasm-bindgen` generates `.d.ts` files that TypeScript will consume directly — the types bridge Rust structs to TypeScript with no manual declaration. |

**Why not React:** React 19 carries a heavier runtime (~40KB gzipped) and has a VDOM reconciliation cycle. For an audio app where the UI is secondary to the audio engine, Svelte's compile-away approach means the app bundle is dominated by the WASM binary, not the UI framework. React would be appropriate if the team has strong existing expertise, but Svelte is the better technical fit here.

**Why not SolidJS:** SolidJS has fine-grained reactivity comparable to Svelte but a significantly smaller community, fewer third-party components, and near-zero job market presence. The Svelte ecosystem is more mature for tooling (Vite 6 native support, SvelteKit if needed later).

---

### Testing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `cargo test` (native) | Rust toolchain | Unit tests for pure DSP logic | Runs on the host CPU — no browser needed. Test oscillator math, envelope curves, beat-scheduling logic by extracting them into pure Rust functions with no `wasm-bindgen` dependencies. This is the primary unit test surface. |
| `wasm-bindgen-test` | matches wasm-bindgen | Integration tests for WASM/JS boundary | Tests can run in headless Chrome/Firefox via `wasm-bindgen-test-runner`. Use for verifying the FFI boundary (e.g., parameter serialization), not for AudioWorklet-specific behavior. |
| Vitest | 3.x | TypeScript/UI unit tests | Vite-native, Jest-compatible API. Use `vite-plugin-wasm` in vitest config to resolve WASM ESM issues. Test UI components and scheduling logic that runs on the main thread. |
| Playwright | latest | E2E browser tests | Only tool that can test actual AudioWorklet behavior in a real browser context. Verify: app loads, WASM initializes, COOP/COEP headers are present (`crossOriginIsolated === true`), clicks fire. Android Chrome can be tested via remote debug or BrowserStack. |

**Testing architecture (recommended layering):**
1. **Rust unit tests** (`cargo test`): pure DSP math, scheduling algorithms, beat-pattern logic — no WASM, no browser
2. **wasm-bindgen-test**: FFI boundary only — parameter passing, struct marshaling
3. **Vitest**: main-thread TypeScript — AudioWorklet node setup, UI state, BPM controls
4. **Playwright**: full integration — audio init, click scheduling, COOP/COEP header verification

**Do NOT test AudioWorklet DSP in Vitest/Jest with mocks.** The `AudioWorkletGlobalScope` is not in the main thread scope; mock-based approaches miss real threading and timing bugs. Playwright with a real Chrome instance is the correct E2E layer.

---

### Deployment

| Technology | Purpose | Notes |
|------------|---------|-------|
| Netlify / Vercel / Cloudflare Pages | Static hosting | All three support custom response headers natively — critical for COOP/COEP |
| HTTPS (any provider) | Required for `SharedArrayBuffer` | Must be a Secure Context; no exceptions |

**COOP/COEP is mandatory.** Without these headers, `SharedArrayBuffer` is undefined in the browser and the lock-free ring buffer between main thread and AudioWorklet cannot be constructed. Every deployment target must emit:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Platform config:**

Netlify `netlify.toml`:
```toml
[[headers]]
  for = "/*"
  [headers.values]
  Cross-Origin-Opener-Policy = "same-origin"
  Cross-Origin-Embedder-Policy = "require-corp"
```

Vercel `vercel.json`:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

**GitHub Pages:** Does NOT support custom response headers natively. The `coi-serviceworker` workaround registers a Service Worker that patches headers on first load and reloads the page. This works but adds a blank-screen flash on first visit. Avoid GitHub Pages if possible; use Netlify or Cloudflare Pages.

**COEP `credentialless` vs `require-corp`:** `credentialless` is supported by Chrome and relaxes restrictions on cross-origin subresources, but Firefox does not implement it. Use `require-corp` for cross-browser compatibility. If this blocks embedding third-party resources (e.g., fonts from Google Fonts), self-host them instead.

---

### Android Chrome Considerations

Android Chrome fully supports the AudioWorklet + SharedArrayBuffer stack (Chrome 92+, COOP/COEP enforced). Known issues to test explicitly:

- AudioContext creation requires a user gesture on Android; autoplay policy is stricter than desktop.
- AudioWorklet processor initialization latency on mid-range Android devices is higher — test on a real device, not just emulators.
- `sampleRate` may vary (44100 vs 48000Hz) between devices; the WASM DSP layer must be `sampleRate`-agnostic.

---

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

---

## Installation

```bash
# Rust toolchain
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli        # pin to wasm-bindgen crate version
# Install wasm-opt from binaryen releases (not via wasm-pack)
# e.g., via mise: mise install binaryen

# Node/JS packages
npm install -D vite vite-plugin-wasm vite-plugin-top-level-await
npm install svelte @sveltejs/vite-plugin-svelte typescript

# Testing
npm install -D vitest playwright @playwright/test

# Cargo.toml dev-dependencies
# wasm-bindgen-test = "0.3"   (matches wasm-bindgen minor version)
```

---

## Key Version Constraints

- `wasm-bindgen` crate version **must exactly match** `wasm-bindgen-cli` binary version. Use a `.cargo/config.toml` or CI check to enforce this.
- Vite build `target` must be `"es2020"` or higher when using `vite-plugin-wasm`.
- `vite-plugin-wasm` must appear in both `plugins` (main thread) and `worker.plugins` (worker thread) in `vite.config.ts` to avoid Firefox breakage.

---

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
