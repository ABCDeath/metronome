---
phase: 02-first-click
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - rust/src/lib.rs
  - public/worklet/processor.js
  - src/lib/audio-engine.ts
findings:
  critical: 2
  warning: 2
  info: 2
  total: 6
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-19
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Three files were reviewed: the Rust DSP engine (`rust/src/lib.rs`), the AudioWorklet processor
(`public/worklet/processor.js`), and the main-thread scheduler (`src/lib/audio-engine.ts`).

The Rust DSP layer is well-structured. The triangle wave formula, exponential decay coefficient,
sentinel guard, and cross-quantum envelope persistence are all correctly implemented and covered
by tests.

Two critical defects were found in the JavaScript layer:

1. A null-dereference in `process()` that can silently kill the AudioWorklet processor during
   normal startup when the WASM initialization races the "init-buffers" message.
2. A signed 32-bit integer overflow in the quantum index encoding that causes beat scheduling
   to break after approximately 25 minutes of continuous playback.

Two warnings cover a missing HTTP response check on WASM fetch and an unguarded async `start()`
that can spawn duplicate infrastructure on concurrent invocation.

## Critical Issues

### CR-01: Null dereference in `process()` when `_ready` races `_ringIndices`

**File:** `public/worklet/processor.js:66`

**Issue:** The `_ready` flag is set to `true` at the end of the WASM `.then()` callback (line 39),
but `_ringIndices` is set only when the main thread sends the `"init-buffers"` message (line 49).
These are two independent async paths. If the browser delivers the `process()` callbacks before
the "init-buffers" message is processed by the worklet's message handler, `process()` passes
`!this._ready` (false) and proceeds to `Atomics.load(this._ringIndices, 0)` at line 66 where
`_ringIndices` is still `null`. `Atomics.load(null, 0)` throws a `TypeError`, which is an
uncaught exception inside the AudioWorklet rendering thread. The browser silently kills the
processor; the node appears connected but produces no output and emits no error to the main
thread.

In practice the race is narrow — the main thread sends "init-buffers" before `setInterval`
fires its first tick — but `process()` runs at 44100/128 ≈ 344 Hz, so the first ~8 callbacks
fire in the same ~23 ms window during which "init-buffers" is still in the message queue.
Under load (slow main thread, slow init) or on Android devices (higher worklet startup latency,
noted in CLAUDE.md) this is reproducible.

**Fix:** Add a combined guard that checks `_ringIndices` (and `_ringData`) in addition to
`_ready`, or set `_ready = true` only after both conditions hold. The simplest safe approach
is to fold the ring-buffer readiness into the `_ready` flag:

```js
// In the 'init-buffers' handler, after setting _ringIndices/_ringData:
if (this._exports !== null) {
  this._ready = true;
  this.port.postMessage({ type: 'ready' });
}

// In the WASM .then() callback, after setting this._outputView:
if (this._ringIndices !== null) {
  this._ready = true;
  this.port.postMessage({ type: 'ready' });
}
// (remove the unconditional _ready = true / postMessage from both places)
```

Alternatively, keep `_ready` as-is and add a null guard at the top of `process()`:

```js
if (!this._ready || !this._ringIndices || !this._ringData) {
  return true;
}
```

---

### CR-02: Signed 32-bit integer overflow in `quantumIndex << 12` breaks beat scheduling after ~25 minutes

**File:** `src/lib/audio-engine.ts:151` (write) and `public/worklet/processor.js:76` (read)

**Issue:** JavaScript bitwise operators (`<<`, `>>`) operate on signed 32-bit integers (ToInt32).
The event encoding packs `quantumIndex` into bits 12–31 of a u32:

```ts
const event = (sampleOffset & 0x7F) | (quantumIndex << 12);
```

`quantumIndex` is `Math.floor(beatSampleAbs / 128)`. At 44100 Hz, after ~25 minutes
(`quantumIndex >= 2^19 = 524,288`), the expression `quantumIndex << 12` exceeds 2^31 − 1,
wrapping to a negative signed 32-bit value. The Uint32Array write coerces via `ToUint32`, so
the stored bits are technically preserved, but the issue is symmetric on the consumer side:

```js
const evQuantum = (event >> 12) | 0;   // processor.js:76
```

`event` is read from a `Uint32Array` (unsigned, 0–4294967295). When bit 31 of `event` is set
(i.e., `quantumIndex >= 2^19`), `event >> 12` applies a signed arithmetic right shift (ToInt32
first, then `>>`), sign-extending bit 31. The result is a large negative number. Meanwhile
`myQuantum = (currentFrame / 128) | 0` remains positive. The comparison
`evQuantum === myQuantum` never matches; the stale-drain `evQuantum < myQuantum` fires
immediately, consuming every future event as stale. Beats stop firing.

The event bit field has 20 bits available (bits 12–31), giving a maximum representable
`quantumIndex` of `2^20 − 1 = 1,048,575`, corresponding to ~38 minutes at 44100 Hz / 128
frames — but the signed overflow in JS arithmetic halves this to ~19 minutes before the
encoding silently corrupts.

**Fix:** Use unsigned right shift (`>>>`) on the consumer side to prevent sign extension:

```js
// processor.js line 76 — was: (event >> 12) | 0
const evQuantum = (event >>> 12);   // unsigned: always 0–1048575
```

