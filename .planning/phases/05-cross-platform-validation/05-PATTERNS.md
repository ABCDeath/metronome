# Phase 5: Cross-Platform Validation - Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 4 (3 shipped files + 1 planning artifact)
**Analogs found:** 3 / 4 (planning artifact has no codebase analog by definition)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `build.sh` | config / build pipeline | batch (sequential shell commands) | `xtask/src/main.rs` `build_wasm()` | role-match — same build steps, different language |
| `public/_headers` | config / CDN headers | request-response (static header injection) | `vite.config.ts` `COOP_COEP_HEADERS` | exact — identical header names and values |
| `rust-toolchain.toml` | config / toolchain pin | N/A (declarative, no data flow) | `Cargo.toml` `[profile.release]` + `.cargo/config.toml` | role-match — same TOML-in-repo-root config idiom |
| `.planning/phases/05-cross-platform-validation/05-CHECKLIST.md` | planning artifact | N/A | — | no analog (planning doc, not shipped code) |

---

## Pattern Assignments

### `build.sh` (config, batch)

**Analog:** `xtask/src/main.rs` — `build_wasm()` function (lines 33–103)

**What `build_wasm()` does (the authoritative step order to replicate):**

Step 1 — cargo build (lines 35–49):
```rust
Command::new(env!("CARGO"))
    .args([
        "build",
        "--release",
        "--target",
        "wasm32-unknown-unknown",
        "--manifest-path",
        "rust/Cargo.toml",
    ])
```

Step 2 — copy WASM output (lines 58–63):
```rust
std::fs::copy(
    "target/wasm32-unknown-unknown/release/metronome_engine.wasm",
    "rust/pkg/metronome_engine_bg.wasm",
)
```

Step 3 — wasm-opt with graceful fallback (lines 66–92):
```rust
let opt_result = Command::new("wasm-opt")
    .args(["-O3", "rust/pkg/metronome_engine_bg.wasm",
           "-o", "rust/pkg/metronome_engine_bg.wasm"])
    .status();
// On Err(NotFound) -> eprintln! WARNING and continue (do NOT exit 1)
```

Step 4 — copy to public/wasm/ (lines 94–100):
```rust
std::fs::copy(
    "rust/pkg/metronome_engine_bg.wasm",
    "public/wasm/metronome_engine_bg.wasm",
)
```

**Shell translation of the xtask pipeline** — the `build.sh` MUST replicate these four steps in the same order. The Rust install bootstrapping wraps the whole sequence because `cargo` must be in PATH before step 1:

```sh
#!/bin/sh
set -e

# Bootstrap Rust on Cloudflare Pages CI (not pre-installed on v3 build image).
# Guard with CF_PAGES=1 so local runs skip the curl step.
# CRITICAL: Use `. "$HOME/.cargo/env"` not `source` — CF Pages runs /bin/sh not bash.
if [ "${CF_PAGES:-0}" = "1" ] && ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  . "$HOME/.cargo/env"
fi

# Mirrors xtask build_wasm() steps 1-4.
cargo xtask build

# Install JS deps and produce dist/.
npm ci
npm run build
```

**Key constraints from xtask (carry into build.sh):**
- `cargo xtask build` is the single command that orchestrates all four WASM steps. Do not inline individual cargo/wasm-opt commands into build.sh — xtask is the source of truth.
- wasm-opt absence is non-fatal: xtask already handles `NotFound` with a warning and continues. build.sh inherits this behavior by delegating to xtask.
- `cargo xtask build` must run BEFORE `npm run build`. The WASM binary must exist in `public/wasm/` before Vite copies `public/` to `dist/`.

**Cloudflare Pages dashboard settings (not in code):**
- Build command: `sh build.sh`
- Output directory: `dist`

---

### `public/_headers` (config, static header injection)

**Analog:** `vite.config.ts` lines 4–7 and 16–20

**Exact header values from vite.config.ts** (lines 4–7):
```typescript
const COOP_COEP_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}
```

These values (lines 16–20) are applied in dev via:
```typescript
server: {
  headers: COOP_COEP_HEADERS,
},
preview: {
  headers: COOP_COEP_HEADERS,
},
```

**The `_headers` file replicates these exact values for production.** Cloudflare Pages reads `public/_headers` and copies it to `dist/_headers` during vite build (Vite copies everything in `public/` verbatim). The format is:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

**Critical format rules (from RESEARCH.md Pattern 2):**
- File name: `_headers` with no extension, placed at `public/_headers`
- Header lines MUST be indented (at least one leading space). Unindented lines are silently ignored.
- No trailing spaces after `same-origin` or `require-corp` — trailing whitespace causes COOP/COEP validation to fail in browsers.
- `/*` is a greedy wildcard matching all paths.

**Verification:** After deploy, run in browser DevTools console:
```js
console.log('crossOriginIsolated:', crossOriginIsolated);
// Expected: true
```

---

### `rust-toolchain.toml` (config, toolchain pin)

**Analog:** `Cargo.toml` (repo root, lines 1–8) — same pattern of a root-level TOML file that controls Rust toolchain behavior for the entire workspace.

