# Phase 1: Infrastructure — Research

**Researched:** 2026-05-19
**Domain:** Rust WASM → AudioWorklet → SharedArrayBuffer stack wiring; cargo-xtask dev orchestration; Vite 6 + Svelte 5 scaffolding
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Svelte 5 with Vite 6 as the frontend framework.
- **D-02:** Single repo — `rust/` (Cargo crate) + `src/` (Svelte/TS) + root `package.json`.
- **D-03:** WASM output to `rust/pkg/` → copied to `public/wasm/`. No vite-plugin-wasm. Explicit copy step.
- **D-04:** `cargo-xtask` build orchestrator at `xtask/` workspace member crate.
- **D-05:** `cargo xtask dev` spawns Vite dev server + watches `rust/` for changes.
- **D-06:** `cargo xtask build`: `cargo build --target wasm32-unknown-unknown` → `wasm-bindgen-cli` → `wasm-opt` → copy to `public/wasm/`.
- **D-07:** WASM compiled on main thread via `WebAssembly.compile()`, transferred to AudioWorklet via `processorOptions` in `AudioWorkletNode` constructor.
- **D-08:** AudioWorklet processor uses `#[no_mangle] pub extern "C" fn` exports only — no wasm-bindgen JS glue in worklet hot path.
- **D-09:** Toolchain: `cargo build` → `wasm-bindgen-cli` → `wasm-opt`. Do not use wasm-pack (deprecated September 2025).
- **D-10:** COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) configured in `vite.config.ts` server headers from day one. `crossOriginIsolated === true` is the validation signal.
- **D-11:** SPSC ring buffer and Atomics parameter buffer pre-allocated at init time. Zero allocations in `process()` — hard requirement.
- **D-12:** `AudioContext` created only on first user gesture (Play button click). AudioContext state must reach `"running"` before any scheduling begins.

### Claude's Discretion

- Exact Vite config structure (plugins, resolve aliases) — standard Svelte 5 + Vite 6 setup.
- xtask internal implementation details — use `notify` crate for fs watching, `std::process::Command` for Vite.
- Ring buffer size — 256–512 entries typical; tune based on 100ms lookahead window.
- WASM memory page count — default sufficient for Phase 1 silence-only module.

### Deferred Ideas (OUT OF SCOPE)

- Deployment target / production COOP/COEP header setup — Phase 5.
- Hot module replacement for Rust changes — xtask watch + manual browser refresh is sufficient.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLATFORM-03 | AudioContext activated only after a user gesture (autoplay policy compliance) | D-12; Pitfall 1 prevention; gate pattern documented below |
| PLATFORM-04 | Server/dev server serves COOP and COEP headers (required for SharedArrayBuffer) | D-10; Vite 6 `server.headers` config; `crossOriginIsolated` verification |
| AUDIO-03 | Audio engine achieves scheduling gaps of no more than 10ms between clicks at any BPM | Requires AudioWorklet `process()` loop to run without errors; WASM loaded and silence produced in Phase 1 proves the pipeline; scheduler built in Phase 2 |
| AUDIO-04 | Clicks consistent in length and amplitude across all tempos | Requires `AudioContext.sampleRate` read at runtime; WASM init with sample rate; Phase 1 establishes the WASM init handshake that delivers `sampleRate` |

</phase_requirements>

---

## Summary

Phase 1 establishes the thinnest viable end-to-end slice of the WASM → AudioWorklet → SharedArrayBuffer stack. No audible sound is produced. The deliverable is proof that every prerequisite for sound is in place: WASM compiles and instantiates inside the AudioWorklet, the SharedArrayBuffer ring buffer and Atomics parameter buffer are allocated and accessible from both threads, the play button is correctly gated behind a user gesture, and `process()` runs silence without error.

The stack is well-understood with many authoritative sources. The primary risk is the intersection of three constraints that individually have good documentation but are rarely combined in a single project: the manual (non-wasm-pack) build pipeline, the `#[no_mangle]`-only export strategy for the worklet hot path, and the no-vite-plugin-wasm static-file serving approach for the AudioWorklet processor script. Each of these is a deliberate and justified choice; the planner must treat them as locked and wire them together correctly.

The cargo-xtask pattern is idiomatic and well-supported. The `xtask-watch` crate (built on `notify`) is the correct tool for the file-watching requirement — it avoids reimplementing debounced fs event loops from scratch. `std::process::Command` is the correct primitive for spawning the Vite dev server child process.