On the producer side, guard against the quantumIndex exceeding the 20-bit field:

```ts
// audio-engine.ts line 151
const quantumIndex  = Math.floor(beatSampleAbs / 128);
const quantumClamped = quantumIndex & 0xFFFFF;   // keep bits 12–31 only (20 bits)
const event = (sampleOffset & 0x7F) | (quantumClamped << 12);
```

Note: the masking on the producer side must be applied consistently with the same masking on
`myQuantum` in the worklet, or the quantum-match comparison will still fail when the counter
wraps. A clean alternative is to apply the same 20-bit mask in both places:

```js
// processor.js line 77
const myQuantum = ((currentFrame / 128) | 0) & 0xFFFFF;
```

## Warnings

### WR-01: WASM fetch response not checked for HTTP errors

**File:** `src/lib/audio-engine.ts:48-50`

**Issue:** The response from `fetch('/wasm/metronome_engine_bg.wasm')` is passed directly to
`response.arrayBuffer()` without checking `response.ok`. A 404 or 500 response will still
resolve the `fetch()` promise; `arrayBuffer()` will return the (HTML error-page) bytes; and
`WebAssembly.compile()` will throw a `CompileError` with an unhelpful message like
"unexpected end of data" or "magic number mismatch". The root cause (missing WASM file, bad
build output, misconfigured static asset path) is invisible to the developer and to any error
telemetry.

```ts
// current (line 48-50)
const response = await fetch('/wasm/metronome_engine_bg.wasm');
const buffer = await response.arrayBuffer();
const wasmModule = await WebAssembly.compile(buffer);
```

**Fix:** Check `response.ok` and throw an actionable error before attempting to interpret the
body as a WASM module:

```ts
const response = await fetch('/wasm/metronome_engine_bg.wasm');
if (!response.ok) {
  throw new Error(
    `Failed to fetch WASM module: ${response.status} ${response.statusText}`
  );
}
const buffer = await response.arrayBuffer();
const wasmModule = await WebAssembly.compile(buffer);
```

---

### WR-02: `start()` has no concurrency guard — concurrent calls spawn duplicate infrastructure

**File:** `src/lib/audio-engine.ts:29-109`

**Issue:** `start()` is `async`. The guard at line 31 (`if (this._state === 'running') return`)
is checked synchronously before the first `await`, but a second call to `start()` that arrives
while the first is suspended at any of the four `await` points (line 41 `resume()`, line 49
`fetch`, line 50 `arrayBuffer()`, line 53 `addModule`) will also pass the guard (state is still
`'stopped'`). Both calls then enter the `if (!this._workletNode)` branch, allocate a second set
of `SharedArrayBuffer`s, create a second `AudioWorkletNode`, and start a second scheduler
interval. The second `setInterval` handle overwrites `_schedulerIntervalId`, so the first
scheduler becomes a zombie — it runs forever and can never be cleared.

In Phase 2 this requires an aggressive double-tap on the Play button during the async startup,
which is unlikely but not impossible on a slow connection (WASM fetch latency). In Phase 3,
when the UI may debounce less aggressively, this becomes more likely.

**Fix:** Use an in-progress flag or a pending promise to make `start()` safe for concurrent
calls:

```ts
private _startPromise: Promise<void> | null = null;

async start(): Promise<void> {
  if (this._state === 'running') return;
  if (this._startPromise) return this._startPromise;   // already starting — wait or ignore
  this._startPromise = this._doStart();
  try {
    await this._startPromise;
  } finally {
    this._startPromise = null;
  }
}

private async _doStart(): Promise<void> {
  // ... existing start() body
}
```

## Info

### IN-01: `console.log` left in production `start()` path

**File:** `src/lib/audio-engine.ts:93-96`

**Issue:** A `console.log` call logging `crossOriginIsolated` status is present inside the
production message handler for the "ready" event from the AudioWorklet. This was appropriate
for development verification but adds noise to production console output.

**Fix:** Remove or guard behind a debug flag:

```ts
if (import.meta.env.DEV) {
  console.log('[AudioEngine] AudioWorklet ready — crossOriginIsolated:', ...);
}
```

---

### IN-02: `_nextBeatTime` field initialized to `0` but semantically invalid until `start()`

**File:** `src/lib/audio-engine.ts:16`

**Issue:** `private _nextBeatTime: number = 0` initializes to `0`, which is a valid IEEE 754
double but semantically means "epoch" (AudioContext time 0). If `_schedulerTick()` were somehow
called before `start()` correctly seeds the value (line 106), the scheduler would compute a
`beatSampleAbs` near zero and flood the ring with events for quantum 0, all of which the
worklet would immediately drain as stale. The current code is safe because `_schedulerIntervalId`
is only set inside `start()`, but the field declaration misleads readers into thinking 0 is a
safe initial value.

**Fix:** Initialize to `NaN` or use `undefined` with a union type to make the "not yet seeded"
state explicit and detectable:

```ts
private _nextBeatTime: number = NaN;  // sentinel: seeded in start()
```

And add a guard in `_schedulerTick()`:

```ts
if (Number.isNaN(this._nextBeatTime)) return;
```

---

_Reviewed: 2026-05-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