**Cargo.toml pattern** (lines 1–8):
```toml
[workspace]
members = ["rust", "xtask"]
resolver = "2"

[profile.release]
opt-level = 3
lto = true
```

Note: `lto = true` (full LTO) is set in the workspace release profile. This is slower to compile. On Cloudflare Pages CI, if the 20-minute build timeout is hit, this is the first setting to relax (to `lto = "thin"` or `lto = false`), conditional on `CF_PAGES` env var if needed.

**`rust-toolchain.toml` format** (rustup declarative override):
```toml
[toolchain]
channel = "1.95"
targets = ["wasm32-unknown-unknown"]
profile = "minimal"
```

**Why this matches the repo pattern:**
- `.cargo/config.toml` (line 2) shows the project already uses repo-root TOML to configure Cargo behavior: `xtask = "run --package xtask --"`. `rust-toolchain.toml` follows the same idiom.
- `profile = "minimal"` avoids downloading HTML docs (~600 MB) on CI.
- `targets = ["wasm32-unknown-unknown"]` means `rustup` auto-installs the WASM target on a fresh CI environment without an explicit `rustup target add` step in `build.sh`.
- `channel = "1.95"` matches the local development toolchain (confirmed in RESEARCH.md environment table: "Local: 1.95.0").

**Rustup reads this file automatically** when any `cargo` command is invoked from within the repo directory. No changes to `build.sh` are needed to activate it — the `curl | sh` rustup install in `build.sh` will respect the file on first `cargo xtask build` invocation.

---

### `.planning/phases/05-cross-platform-validation/05-CHECKLIST.md` (planning artifact)

**Analog:** None in codebase — this is a planning/ops document, not shipped code.

**Structure to use:** Mirror the CONTEXT.md decisions table structure. The checklist maps directly to D-01 through D-10:

Sections:
1. Pre-test setup (USB debug, Chrome versions, device charge)
2. Production deploy verification (`crossOriginIsolated === true`, WASM 200 OK in Network tab, no 404 on `*.wasm`)
3. Android test matrix (20 / 120 / 300 BPM, 60 seconds each, per D-03)
4. Timing/GC audit (Performance panel, AudioWorklet thread lane, zero GC blocks, process() < 2.9ms per D-04)
5. AudioContext gesture gate test (load page, wait 5s without clicking, then press Play)
6. sampleRate verification (confirm 44100 or 48000 Hz is handled; no audio distortion)
7. Sign-off (date, device model, Chrome version, result: pass / fail)

---

## Shared Patterns

### COOP/COEP Header Values
**Source:** `vite.config.ts` lines 4–7
**Apply to:** `public/_headers` (production) — must be character-for-character identical to the dev values
```typescript
'Cross-Origin-Opener-Policy': 'same-origin',
'Cross-Origin-Embedder-Policy': 'require-corp',
```

### wasm-opt Graceful Fallback
**Source:** `xtask/src/main.rs` lines 74–92
**Apply to:** `build.sh` — inherited automatically by delegating to `cargo xtask build`. Do not re-implement the fallback logic in shell.
```rust
Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
    eprintln!("[xtask] WARNING: wasm-opt not found — skipping optimization");
}
```

### POSIX sh Compatibility
**Source:** No existing analog (new constraint for CI)
**Apply to:** `build.sh` exclusively
- Shebang: `#!/bin/sh` (not `#!/bin/bash`)
- Env sourcing: `. "$HOME/.cargo/env"` (not `source`)
- Test locally with `sh build.sh`, not `bash build.sh`

### Release Profile (LTO)
**Source:** `Cargo.toml` lines 5–7
**Apply to:** `build.sh` (awareness only — `cargo xtask build` inherits `[profile.release]` from workspace `Cargo.toml`)
```toml
[profile.release]
opt-level = 3
lto = true
```
If CI hits the 20-minute Cloudflare Pages timeout, the mitigation is to change `lto = true` to `lto = "thin"` in `Cargo.toml` — not to add flags to `build.sh`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `build.sh` (Rust bootstrapping portion) | config | batch | No existing shell scripts in repo; the `if CF_PAGES && ! command -v cargo` pattern is new. The xtask four-step order is the analog for the build sequence but the CI bootstrap wrapper has no precedent. |
| `.planning/phases/05-cross-platform-validation/05-CHECKLIST.md` | planning artifact | N/A | Not a code file; no codebase analog. Structure derived from CONTEXT.md decision list (D-01 through D-10). |

---

## Metadata

**Analog search scope:** Repo root, `xtask/src/`, `public/`, `.cargo/`, `rust/` (all TOML and config files)
**Files scanned:** `xtask/src/main.rs`, `vite.config.ts`, `Cargo.toml`, `rust/Cargo.toml`, `.cargo/config.toml`, `public/worklet/processor.js` (public dir listing)
**No existing shell scripts found** (`*.sh` glob returned empty)
**No existing `rust-toolchain.toml` found** (glob returned empty)
**No existing `public/_headers` found** (public dir listing confirms)
**Pattern extraction date:** 2026-05-21
