# Phase 1: Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 1-Infrastructure
**Areas discussed:** UI Framework, Project Structure, Dev Workflow

---

## UI Framework

| Option | Description | Selected |
|--------|-------------|----------|
| Svelte 5 | Zero runtime, compiler-based reactivity, simpler learning curve | ✓ |
| React | Largest ecosystem, most transferable skill, medium learning curve | |
| Vue 3 | Beginner-friendly, good docs, ~34KB runtime | |
| Vanilla TypeScript | No framework, maximum control, more boilerplate | |

**User's choice:** Svelte 5
**Notes:** User is an experienced backend developer with limited frontend experience. Asked for explanation of all options including Vue (not initially presented). After full comparison, chose Svelte for simplicity and fit for this focused app. Explicitly not choosing React for this project (would choose React if career/marketability was the goal).

---

## Project Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Separate dirs, single repo | rust/ + src/ + xtask/ in one repo | ✓ |
| Flat structure | Rust and TS mixed at root | |

**User's choice:** Separate dirs (`rust/`, `src/`, root `package.json`)

**WASM output location sub-decision:**

| Option | Description | Selected |
|--------|-------------|----------|
| rust/pkg/ → copied to public/ | Explicit copy step, static asset serving | ✓ |
| vite-plugin-wasm import | Plugin handles import, less manual work | |

**Notes:** User preferred the explicit copy approach — keeps the AudioWorklet WASM loading pattern simple and debuggable.

---

## Dev Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Makefile | Simple, no extra deps, familiar from backend | |
| npm scripts only | All in package.json | |
| cargo-xtask | Rust-native build system, workspace member crate | ✓ |

**User's choice:** cargo-xtask
**Notes:** Makes sense for a Rust-experienced backend developer — keeps build logic in Rust rather than shell scripts or npm.

**xtask integration sub-decision:**

| Option | Description | Selected |
|--------|-------------|----------|
| xtask dev spawns both | Single command starts WASM watch + Vite dev server | ✓ |
| xtask build only, Vite separate | Two terminals, explicit separation | |

---

## Claude's Discretion

- Vite config structure (plugins, aliases)
- xtask internals (notify crate for fs watching, std::process::Command for Vite)
- Ring buffer size (256–512 entries)
- WASM memory page count

## Deferred Ideas

- Production deployment target / COOP/COEP header hosting setup — Phase 5
- Hot module replacement for Rust — out of scope for Phase 1; xtask watch + browser refresh is sufficient