**Primary recommendation:** Scaffold in dependency order — COOP/COEP headers first (validates SharedArrayBuffer access before any Rust is written), then Cargo workspace + WASM minimal crate, then xtask orchestration, then the AudioWorklet processor JS file, then the main-thread TypeScript bootstrap. Verify each layer independently before wiring the next.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WASM compilation and post-processing | Build tooling (xtask) | — | cargo build + wasm-bindgen-cli + wasm-opt is a build-time concern |
| COOP/COEP headers | Dev server (Vite config) | — | Must be emitted by the HTTP layer; no runtime JS can set response headers |
| WASM module fetch and compile | Main thread (TypeScript) | — | `fetch` and `WebAssembly.compile` unavailable in AudioWorkletGlobalScope |
| WASM module transfer to worklet | Main thread → AudioWorklet | processorOptions | `WebAssembly.Module` is serializable/transferable via structured clone |
| WASM instantiation | AudioWorklet (JS glue) | — | Worklet owns its own `WebAssembly.Instance` |
| `process()` hot path | AudioWorklet thread | WASM (called by process) | AudioWorklet runs on audio-priority OS thread |
| SharedArrayBuffer allocation | Main thread | — | Must be allocated before being passed to the worklet |
| User gesture gate | Main thread (UI event handler) | — | AudioContext must be created or resumed inside the click handler |
| AudioContext ownership | Main thread | — | AudioContext lives on the main thread; worklet connects to it |
| Static WASM binary serving | Vite static asset serving (public/) | — | Files in `public/` served as-is; no bundler processing |
| AudioWorklet processor script serving | Vite static asset serving (public/) | — | `processor.js` must be served at a stable, unbundled URL |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Rust (stable) | 1.86+ (MSRV for wasm-bindgen-cli) | Audio engine source | No GC; deterministic allocation; SIMD available; wasm-bindgen-cli MSRV is 1.86 [VERIFIED: crates.io] |
| wasm-bindgen (crate) | 0.2.120 | JS/WASM FFI; generates `.d.ts` for main-thread use | Latest stable as of 2026-04-28; 225M+ downloads; actively maintained [VERIFIED: crates.io] |
| wasm-bindgen-cli | **must match crate exactly** — 0.2.120 | Post-processes `.wasm`, emits JS/TS glue | Version mismatch produces cryptic failures; pin to crate version [CITED: crates.io/crates/wasm-bindgen] |
| wasm-opt (Binaryen) | latest from binaryen GitHub releases | Binary optimizer; 10-30% size reduction | Required production pass; install via mise or direct binary [ASSUMED] |
| wasm32-unknown-unknown target | rustup target | Browser WASM target | No WASI host in AudioWorkletGlobalScope; correct target [CITED: wasm-bindgen guide] |
| Vite | 8.0.13 | Dev server + bundler | Latest stable [VERIFIED: npm registry]; COOP/COEP via `server.headers` |
| Svelte | 5.55.8 | UI framework | Latest stable [VERIFIED: npm registry]; compiler-based, zero runtime |
| @sveltejs/vite-plugin-svelte | 7.1.2 | Svelte integration for Vite | Latest stable [VERIFIED: npm registry]; official plugin |
| TypeScript | 5.x | UI and glue code | wasm-bindgen generates `.d.ts`; structural safety |
| xtask-watch | 0.3.4 | File watching inside xtask | Built on `notify`; implements clap::Parser; designed for xtask pattern [CITED: crates.io/crates/xtask-watch] |
| notify | 9.0.0-rc.4 (or stable 6.x) | Cross-platform fs events | Used by cargo-watch, rust-analyzer, Deno; xtask-watch depends on it [CITED: crates.io/crates/notify] |

> **notify version note:** 9.0.0 is an RC as of research date. If `xtask-watch` pins an older `notify`, let it resolve transitively rather than forcing 9.x. [ASSUMED]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.6 | TS unit tests | Main-thread TypeScript; scheduling logic [VERIFIED: npm registry] |
| @sveltejs/vite-plugin-svelte | 7.1.2 | Already listed | Already listed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual cargo + wasm-bindgen-cli | wasm-pack | wasm-pack deprecated Sep 2025; known musl allocator perf regression; broken npm dist in v0.14.0 [CITED: STACK.md, rustwasm org sunsetting] |
| xtask-watch crate | Raw `notify` directly | xtask-watch reduces boilerplate for the specific xtask watch pattern; acceptable to use raw notify if xtask-watch has version conflicts |
| Static `public/` for processor.js | vite-plugin-audioworklet | The static approach is simpler and more debuggable; avoids bundler URL renaming the worklet file |
| No vite-plugin-wasm (D-03 decision) | vite-plugin-wasm | D-03 is locked; explicit copy to `public/wasm/` keeps AudioWorklet loading simple |

**Installation:**

```bash
# Rust toolchain — in project root
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.120  # pin to match Cargo.toml dep

# wasm-opt — install via mise (or download binary from binaryen GitHub releases)
# mise install binaryen  (if using mise)

# JS packages
npm create vite@latest . -- --template svelte-ts  # scaffold if starting fresh
npm install -D vite @sveltejs/vite-plugin-svelte svelte typescript
npm install -D vitest

# xtask Cargo.toml dependencies (in xtask/Cargo.toml)
# xtask-watch = "0.3"
# clap = { version = "4", features = ["derive"] }
```

---

## Package Legitimacy Audit

slopcheck was installed (v0.6.1) but its `install` subcommand requires npm package names and returned exit code 2 for Rust crate names. Rust crates are verified via crates.io API directly. npm packages verified via `npm view`.

| Package | Registry | Source | slopcheck | Disposition |
|---------|----------|--------|-----------|-------------|
| wasm-bindgen 0.2.120 | crates.io | github.com/wasm-bindgen/wasm-bindgen | N/A (Rust) | Approved — 8+ years, canonical |
| wasm-bindgen-cli 0.2.120 | crates.io | same repo | N/A (Rust) | Approved — official CLI companion |
| xtask-watch 0.3.4 | crates.io | github.com/rustminded/xtask-watch | N/A (Rust) | Approved — purpose-built for this pattern |
| notify 9.0.0-rc.4 | crates.io | github.com/notify-rs/notify | N/A (Rust) | Approved (RC) — used by Deno, rust-analyzer |
| vite 8.0.13 | npm | github.com/vitejs/vite | N/A (major OSS) | Approved |
| svelte 5.55.8 | npm | github.com/sveltejs/svelte | N/A (major OSS) | Approved |
| @sveltejs/vite-plugin-svelte 7.1.2 | npm | github.com/sveltejs/vite-plugin-svelte | N/A (official) | Approved |
| vitest 4.1.6 | npm | github.com/vitest-dev/vitest | N/A (major OSS) | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Note: `wasm-bindgen` npm package on the registry is a security placeholder (`0.0.1-security`). The correct package is the Rust crate on crates.io — confirmed [VERIFIED: npm registry, crates.io].*

