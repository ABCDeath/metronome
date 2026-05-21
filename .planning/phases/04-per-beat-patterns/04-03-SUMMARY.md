---
phase: 04-per-beat-patterns
plan: 03
subsystem: ui
tags: [typescript, vitest, pattern, rebuildBeats, BeatPosition]

# Dependency graph
requires:
  - phase: 03-timing-controls
    provides: BeatPosition type, rebuildBeats() function, pattern.ts utility module
provides:
  - rebuildBeats() with optional existingBeats parameter for merge-preserving step count changes
  - Four Vitest tests covering grow, shrink, same-size, and fresh-init merge semantics
affects: [04-per-beat-patterns/04-04, App.svelte call sites for rebuildBeats]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-branch optional-param pattern: when param undefined → legacy default; when present → merge logic via Array.from index comparison"
    - "Immutable merge: Array.from always produces a fresh array; input existingBeats is never mutated"

key-files:
  created: []
  modified:
    - src/lib/pattern.ts
    - src/lib/pattern.test.ts

key-decisions:
  - "Optional parameter (existingBeats?: BeatPosition[]) chosen over overload — backwards-compatible; all Phase 3 callers passing only stepCount continue to work without change"
  - "Truncation via Array.from length bound — no explicit slice needed; Array.from({ length: stepCount }) naturally stops at stepCount regardless of existingBeats.length"
  - "Voice 0 fill for new positions — consistent with D-07: new positions beyond existingBeats.length default to Normal"

patterns-established:
  - "rebuildBeats(stepCount) — Phase 3 default path: beat 0 = voice 1 (Accent), rest = voice 0 (Normal)"
  - "rebuildBeats(stepCount, existingBeats) — merge path: copies existing voices, fills new slots with 0, truncates right on shrink"

requirements-completed: [PATTERN-01]

# Metrics
duration: 1min
completed: 2026-05-21
---

# Phase 4 Plan 03: rebuildBeats Merge Parameter Summary

**rebuildBeats() extended with optional existingBeats parameter enabling preserve-on-resize semantics: grow fills new slots with voice 0, shrink truncates right, same-size copies all voices, fresh-init retains Phase 3 default**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-05-21T07:02:46Z
- **Completed:** 2026-05-21T07:03:35Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Updated `rebuildBeats()` in `src/lib/pattern.ts` with optional `existingBeats?: BeatPosition[]` parameter
- Two-branch implementation: no existingBeats → Phase 3 default unchanged; with existingBeats → Array.from merge (grow/shrink/same-size all handled)
- Extended `src/lib/pattern.test.ts` with 4 new merge semantics tests inside a nested `describe('with existingBeats', ...)` block
- All 27 tests pass (23 pre-existing + 4 new); `tsc --noEmit` clean

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: rebuildBeats optional existingBeats param + merge tests** - `c2908c1` (feat)

**Plan metadata:** (see final docs commit)

## Files Created/Modified

- `src/lib/pattern.ts` — rebuildBeats() updated with optional existingBeats parameter and two-branch merge logic; JSDoc updated
- `src/lib/pattern.test.ts` — four new Vitest tests appended inside `describe('rebuildBeats', ...)` in a nested `describe('with existingBeats', ...)`

## Decisions Made

- Optional parameter chosen over TypeScript function overloads — simpler, fewer lines, backwards-compatible; existing callers pass only `stepCount` and receive Phase 3 default unchanged
- Array.from implicit truncation used for shrink case — no `existingBeats.slice(0, stepCount)` needed; the length bound on Array.from handles it cleanly
- Nested `describe('with existingBeats', ...)` block for new tests — matches existing file structure; groups merge tests clearly without polluting the top-level describe

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04-04 is now unblocked: the merge-aware `rebuildBeats()` is ready for App.svelte call site updates
- Both call sites in App.svelte (subdivision change handler and time-sig change handler) can now pass their current beats array as `existingBeats` to preserve user assignments across step count changes

---
*Phase: 04-per-beat-patterns*
*Completed: 2026-05-21*
