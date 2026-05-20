---
phase: 03-timing-controls
plan: 01
subsystem: testing
tags: [vitest, typescript, rust, pattern-state, test-scaffold]

# Dependency graph
requires:
  - phase: 02-first-click
    provides: rust/src/lib.rs with existing cargo test infrastructure
provides:
  - vitest installed and configured (vitest.config.ts)
  - PatternState type contracts (src/lib/pattern.ts)
  - Vitest unit tests for pattern utilities (src/lib/pattern.test.ts)
  - Rust placeholder stubs for Phase 3 accent DSP tests (rust/src/lib.rs)
affects:
  - 03-02-PLAN.md (consumes PatternState types and SUBDIV_MULT)
  - 03-03-PLAN.md (consumes pattern.ts, extends Rust stubs to real assertions)
  - 03-04-PLAN.md (consumes pattern.ts for UI binding)

# Tech tracking
tech-stack:
  added: [vitest 4.x]
  patterns:
    - "Test files imported via ./pattern.js (ESM .js extension, not .ts)"
    - "vitest.config.ts mirrors vite.config.ts plugin setup (svelte() plugin included)"
    - "Pure utility functions live in src/lib/pattern.ts — no DOM/Web Audio imports"
    - "Rust placeholder stubs use assert!(true) with Wave N comment indicating when they become real"

key-files:
  created:
    - vitest.config.ts
    - src/lib/pattern.ts
    - src/lib/pattern.test.ts
  modified:
    - rust/src/lib.rs (5 new test stubs added)
    - package.json (vitest devDependency added)

key-decisions:
  - "vitest.config.ts uses environment: node — no jsdom needed for pure math functions"
  - "accentAmpMillis stored as integer ×1000 (1300 = 1.3×) for Atomics.store compatibility"
  - "PatternState has accentFreqHz and accentAmpMillis at top level (global accent, not per-track)"

patterns-established:
  - "Pattern 1: Test imports use .js extension — required for ESM resolution in Vitest/Node"
  - "Pattern 2: Rust test stubs use assert!(true) placeholder with Wave N comment — real assertions added in the wave that implements the feature"
  - "Pattern 3: computeStepInterval(bpm, denominator, subdivMult) = (60/bpm)*(4/denominator)/subdivMult"

requirements-completed: [TIMING-01, TIMING-02, TIMING-03, PATTERN-02]

# Metrics
duration: 7min
completed: 2026-05-20
---

# Phase 3 Plan 01: Timing Controls Test Scaffold Summary

**Vitest 4.x installed with 23 passing pattern tests; PatternState type contracts and pure utilities established in TypeScript; 5 Rust placeholder stubs bring cargo test count to 16 passing — Wave 0 gate satisfied.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-20T05:21:21Z
- **Completed:** 2026-05-20T05:28:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Vitest 4.x installed; vitest.config.ts configured with svelte plugin, node environment, `src/**/*.test.ts` include pattern
- `src/lib/pattern.ts` exports 4 types (Subdivision, BeatPosition, Track, PatternState) and 3 pure functions (computeStepInterval, rebuildBeats, defaultPatternState) plus SUBDIV_MULT constant
- 23 Vitest tests across 3 describe blocks covering all formula edge cases, BPM extremes, and time signature variants
- 5 Rust test stubs added to `rust/src/lib.rs` — 4 placeholder (Wave 1 will replace) + 1 real modulo assertion; all 16 cargo tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Vitest, create vitest.config.ts and pattern.ts type module** - `58eed29` (chore)
2. **Task 2: Write Vitest tests for pattern.ts and Rust test stubs for accent DSP** - `8262013` (test)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `vitest.config.ts` - Vitest config with svelte plugin, node environment, test include pattern
- `src/lib/pattern.ts` - PatternState types and pure utility functions (computeStepInterval, rebuildBeats, defaultPatternState, SUBDIV_MULT)
- `src/lib/pattern.test.ts` - 23 Vitest unit tests for all exported functions
- `rust/src/lib.rs` - 5 new test stubs after existing envelope_crosses_quantum test
- `package.json` / `package-lock.json` - vitest added to devDependencies

## Decisions Made
- Used `environment: 'node'` in vitest.config.ts — pure math functions need no DOM; avoids jsdom overhead
- `accentAmpMillis` stored as integer × 1000 (1300 = amplitude multiplier 1.3) for direct `Atomics.store` compatibility — avoids float-to-int conversions in the audio hot path
- `accentFreqHz` and `accentAmpMillis` are top-level `PatternState` fields (not per-track) because accent is a global setting shared across all tracks

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `cargo` not on the default `PATH` in the Bash shell; required `source $HOME/.cargo/env` before running `cargo test`. This is a shell environment issue, not a code issue. All tests passed once PATH was corrected.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 0 gate fully satisfied: `npx vitest run` exits 0 (23 passing), `cargo test` exits 0 (16 passing)
- Plan 03-02 can import PatternState, Track, BeatPosition, Subdivision, SUBDIV_MULT, computeStepInterval, rebuildBeats, defaultPatternState directly from `src/lib/pattern.ts`
- Rust stubs (test_accent_amplitude_differs, test_accent_pitch_differs, test_phase_inc_reset_on_normal, test_set_accent_params_roundtrip) will be replaced by Plan 03-03 when set_accent_params and accent statics are implemented

---
*Phase: 03-timing-controls*
*Completed: 2026-05-20*