---

## Architecture Patterns

### System Architecture Diagram

```
[Browser — Page Load]
        │
        ├─ fetch('/wasm/metronome_engine.wasm')
        │       ↓
        │  WebAssembly.compile(buffer) → WebAssembly.Module
        │       ↓
        ├─ audioCtx.audioWorklet.addModule('/worklet/processor.js')
        │       ↓
        └─ new AudioWorkletNode(ctx, 'metronome-processor', {
                     processorOptions: { wasmModule }
               })
               │
               │  [structured clone — WebAssembly.Module transferred]
               ▼
[AudioWorkletGlobalScope — audio-priority OS thread]
        │
        ├─ constructor: WebAssembly.instantiate(wasmModule, imports)
        │       ↓
        │  exports.get_output_buffer_ptr() → wasmOutputPtr
        │       ↓
        │  new Float32Array(memory.buffer, wasmOutputPtr, 128)  ← created ONCE
        │
        └─ process(inputs, outputs):
               ├─ [read SharedArrayBuffer ring — beat events from main thread]
               ├─ [Atomics.load paramBuffer]
               ├─ exports.fill_output_buffer(beatFlags, noiseGain)
               │       ↓
               │  [WASM/Rust writes 128 × f32 silence to static AUDIO_OUT buffer]
               │
               ├─ outputs[0][0].set(wasmOutputView)  ← copy 128 f32, no alloc
               └─ return true

[Main Thread — after AudioWorkletNode 'ready' message]
        ├─ Allocate SharedArrayBuffer (SPSC ring + Atomics param buffer)
        └─ Await user gesture (Play click) → AudioContext.resume()
               ↓
           [Phase 2: start lookahead scheduler]

[xtask dev — build loop, runs on host]
        ├─ cargo build --target wasm32-unknown-unknown (rust/)
        ├─ wasm-bindgen-cli → rust/pkg/
        ├─ wasm-opt → rust/pkg/
        ├─ copy rust/pkg/*.wasm → public/wasm/
        └─ spawn: vite dev (watches src/)
               [notify watches rust/src/ → triggers rebuild loop]
```

### Recommended Project Structure

```
metronome/
├── Cargo.toml              # workspace root: members = ["rust", "xtask"]
├── rust/
│   ├── Cargo.toml          # [lib] crate-type = ["cdylib"]
│   └── src/
│       └── lib.rs          # #[no_mangle] exports: get_output_buffer_ptr, fill_output_buffer
├── xtask/
│   ├── Cargo.toml          # bin crate; deps: xtask-watch, clap, std::process::Command
│   └── src/
│       └── main.rs         # cargo xtask dev | cargo xtask build
├── .cargo/
│   └── config.toml         # [alias] xtask = "run --package xtask --"
├── src/                    # Svelte + TypeScript
│   ├── main.ts             # app entry: bootstraps AudioContext, loads WASM, creates AudioWorkletNode
│   └── App.svelte          # Play button + UI
├── public/
│   ├── wasm/               # copied here by xtask build (served as static assets)
│   │   └── metronome_engine_bg.wasm
│   └── worklet/
│       └── processor.js    # AudioWorklet processor — plain JS, NOT processed by bundler
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Pattern 1: Cargo Workspace with xtask

**What:** Root `Cargo.toml` declares a workspace with two members. The `.cargo/config.toml` alias makes `cargo xtask` resolve to `cargo run --package xtask --`.

**When to use:** Always for this project — it is D-04.

```toml
# Cargo.toml (root)
[workspace]
members = ["rust", "xtask"]
resolver = "2"
```

```toml
# .cargo/config.toml
[alias]
xtask = "run --package xtask --"
```

```toml
# xtask/Cargo.toml
[package]
name = "xtask"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "xtask"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
xtask-watch = "0.3"
```

### Pattern 2: xtask dev — Spawning Vite + Watching Rust

**What:** `cargo xtask dev` spawns the Vite dev server as a child process and uses `xtask-watch` to re-run `cargo xtask build-wasm` on changes to `rust/src/`.

**When to use:** D-05.

```rust
// xtask/src/main.rs (skeleton)
use clap::{Parser, Subcommand};
use std::process::Command;

#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Dev,
    Build,
    BuildWasm,
}

fn main() {
    let args = Args::parse();
    match args.cmd {
        Cmd::Dev => {
            // Spawn Vite dev server
            let _vite = Command::new("npm")
                .args(["run", "dev"])
                .spawn()
                .expect("failed to spawn vite");

            // Watch rust/src, re-run build-wasm on change
            // xtask-watch handles the notify loop + debounce
            xtask_watch::Watch::new()
                .run(|| {
                    let status = Command::new(env!("CARGO"))
                        .args(["xtask", "build-wasm"])
                        .status()
                        .expect("build-wasm failed");
                    status.success().then_some(()).ok_or("build failed")
                })
                .expect("watch failed");
        }
        Cmd::Build => {
            build_wasm();
        }
        Cmd::BuildWasm => {
            build_wasm();
        }
    }
}

