---
status: complete
date: 2026-05-21
---

# Quick Task: AudioContext auto-resume + time signature numerator cap

## What was fixed

**Bug 1 — AudioContext auto-suspend (audio-engine.ts):**
Added a `statechange` listener on AudioContext at creation time. When the browser suspends the context while the engine is in `running` state, the listener calls `ctx.resume()` automatically. This recovers from the ~15-minute dropout observed during Android/desktop testing without requiring the user to press Stop then Play.

**Bug 2 — Time signature numerator capped at 12 (App.svelte):**
Raised the cap from 12 to 32 in both the JS clamp (`Math.min(12, val)` → `Math.min(32, val)`) and the HTML `max` attribute (`max="12"` → `max="32"`). Valid time signatures like 15/16 now work.

## Files changed

- `src/lib/audio-engine.ts` — statechange listener added in start()
- `src/App.svelte` — numerator clamp and max attribute updated to 32

## Verification

- `npx vitest run`: 27/27 pass
