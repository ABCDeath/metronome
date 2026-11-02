# Metronome

**Live:** https://metronome-baj.pages.dev/

A browser-based metronome with a Rust/WebAssembly audio engine and a Svelte 5 UI. Clicks are synthesized and scheduled directly in an AudioWorklet for sub-10ms timing precision with no drift.

## Features

- **Three click sounds** — Beep, Woodblock, Sticks
- **Per-beat pattern editor** — set each beat to Normal, Accent, Silent, or Ghost
- **Subdivisions** — Quarter, 8th, Triplet, 16th
- **Time signatures** — any numerator 1–32, denominator 2/4/8/16
- **White noise mix** — blend in background noise
- **Training mode** — cycle through Normal, Silent, and Skips bars to practice internal timing
- **Beat indicator** — visual dot row shows the current beat in real time, including during silent training bars
- **Light / Dark / System theme**

## Stack

| Layer | Technology |
|-------|-----------|
| Audio engine | Rust → WebAssembly (C ABI exports, optional `wasm-opt`) |
| Audio thread | Web Audio API `AudioWorkletProcessor` |
| Main → worklet | `SharedArrayBuffer` SPSC ring + `Atomics` |
| UI | Svelte 5 (runes), TypeScript, Vite 8 |
| Hosting | Cloudflare Pages (COOP/COEP headers required for `SharedArrayBuffer`) |

## Development

Requires Node.js/npm and rustup. `rust-toolchain.toml` pins Rust 1.95 and the
`wasm32-unknown-unknown` target. Optional `wasm-opt` (Binaryen) optimizes the
WASM binary when available; the build skips optimization if it is absent.

```bash
npm install
cargo xtask build  # generate the WASM binary before starting Vite
npm run dev        # starts Vite dev server at http://localhost:5173
```

The generated binary `public/wasm/metronome_engine_bg.wasm` is ignored by Git;
only the directory placeholder is committed. Run `cargo xtask build` again after
changing the Rust source. The AudioWorklet loads the raw WASM and calls its
C ABI exports directly; no `wasm-bindgen` or generated JavaScript glue is used.

## Testing

```bash
cargo test         # Rust DSP tests
npx vitest run     # JS/TypeScript tests
```