fn build_wasm() {
    // Step 1: cargo build
    Command::new(env!("CARGO"))
        .args(["build", "--release", "--target", "wasm32-unknown-unknown",
               "--manifest-path", "rust/Cargo.toml"])
        .status().expect("cargo build failed");

    // Step 2: wasm-bindgen
    Command::new("wasm-bindgen")
        .args(["--target", "web",
               "rust/target/wasm32-unknown-unknown/release/metronome_engine.wasm",
               "--out-dir", "rust/pkg"])
        .status().expect("wasm-bindgen failed");

    // Step 3: wasm-opt
    Command::new("wasm-opt")
        .args(["-O3",
               "rust/pkg/metronome_engine_bg.wasm",
               "-o", "rust/pkg/metronome_engine_bg.wasm"])
        .status().expect("wasm-opt failed");

    // Step 4: copy to public/wasm/
    std::fs::copy(
        "rust/pkg/metronome_engine_bg.wasm",
        "public/wasm/metronome_engine_bg.wasm",
    ).expect("copy failed");
}
```

> **Note on `env!("CARGO")`:** Use this instead of hardcoding `"cargo"` to ensure the xtask uses the same Cargo binary that invoked it. [CITED: matklad/cargo-xtask README]

### Pattern 3: Minimal WASM Module — Silence Only

**What:** The Phase 1 WASM exports only what the AudioWorklet needs to run: a pointer to the static output buffer, and a function to fill it with silence. No DSP logic, no allocations.

**When to use:** Phase 1 only — replaced by click synthesis in Phase 2.

```rust
// rust/src/lib.rs
static mut AUDIO_OUT: [f32; 128] = [0.0; 128];

#[no_mangle]
pub extern "C" fn get_output_buffer_ptr() -> *const f32 {
    unsafe { AUDIO_OUT.as_ptr() }
}

/// Called every process() callback — writes silence for Phase 1.
/// beat_flags: bitmask of voices to trigger (unused in Phase 1)
/// noise_gain: float 0.0–1.0 (unused in Phase 1)
#[no_mangle]
pub extern "C" fn fill_output_buffer(_beat_flags: u32, _noise_gain: f32) {
    // Phase 1: silence. No allocation, no branching.
    unsafe {
        AUDIO_OUT.fill(0.0);
    }
}

/// Returns sample rate stored at init. Main thread passes sampleRate here.
/// Pre-wiring: not required in Phase 1 but establishes the init handshake.
#[no_mangle]
pub extern "C" fn init(sample_rate: f32) {
    // Phase 1: store for Phase 2 use.
    unsafe { SAMPLE_RATE = sample_rate; }
}

static mut SAMPLE_RATE: f32 = 44100.0;
```

```toml
# rust/Cargo.toml
[package]
name = "metronome-engine"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2.120"

[profile.release]
opt-level = 3
lto = true
```

### Pattern 4: AudioWorklet Processor — Plain JS Static File

**What:** `processor.js` lives in `public/worklet/` and is NOT processed by Vite. It receives the `WebAssembly.Module` via `processorOptions`, instantiates it, creates one `Float32Array` view, and calls `fill_output_buffer` every 128 samples.

**When to use:** D-07, D-08. This is the silence-producing skeleton for Phase 1.

```javascript
// public/worklet/processor.js
class MetronomeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasmModule } = options.processorOptions;

    // Instantiate WASM — no fetch, no TextEncoder needed
    WebAssembly.instantiate(wasmModule, {}).then(({ instance }) => {
      this._exports = instance.exports;
      this._exports.init(sampleRate); // sampleRate is a global in AudioWorkletGlobalScope

      const ptr = this._exports.get_output_buffer_ptr();
      // View into WASM linear memory — created ONCE, reused every process() call
      this._outputView = new Float32Array(
        instance.exports.memory.buffer,
        ptr,
        128
      );
      this._ready = true;
      this.port.postMessage({ type: 'ready' });
    });

    this._ready = false;
  }

  process(_inputs, outputs) {
    if (!this._ready) return true;

    this._exports.fill_output_buffer(0, 0.0);
    outputs[0][0].set(this._outputView);

    return true; // MUST return true to keep process() running
  }
}

registerProcessor('metronome-processor', MetronomeProcessor);
```

> **`sampleRate` global:** `AudioWorkletGlobalScope` exposes `sampleRate` as a read-only global, eliminating the need to pass it via processorOptions. [CITED: MDN AudioWorkletGlobalScope]

### Pattern 5: Main Thread Bootstrap — WASM Load + AudioWorklet Init

**What:** TypeScript on the main thread fetches WASM, compiles it, loads the AudioWorklet module, and constructs the AudioWorkletNode — all gated behind a user gesture.

**When to use:** D-07, D-12.

```typescript
// src/main.ts (simplified Phase 1 skeleton)
let audioCtx: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;

// Pre-load WASM binary at page load (fetch is cheap; compile is deferred to gesture)
const wasmResponse = fetch('/wasm/metronome_engine_bg.wasm');

