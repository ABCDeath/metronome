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
| Audio engine | Rust → WebAssembly (`wasm-bindgen`, `wasm-opt`) |
| Audio thread | Web Audio API `AudioWorkletProcessor` |
| Main → worklet | `SharedArrayBuffer` SPSC ring + `Atomics` |
| UI | Svelte 5 (runes), TypeScript, Vite 6 |
| Hosting | Cloudflare Pages (COOP/COEP headers required for `SharedArrayBuffer`) |

## Development

```bash
npm install
npm run dev        # starts Vite dev server at http://localhost:5173
```

The WASM binary is pre-built and committed under `public/wasm/`. To rebuild it from Rust source:

```bash
cargo xtask build
```

Requires Rust stable + `wasm32-unknown-unknown` target + `wasm-opt` (via `mise install binaryen`).

## Testing

```bash
cargo test         # 20 Rust unit tests (DSP logic)
npx vitest run     # 45 JS tests (pattern logic, computeBarType)
```