async function onPlayClick() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ latencyHint: 'interactive' });
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  if (!workletNode) {
    // Compile WASM on main thread — fetch has already started
    const buffer = await (await wasmResponse).arrayBuffer();
    const wasmModule = await WebAssembly.compile(buffer);

    // Load the worklet script (served from public/ — stable URL)
    await audioCtx.audioWorklet.addModule('/worklet/processor.js');

    // Allocate SharedArrayBuffer regions
    // Phase 1: allocate but don't wire scheduler yet
    const controlRingSAB = new SharedArrayBuffer(
      4 + 256 * 4  // 4-byte header (indices) + 256 × 4-byte events
    );
    const paramSAB = new SharedArrayBuffer(8 * 4); // 8 × int32 params

    workletNode = new AudioWorkletNode(audioCtx, 'metronome-processor', {
      processorOptions: { wasmModule },
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1], // mono
    });

    // Transfer SABs to worklet after construction
    workletNode.port.postMessage({
      type: 'init-buffers',
      controlRing: controlRingSAB,
      paramBuffer: paramSAB,
    });

    workletNode.port.onmessage = (e) => {
      if (e.data.type === 'ready') {
        console.log('AudioWorklet ready — crossOriginIsolated:', crossOriginIsolated);
      }
    };

    workletNode.connect(audioCtx.destination);
  }
}
```

### Pattern 6: Vite Config — COOP/COEP + Svelte + Static Serving

**What:** Minimal `vite.config.ts` that satisfies D-03 (no vite-plugin-wasm), D-10 (COOP/COEP headers), and wires up Svelte 5.

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2020',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // public/ is served as-is by Vite default config — no extra config needed
  // processor.js and *.wasm in public/ will be served without bundler processing
});
```

> **No `vite-plugin-wasm` — by design (D-03).** The `.wasm` file is served from `public/wasm/` as a raw static asset. The main thread loads it via `fetch()` then `WebAssembly.compile()`. Vite does not need to understand WASM. [ASSUMED: this pattern is standard for AudioWorklet WASM; confirmed by Chrome developer docs pattern]

### Pattern 7: Svelte 5 Scaffolding

The canonical scaffolding command for Svelte 5 (no SvelteKit, standalone SPA) is:

```bash
npm create vite@latest . -- --template svelte-ts
```

This is distinct from `npx sv create` (which scaffolds SvelteKit). [CITED: svelte.dev/docs/svelte/getting-started, vite.dev/guide]

### Anti-Patterns to Avoid

- **`wasm-pack` as build orchestrator:** Deprecated September 2025. Do not use for new projects. [CITED: rustwasm org sunsetting, STACK.md]
- **Fetching WASM inside AudioWorklet processor:** `fetch`, `importScripts`, `TextEncoder`, `TextDecoder` are absent from `AudioWorkletGlobalScope`. The WASM module must arrive via `processorOptions` or `port.postMessage`. [CITED: Web Audio API Issue #1439, PITFALLS.md Pitfall 3]
- **Using wasm-bindgen high-level glue in `process()`:** Any `wasm-bindgen` wrapper that touches strings or typed arrays internally calls `TextEncoder`/`TextDecoder`. Use `#[no_mangle] extern "C"` exports only for the hot path. [CITED: PITFALLS.md Pitfall 9]
- **Missing `return true` in `process()`:** A falsy return value (including `undefined`) signals the worklet to stop and be GC'd. No error is thrown. Always `return true` when the processor should continue. [CITED: MDN AudioWorkletProcessor.process(), PITFALLS.md Pitfall 10]
- **Allocating in `process()`:** `new Float32Array()`, object literals, and string operations inside `process()` trigger the JS GC; a GC pause on a 2.9ms budget causes audible dropout. Pre-allocate everything at init time. [CITED: PITFALLS.md Pitfall 4]
- **Bundling `processor.js` with Vite:** If Vite processes the worklet file, it may rename or split it, breaking the stable URL passed to `addModule()`. Keep it in `public/` as a plain JS file. [CITED: ARCHITECTURE.md]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File system watching in xtask | Custom `notify` event loop with debouncing | `xtask-watch` crate | Already handles debouncing, re-run semantics, and clap integration; saves ~200 lines of boilerplate |
| WASM binary optimization | Custom pass | `wasm-opt` (Binaryen) | 10–30% size reduction; well-tested optimizer with years of production use |
| SPSC ring buffer from scratch | Custom lock-free queue | Pattern from `ringbuf.js` / ARCHITECTURE.md | Wait-free SPSC is subtle to get right; use the established index-swapping pattern with `Atomics.store`/`Atomics.load` |
| Custom COOP/COEP middleware | Express server | Vite `server.headers` config | One line of config, no server code |

**Key insight:** Phase 1 is infrastructure — every custom implementation adds a surface area of bugs before any DSP work has started. Use the established tools and patterns.

---

## Common Pitfalls

### Pitfall 1: wasm-bindgen-cli Version Mismatch

**What goes wrong:** `wasm-bindgen-cli` binary version does not match the `wasm-bindgen` crate version in `rust/Cargo.toml`. The CLI post-processing step fails with a cryptic error about schema version or ABI mismatch.

**Why it happens:** `wasm-bindgen` encodes its ABI version in the `.wasm` binary. The CLI checks this against its own version. Even a patch version difference fails.

**How to avoid:** Pin both to the same version. Document the pinned version in `xtask/src/main.rs` as a constant. Consider adding a CI check: `wasm-bindgen --version | grep 0.2.120`.

**Warning signs:** `wasm-bindgen: it looks like the Rust project used to create this wasm file was linked against a different version of wasm-bindgen than this binary is` — exact error message.

### Pitfall 2: processor.js Served at Wrong URL / Processed by Bundler

**What goes wrong:** `addModule('/worklet/processor.js')` returns a rejected promise with "NetworkError" or "Failed to load module script" — even though the file exists.

**Why it happens:** Either the URL path is wrong (not matching `public/worklet/processor.js` → served at `/worklet/processor.js`), or Vite processed the file and moved/renamed it, or COOP/COEP blocks the module load if the file is cross-origin (it won't be, but a misconfigured CDN prefix could cause this).

**How to avoid:** Keep `processor.js` in `public/worklet/`. Verify with `curl http://localhost:5173/worklet/processor.js` — should return the raw JS file.

**Warning signs:** Console error: "Failed to execute 'addModule' on 'AudioWorklet'" with NetworkError.

### Pitfall 3: SharedArrayBuffer Unavailable (Missing COOP/COEP)

**What goes wrong:** `typeof SharedArrayBuffer === 'undefined'` at runtime. The ring buffer cannot be constructed. Error is silent until the code attempts to use SAB.

**Why it happens:** Browser requires `Cross-Origin-Opener-Policy: same-origin` AND `Cross-Origin-Embedder-Policy: require-corp` on the page response. If either is missing, SAB is disabled. [CITED: PITFALLS.md Pitfall 2, MDN SharedArrayBuffer]

**How to avoid:** Set headers in `vite.config.ts` `server.headers`. Add a startup assertion: `if (typeof SharedArrayBuffer === 'undefined') throw new Error('SharedArrayBuffer unavailable — COOP/COEP headers missing');`. Verify `crossOriginIsolated === true` in browser console.

**Warning signs:** `typeof SharedArrayBuffer === 'undefined'`; `crossOriginIsolated === false` in browser console.

### Pitfall 4: AudioContext Created Before User Gesture

**What goes wrong:** `AudioContext` created on page load starts in `"suspended"` state. `resume()` called outside a user-gesture event handler fails silently on Chrome and throws on iOS Safari.

**How to avoid:** Create `AudioContext` inside the play button's click handler (or call `resume()` inside it if already created). Never attempt `addModule`, WASM load, or scheduling before `audioCtx.state === 'running'`. [CITED: PITFALLS.md Pitfall 1]

**Warning signs:** Console: "The AudioContext was not allowed to start. Add a user gesture handler."

### Pitfall 5: WASM Memory Growth Invalidates Float32Array View

**What goes wrong:** The `Float32Array` view over WASM linear memory (`new Float32Array(memory.buffer, ptr, 128)`) becomes detached if WASM memory grows (which reallocates the underlying `ArrayBuffer`). Reads return `0`; writes are silently dropped.

**How to avoid:** Phase 1 WASM module uses only a `static mut [f32; 128]` — no heap allocation, no memory growth. The view remains valid for the lifetime of the worklet. If WASM memory ever needs to grow, the view must be recreated after growth. [CITED: ARCHITECTURE.md]

**Warning signs:** `process()` runs without error but outputs are always zero despite WASM function being called.

---

## Code Examples

### Verified Pattern: WebAssembly.Module Transfer via processorOptions

```typescript
// Source: Chrome Developers Audio Worklet Design Pattern (HIGH confidence)
// https://developer.chrome.com/blog/audio-worklet-design-pattern/

const response = await fetch('/wasm/metronome_engine_bg.wasm');
const buffer = await response.arrayBuffer();
const wasmModule = await WebAssembly.compile(buffer);

await audioCtx.audioWorklet.addModule('/worklet/processor.js');

const node = new AudioWorkletNode(audioCtx, 'metronome-processor', {
  processorOptions: { wasmModule },
});
```

`WebAssembly.Module` is a serializable/transferable object — it passes through the structured clone algorithm. No separate `postMessage` step is required for the module itself. [CITED: MDN WebAssembly.Module, Chrome blog]

### Verified Pattern: Wait-Free SPSC Ring Buffer

```typescript
// Source: blog.paul.cx/post/a-wait-free-spsc-ringbuffer-for-the-web/ (HIGH confidence)
// Adapted from ARCHITECTURE.md

const WRITE_IDX = 0;
const READ_IDX = 1;

// Producer (main thread)
function writeBeatEvent(indices: Int32Array, data: Uint32Array, event: number, mask: number): boolean {
  const w = Atomics.load(indices, WRITE_IDX);
  const next = (w + 1) & mask;
  if (next === Atomics.load(indices, READ_IDX)) return false; // full
  data[w] = event;
  Atomics.store(indices, WRITE_IDX, next);
  return true;
}

// Consumer (AudioWorklet — no allocation, no wait)
function readBeatEvent(indices: Int32Array, data: Uint32Array, mask: number): number | null {
  const r = Atomics.load(indices, READ_IDX);
  if (r === Atomics.load(indices, WRITE_IDX)) return null; // empty
  const event = data[r];
  Atomics.store(indices, READ_IDX, (r + 1) & mask);
  return event;
}
```

### Verified Pattern: Atomics Parameter Buffer

```typescript
// Source: ARCHITECTURE.md (HIGH confidence, corroborated by Chrome AudioWorklet design pattern)

const NOISE_GAIN_IDX = 0;
const IS_PLAYING_IDX = 1;

// Main thread write
Atomics.store(paramBuffer, IS_PLAYING_IDX, 1);

// AudioWorklet read (inside process() — no allocation)
const isPlaying = Atomics.load(paramBuffer, IS_PLAYING_IDX);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `wasm-pack` as WASM build tool | Manual `cargo + wasm-bindgen-cli + wasm-opt` pipeline | Sep 2025 (rustwasm org sunsetting) | wasm-pack deprecated; manual pipeline gives more control and avoids known regressions |
| `npm create svelte@latest` | `npx sv create` (SvelteKit) or `npm create vite@latest -- --template svelte-ts` (SPA) | Svelte 5 era | Old CLI replaced by `sv` for SvelteKit; Vite template for SPAs without SvelteKit |
| `ScriptProcessorNode` | `AudioWorkletProcessor` | Chrome 64 (2018); now universal | ScriptProcessorNode deprecated; AudioWorklet is the only real-time audio path |
| `postMessage` for per-frame data | `SharedArrayBuffer` + `Atomics` | Requires COOP/COEP (Chrome 92, 2021) | Eliminates per-frame allocation and lock acquisition in the audio hot path |

**Deprecated/outdated:**
- `wasm-pack`: deprecated September 2025 — do not use.
- `ScriptProcessorNode`: deprecated; all browsers support AudioWorklet.
- `npm create svelte@latest`: replaced by `npx sv create` for SvelteKit; use `npm create vite@latest -- --template svelte-ts` for a standalone SPA (no SvelteKit).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `notify` 9.0.0-rc.4 is the latest; `xtask-watch` resolves a compatible version transitively | Standard Stack | xtask-watch may pin to notify 6.x; check `Cargo.lock` after install and do not force notify 9.x |
| A2 | `wasm-opt` is installable via `mise install binaryen` on macOS | Installation block | May need direct binary download from binaryen GitHub releases instead |
| A3 | `public/` static serving in Vite serves `.wasm` files with correct `Content-Type: application/wasm` without vite-plugin-wasm | Architecture | If Content-Type is wrong, `WebAssembly.compile()` will throw a TypeError; verify with DevTools Network tab |
| A4 | Vite 8.0.13 is backward compatible with the Vite 6 `server.headers` API documented in STACK.md | Vite Config | If API changed in Vite 7 or 8, config structure may differ; verify against current Vite docs |

---

## Open Questions

1. **Does `xtask-watch` 0.3.4 watch a specific subdirectory (`rust/src/`)?**
   - What we know: `xtask-watch` wraps `notify` and re-runs a command on changes.
   - What's unclear: Whether it can be scoped to `rust/src/` only (to avoid triggering on changes to `src/` or `public/`).
   - Recommendation: Check `xtask-watch` docs on `Watch::watch_path()` or equivalent. If not configurable, use raw `notify` with a directory filter predicate.

2. **Does `WebAssembly.compile()` on the main thread block the UI thread?**
   - What we know: `WebAssembly.compile()` returns a Promise and is specified as async.
   - What's unclear: Whether the compilation happens off-main-thread in Chrome and Safari (it does in Chrome; Safari behavior may vary for small binaries).
   - Recommendation: Use `WebAssembly.compileStreaming()` where possible for better streaming behavior; accept that a 10–50KB silence-only WASM binary compiles in <5ms regardless.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite dev server, npm | Yes | v26.0.0 | — |
| npm | Package install | Yes | 11.12.1 | — |
| cargo / rustup | WASM build pipeline | Not confirmed in this session | — | Install from rustup.rs |
| wasm-bindgen-cli | D-06 build pipeline | Not confirmed | — | `cargo install wasm-bindgen-cli --version 0.2.120` |
| wasm-opt | D-06 build pipeline | Not confirmed | — | Download from binaryen GitHub releases |
| wasm32-unknown-unknown target | cargo build | Not confirmed | — | `rustup target add wasm32-unknown-unknown` |

**Missing dependencies with no fallback:**
- `cargo` / `rustup` — required for the entire project; must be installed.

**Missing dependencies with fallback:**
- `wasm-opt` — if unavailable, skip the optimization step for Phase 1 development builds (silence-only module is tiny; optimization matters more in Phase 2+).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (Rust) | `cargo test` (native host, no browser) |
| Framework (TS) | Vitest 4.1.6 |
| Framework (Integration) | Manual browser verification (Playwright deferred to Phase 2) |
| Config file | `vite.config.ts` (Vitest inline config, or `vitest.config.ts`) |
| Quick run command | `cargo test -p metronome-engine && npm run test` |
| Full suite command | Same — no E2E in Phase 1 |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLATFORM-04 | `crossOriginIsolated === true` in browser | Manual / browser console | `curl -I http://localhost:5173 \| grep -i cross-origin` (header presence) | Wave 0 |
| PLATFORM-04 | `typeof SharedArrayBuffer !== 'undefined'` | Manual browser console assertion | — | Wave 0 |
| PLATFORM-03 | AudioContext not created before user gesture | Manual: open page, observe no autoplay warning | — | Wave 0 |
| PLATFORM-03 | AudioContext reaches `"running"` state after Play click | Manual / console: `audioCtx.state` | — | Wave 0 |
| AUDIO-03 / AUDIO-04 | WASM loads in AudioWorklet without error | Manual: DevTools console — no ReferenceError, 'ready' message received | — | Wave 0 |
| AUDIO-03 / AUDIO-04 | `process()` runs without GC pressure | Manual: Chrome DevTools Web Audio inspector — render capacity stays low | — | Wave 0 |
| General | WASM exports compile correctly | `cargo test -p metronome-engine` (native) — not a browser test | `cargo test -p metronome-engine` | Wave 0 |
| General | TypeScript types check clean | `npm run typecheck` (`tsc --noEmit`) | `npm run typecheck` | Wave 0 |

### Sampling Rate

- **Per task commit:** `cargo test -p metronome-engine && npm run typecheck`
- **Per wave merge:** Full manual browser verification checklist (below)
- **Phase gate:** All items in manual verification checklist pass before `/gsd:verify-work`

### Manual Verification Checklist (Phase Gate)

These are the acceptance tests for Phase 1 — they cannot be automated without a running browser:

1. `cargo xtask build` completes without errors; `public/wasm/metronome_engine_bg.wasm` exists.
2. `cargo xtask dev` starts; Vite dev server is accessible at `http://localhost:5173`.
3. `curl -I http://localhost:5173` shows `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers.
4. Open `http://localhost:5173` in Chrome; open DevTools Console; verify `crossOriginIsolated === true` (type it in console).
5. Verify `typeof SharedArrayBuffer !== 'undefined'` in console.
6. Open DevTools → Network; verify `GET /wasm/metronome_engine_bg.wasm` returns 200 with `Content-Type: application/wasm`.
7. Verify `GET /worklet/processor.js` returns 200.
8. Click the Play button; verify no `AudioContext was not allowed to start` warning in console.
9. Verify `AudioContext.state === 'running'` after click (log to console from main.ts).
10. Verify `'ready'` message received from worklet (log to console in `workletNode.port.onmessage`).
11. Open Chrome DevTools → More tools → Web Audio; verify render capacity stays near 0% (silence, no processing load).
12. Let run for 30 seconds; verify no errors accumulate in console.

### Wave 0 Gaps

- [ ] `rust/src/lib.rs` — initial silence-only WASM module (no existing file)
- [ ] `public/worklet/processor.js` — AudioWorklet processor skeleton (no existing file)
- [ ] `src/main.ts` — main thread bootstrap (no existing file)
- [ ] `src/App.svelte` — Play button component (no existing file)
- [ ] `vite.config.ts` — Vite config with COOP/COEP (no existing file)
- [ ] `xtask/src/main.rs` — xtask build/dev orchestration (no existing file)
- [ ] `Cargo.toml` (root) — workspace definition (no existing file)
- [ ] `.cargo/config.toml` — xtask alias (no existing file)
- [ ] `tsconfig.json` — TypeScript config (no existing file)
- [ ] `package.json` — npm entry point with dev/build scripts (no existing file)

This is a greenfield project — all files need to be created in Wave 0.

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth in this app |
| V3 Session Management | No | No sessions |
| V4 Access Control | No | Single-user browser app |
| V5 Input Validation | Minimal | BPM input (Phase 3); not applicable Phase 1 |
| V6 Cryptography | No | No cryptographic operations |
| COOP/COEP headers | Yes (security boundary) | Vite `server.headers`; required for SharedArrayBuffer |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SharedArrayBuffer Spectre side-channel | Info disclosure | COOP/COEP headers (the purpose of these headers is to enable the browser's Spectre mitigations) [CITED: web.dev/articles/coop-coep] |
| Malicious WASM binary loaded from wrong path | Tampering | Serve from `public/wasm/` under the same origin; no dynamic URL construction |

---

## Sources

### Primary (HIGH confidence)

- [Chrome Developers: Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern/) — WASM transfer via processorOptions; architecture patterns
- [MDN: AudioWorkletProcessor.process()](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) — return value semantics; `sampleRate` global
- [MDN: Worklet.addModule()](https://developer.mozilla.org/en-US/docs/Web/API/Worklet/addModule) — module loading behavior; strict mode
- [MDN: Using AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet) — full integration guide
- [web.dev: COOP/COEP making cross-origin isolation](https://web.dev/articles/coop-coep) — header configuration
- [wasm-bindgen: AudioWorklet example](https://rustwasm.github.io/docs/wasm-bindgen/examples/wasm-audio-worklet.html) — official WASM + worklet pattern
- [wasm-bindgen crates.io](https://crates.io/crates/wasm-bindgen) — version 0.2.120, MSRV 1.86 for CLI
- [blog.paul.cx: Wait-Free SPSC Ring Buffer](https://blog.paul.cx/post/a-wait-free-spsc-ringbuffer-for-the-web/) — ring buffer pattern
- [matklad/cargo-xtask](https://github.com/matklad/cargo-xtask) — xtask pattern, `env!("CARGO")` convention
- [crates.io/crates/xtask-watch](https://crates.io/crates/xtask-watch) — v0.3.4
- [crates.io/crates/notify](https://crates.io/crates/notify) — v9.0.0-rc.4

### Secondary (MEDIUM confidence)

- [svelte.dev/docs/svelte/getting-started](https://svelte.dev/docs/svelte/getting-started) — `npm create vite@latest -- --template svelte-ts` for SPA
- [vite.dev/guide](https://vite.dev/guide/) — Vite 8 scaffold commands
- [nickb.dev: Life after wasm-pack](https://nickb.dev/blog/life-after-wasm-pack-an-opinionated-deconstruction/) — manual pipeline rationale

### Tertiary (LOW confidence — training knowledge)

- xtask-watch `Watch::watch_path()` API details — not verified against current 0.3.4 docs; check before use

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — versions verified against npm registry and crates.io API in this session
- Architecture: HIGH — patterns from official Chrome developer docs, MDN, and wasm-bindgen guide
- xtask orchestration: MEDIUM — pattern verified; exact xtask-watch 0.3.4 API not verified against current docs
- Pitfalls: HIGH — all critical pitfalls traced to official sources in prior research (PITFALLS.md)
- Validation architecture: HIGH — manual checklist maps directly to phase success criteria

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (30 days — stack is stable; wasm-bindgen minor versions release frequently but patch versions are backward compatible)
