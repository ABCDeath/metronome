# Domain Pitfalls: Browser Metronome with Rust WASM + AudioWorklet

**Domain:** Browser audio — real-time metronome, AudioWorklet + Rust WASM synthesis
**Researched:** 2026-05-18
**Confidence:** HIGH (all findings verified against official docs, Chromium bug tracker, and primary engineering sources)

---

## Critical Pitfalls

Mistakes that cause complete failures, rewrites, or permanent timing breakage.

---

### Pitfall 1: AudioContext Created Before User Gesture

**What goes wrong:** An `AudioContext` created on page load starts in `"suspended"` state on all
major browsers. Calling `resume()` outside a user-gesture handler fails silently or throws.
The metronome appears to start (state machine updates) but produces no audio.

**Why it happens:** All browsers implement autoplay policy. Chrome suspends any
`AudioContext` not created inside a direct user-input handler. iOS Safari is strictest —
it never auto-resumes; the context must be created or explicitly `resume()`d inside the
click/tap handler. Additionally, iOS Safari produces no audio at all if the device's hardware
ringer switch is in silent mode (this affects Web Audio, not `<audio>` elements).

**Consequences:**
- Silent playback on first load; no error thrown
- Confuses state — the app "thinks" it's playing
- Fails 100% of the time on iOS Safari until fixed

**Prevention:**
- Create `AudioContext` inside the play button's click handler, or call `ctx.resume()` there
- Gate all AudioWorklet initialization on the context reaching `"running"` state
- Show a visible "Tap to Start" affordance; never attempt audio before the first gesture
- Check `audioCtx.state` before starting the scheduler; log a warning if still `"suspended"`
- For the iOS silent mode case: document it as a known platform limitation; nothing can be done
  programmatically

**Warning signs:**
- `AudioContext` state is `"suspended"` after calling play
- Browser console: "The AudioContext was not allowed to start"
- Audio works in development (developer's browser has high Media Engagement Index) but fails
  for fresh users

**Phase:** Foundation / Phase 1 (audio engine setup). Must be solved before any other audio
work proceeds.

---

### Pitfall 2: SharedArrayBuffer Blocked by Missing COOP/COEP Headers

**What goes wrong:** `SharedArrayBuffer` is `undefined` at runtime. WASM threads fail to
initialize. The Rust WASM module either crashes on startup or falls back to single-threaded
mode silently. Lock-free ring buffer communication between the main thread and
AudioWorkletProcessor is broken entirely.

**Why it happens:** Since Chrome 92 (2021), `SharedArrayBuffer` requires cross-origin
isolation. The page must be served with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these headers, `SharedArrayBuffer` is `undefined` regardless of browser version.
Safari 15.2+ enforces the same gate.

**Consequences:**
- WASM threading and Atomics unavailable
- All cross-thread communication must fall back to `postMessage`, which adds per-message
  allocation and latency incompatible with the real-time audio path
- GitHub Pages does not support custom response headers; static CDN hosts (Netlify free tier,
  Vercel default) require explicit configuration

**Prevention:**
- Set COOP/COEP on every response from the development server from day one
  (Vite: `server.headers`, webpack-dev-server: `headers` option)
- Add COOP/COEP to the production deployment config before any integration testing
- Test `typeof SharedArrayBuffer !== 'undefined'` at startup and throw a clear error if missing
- For GitHub Pages: use a `coi-serviceworker` shim only as a last resort; it has edge cases
  with service worker update cycles and will not work after the page sets its own SW
- Audit every third-party resource loaded on the page: with `COEP: require-corp`, all
  cross-origin resources must opt in via `Cross-Origin-Resource-Policy` headers or the load
  is blocked

**Warning signs:**
- `typeof SharedArrayBuffer === 'undefined'` in console
- WASM module panics or fails to instantiate at `wasm_bindgen` init
- Chromium DevTools Network panel shows resources blocked with COEP errors

**Phase:** Foundation / Phase 1. Must be confirmed in the local dev server before WASM
integration begins.

---

### Pitfall 3: WASM Loading Inside AudioWorkletGlobalScope

**What goes wrong:** The WASM module cannot be loaded inside the AudioWorklet processor
script. Any attempt to call `fetch()`, `importScripts()`, or dynamic `import()` from inside
`AudioWorkletGlobalScope` throws or is silently ignored — these APIs are not available in
that scope.

**Why it happens:** `AudioWorkletGlobalScope` is a restricted execution context by spec
design. `fetch` was explicitly excluded (see [Web Audio API issue
#1439](https://github.com/WebAudio/web-audio-api/issues/1439)). The `wasm-pack` `web` and
`no-modules` targets also fail to instantiate inside the worklet because the generated JS
glue calls `TextEncoder`/`TextDecoder`, which are also absent from `AudioWorkletGlobalScope`.

**Consequences:**
- WASM module never loads; `process()` has no Rust code to call
- Cryptic runtime errors that look like network failures or undefined symbols
- `wasm-pack`'s generated output cannot be used as-is inside the worklet

**Prevention:**
- Use the "main thread fetch + postMessage transfer" pattern:
  1. Main thread: `const mod = await WebAssembly.compileStreaming(fetch('engine.wasm'))`
  2. Transfer the compiled `WebAssembly.Module` (not instance) via `node.port.postMessage`
  3. AudioWorklet `onmessage` handler: instantiate the module into the worklet's own instance
- Do not use `wasm-pack`'s generated JS glue inside the worklet; write a thin manual wrapper
  that calls exported Rust functions directly via `WebAssembly.Instance.exports`
- For the nightly Rust + atomics path (required for WASM threads): compile with
  `-C target-feature=+atomics,+bulk-memory,+mutable-globals` and `build-std`; this requires
  a nightly toolchain — pin the toolchain version in `rust-toolchain.toml`

**Warning signs:**
- `ReferenceError: fetch is not defined` inside worklet processor
- `TextEncoder is not defined` during worklet initialization
- WASM module instantiation promise never resolves after `addModule()`

**Phase:** Audio engine integration / Phase 2. The WASM loading architecture must be
established before any DSP logic is wired in.

---

### Pitfall 4: Memory Allocation in the Audio Callback Hot Path

**What goes wrong:** Any allocation (new `Float32Array`, object construction, string
concatenation, logging) inside `process()` triggers the JavaScript GC. GC pauses are
unbounded and run on the same thread as the audio callback. The result is dropped audio
frames — audible clicks, pops, and silence gaps — that are intermittent and hard to reproduce
in DevTools.

**Why it happens:** The `process()` method is called every 128 samples (roughly every 2.7ms
at 48kHz, 2.9ms at 44.1kHz). Any pause longer than the render budget causes a buffer
underrun. JS GC is stop-the-world for that thread. Rust WASM code is GC-free, but the
boundary between Rust and JS (the `process()` method itself) is JavaScript — any allocation
there undermines the benefit.

**Consequences:**
- Intermittent glitches under load or after extended sessions when GC pressure builds
- Much worse on Android (slower devices, more GC frequency)
- Impossible to reliably reproduce in development with fast hardware

**Prevention:**
- Pre-allocate all buffers before the AudioWorklet is started; reuse them every callback
- The `process()` method body must contain zero `new`, zero object literals `{}`, zero array
  literals `[]`, zero string operations
- Pass a pre-allocated `SharedArrayBuffer` view into the WASM heap for audio data — do not
  clone or copy buffers in the hot path
- Use a ring buffer (circular FIFO backed by `SharedArrayBuffer`) for all main-thread to
  worklet communication; never use `postMessage` for per-frame data
- Defer all diagnostics, logging, and metrics to `postMessage` sent out of `process()` at
  a throttled rate (e.g., every 100 callbacks), never inside the tight loop
- Replace modulo arithmetic with branch-based fast paths or bitmask operations when the
  divisor is a power of two — modulo performs a hidden integer division that is measurably
  slow at audio callback frequency

**Warning signs:**
- Chrome `about://tracing` shows GC events coinciding with audio render deadlines
- Chrome Web Audio DevTools shows render capacity spikes above 80%
- Glitches that appear after several minutes of playback but not at startup

**Phase:** Audio engine / Phase 2. Must be enforced as a coding discipline from the first
`process()` implementation.

---

### Pitfall 5: Android Chrome AudioWorklet Timing Instability

**What goes wrong:** AudioWorklet callbacks on Android arrive with irregular timing — delayed
or bunched — causing audible glitches, garbled output, and BPM drift. This affects multiple
device families, not just low-end hardware.

**Why it happens:** Chromium's AudioWorklet thread historically ran at non-real-time priority
on Android (tracked in [Chromium bug #813825](https://bugs.chromium.org/p/chromium/issues/detail?id=813825)).
Android's audio stack is fragmented across OEM implementations; buffer sizes and callback
scheduling vary by manufacturer. The mandated 128-sample render quantum is demanding for
slower mobile SoCs. Specific documented issues include garbled audio on all Google
web-audio-samples AudioWorklet demos ([Issue #189](https://github.com/GoogleChromeLabs/web-audio-samples/issues/189))
and device-specific glitches on Samsung Note 9 ([Chromium #40610669](https://issues.chromium.org/issues/40610669)).

**Consequences:**
- A metronome that sounds correct on desktop may drift or glitch on Android
- Intermittent failures that depend on device model, Android version, and Chrome version
- The `"playback"` `latencyHint` has its own Android-specific glitch bug
  ([Chromium #40133762](https://issues.chromium.org/issues/40133762))

**Prevention:**
- Use `latencyHint: "interactive"` (the default) — do not use `"playback"` on Android
- Implement a lookahead scheduler with 100–200ms overlap: schedule audio events into the
  future using `AudioContext.currentTime`; if a callback is delayed, pre-scheduled events
  still fire correctly
- Set buffer size explicitly larger if the device reports high render capacity; expose
  `AudioContext.renderCapacity` as a diagnostic
- Test on real Android hardware (at minimum two different device families) as part of
  every integration milestone — emulators do not reproduce audio timing bugs
- Monitor `AudioContext.outputLatency` at runtime and surface anomalies to the user

**Warning signs:**
- Inconsistent click timing only on Android, not desktop
- Chrome DevTools audio panel shows render capacity frequently above 70% on device
- `outputLatency` value varies significantly between callbacks

**Phase:** Integration testing / Phase 3. Requires physical Android hardware.

---

### Pitfall 6: iOS Safari AudioWorklet Partial Support and Active Bugs

**What goes wrong:** iOS Safari has shipped AudioWorklet since Safari 14.1, but active bugs
continue into current iOS releases. A confirmed bug causes `AudioWorkletNode` to produce no
audio on iOS 18 (iPhone-specific; iPad and Mac are unaffected). Additionally, iOS locks the
`AudioContext` sample rate to 44,100 Hz on older devices regardless of hardware output rate.

**Why it happens:** All browsers on iOS must use WebKit. Apple controls the release cadence;
bugs can go unfixed for extended periods. The iOS 18 AudioWorklet silence bug was reported and
confirmed as iOS-specific ([Apple Developer Forums thread #768347](https://developer.apple.com/forums/thread/768347)).
The silent-mode hardware switch silences all Web Audio output (but not `<audio>` element
playback).

**Consequences:**
- iOS Safari is listed as a target (macOS), but iPhone users hitting iOS-specific bugs will
  experience complete audio failure
- Silent mode on iPhone silences the metronome with no user-visible error
- Sample rate mismatch between WASM DSP code and `AudioContext.sampleRate` causes pitch/
  timing errors in synthesized audio

**Prevention:**
- Always read `AudioContext.sampleRate` at runtime; never hardcode 44100 or 48000
  (see Pitfall 7 for full details)
- Test on physical iPhone hardware for each iOS major version; do not rely on desktop Safari
  as a proxy
- For the silent mode case: display a persistent warning if `AudioContext.state` is `"running"`
  but no audio has been confirmed (e.g., by checking `AnalyserNode` output levels)
- Document iOS 18 AudioWorklet bug in release notes; provide a workaround path (e.g.,
  fall back to `ScriptProcessorNode` or an `<audio>` element playback path) only if the
  bug is confirmed unfixed at ship time
- Do not treat `AudioContext.state === "running"` as a guarantee that audio is actually
  being output on iOS

**Warning signs:**
- AudioWorklet initializes without error on iOS but `process()` is never called
- No sound on iPhone while iPad (same Safari version) works correctly
- `AudioContext.sampleRate` reports 44100 but device output is 48000

**Phase:** Cross-platform validation / Phase 3. Dedicated iOS hardware testing required.

---

## Moderate Pitfalls

---

### Pitfall 7: Sample Rate Assumption (Hardcoded 44100 or 48000)

**What goes wrong:** WASM DSP code hardcodes a sample rate constant. When the
`AudioContext` runs at a different rate (e.g., 48000 on Windows/Android vs. 44100 on macOS),
synthesized click timing, frequency calculations, and envelope durations are all wrong.
Errors are proportional: a 44100/48000 mismatch is ~8.8% off.

**Why it happens:** macOS defaults to 44100 Hz; Windows and Linux typically default to
48000 Hz; Android Chrome uses the hardware output rate which varies by manufacturer (32000,
44100, 48000 Hz observed in the wild). iOS older devices lock to 44100; newer iPhones match
hardware output. There is no universal default.

**Prevention:**
- Read `AudioContext.sampleRate` immediately after context creation
- Pass the sample rate as a parameter into the WASM engine at initialization time, before
  any audio is generated
- Define all time-domain constants (envelope durations, filter coefficients) in seconds, not
  sample counts; convert to samples at runtime using the live sample rate
- Never use `new AudioContext({ sampleRate: 44100 })` to force a rate — browsers are not
  required to honor this and some (notably some Android devices) will silently use the
  system default anyway; always verify `audioCtx.sampleRate` after construction

**Warning signs:**
- Clicks are consistently pitched differently on Windows vs. macOS
- Synthesized click duration measured in samples does not match expected milliseconds
- Offline rendering produces audio at wrong pitch relative to live rendering

**Phase:** Audio engine implementation / Phase 2.

---

### Pitfall 8: Background Tab Throttling Breaking the Scheduler

**What goes wrong:** When the browser tab is backgrounded, `requestAnimationFrame` drops to
~1fps and `setInterval` may be throttled. A main-thread-based scheduler using either of these
misses beat events. The AudioWorklet itself continues to run, but if the schedule-ahead loop
is on the main thread, BPM drifts or beats are skipped entirely.

**Why it happens:** Browsers aggressively throttle background tabs for power and performance.
The Web Audio `currentTime` clock is immune to this, but only the AudioWorklet thread runs
unthrottled. The main thread JS timer is throttled.

**Prevention:**
- Run the beat scheduler entirely inside the `AudioWorkletProcessor` using
  `AudioWorkletGlobalScope` — it is driven by the audio hardware clock and is never
  throttled
- If the scheduler must live on the main thread (e.g., for UI updates), use an
  `AudioWorkletProcessor` as a tick clock: post a message every N render quanta and use
  `AudioContext.currentTime` in the handler to schedule events with lookahead
- Listen to `document.addEventListener('visibilitychange')` to pause and resume correctly,
  avoiding accumulated drift on tab restore
- Never rely on `setInterval` or `requestAnimationFrame` as the primary timing source

**Warning signs:**
- BPM drifts or beats drop when switching to another tab
- Scheduler falls behind and then "catches up" with a burst of events after tab restore

**Phase:** Audio engine / Phase 2. The scheduler architecture must be correct from the start.

---

### Pitfall 9: wasm-bindgen JS Glue Overhead in AudioWorklet

**What goes wrong:** `wasm-bindgen`'s generated JavaScript wrapper code allocates `String`
and typed array copies on every JS↔Rust boundary crossing. When these boundaries are crossed
inside `process()`, GC pressure builds and timing suffers. Additionally, standard `wasm-pack`
build outputs fail to load in `AudioWorkletGlobalScope` because they call `TextEncoder`/
`TextDecoder`, which are absent from that scope.

**Why it happens:** `wasm-bindgen` is designed for ergonomic main-thread use, not for
allocation-free real-time audio callbacks. Its string handling and typed array conversions
allocate on every call. The `AudioWorkletGlobalScope` also lacks several Web APIs that the
generated JS glue assumes exist.

**Prevention:**
- Expose the audio callback from Rust as a `#[no_mangle] extern "C"` function with a raw
  pointer and length signature; call it from the JS `process()` method without going through
  any `wasm-bindgen` wrapper
- Use `wasm-bindgen` only for one-time initialization (outside `process()`), not for
  per-frame calls
- Pass audio buffers as raw `f32` slices written directly into a pre-allocated `SharedArrayBuffer`
  region mapped to the WASM linear memory — no copying, no allocation
- Load and instantiate the WASM module manually (Pattern B: main thread fetch, postMessage
  transfer) rather than relying on `wasm-pack` output; this also avoids the `TextEncoder`
  crash at worklet startup

**Warning signs:**
- `TextEncoder is not defined` in worklet console
- GC events visible in tracing that correlate to `process()` call boundaries
- WASM module fails to initialize even though the `.wasm` file loads correctly

**Phase:** WASM integration / Phase 2.

---

### Pitfall 10: `process()` Returning `undefined` Silently Stops the Worklet

**What goes wrong:** The `AudioWorkletProcessor.process()` method stops being called with no
error or warning. Audio output goes silent. The `AudioWorkletNode` appears live but produces
nothing.

**Why it happens:** The spec interprets a falsy return value (including `undefined`, which is
what you get from a missing `return` statement) as `false`, which signals to the browser that
the processor is done and may be garbage collected. This is spec-correct but maximally
confusing in practice.

**Prevention:**
- Always end `process()` with `return true` when the processor should continue running
- `return false` only when definitively tearing down (metronome stopped, node being destroyed)
- Add a debug assertion in development builds that logs a warning if `process()` is called
  after having returned `false` unexpectedly

**Warning signs:**
- Audio stops after an indeterminate time with no console errors
- `AudioWorkletNode` events stop firing
- Problem often appears to be timing-related because it depends on when GC runs

**Phase:** Any phase touching the AudioWorklet processor.

---

### Pitfall 11: Battery Drain from Continuous Audio Processing on Mobile

**What goes wrong:** A metronome that runs continuously keeps the audio hardware fully active,
consuming significant battery. On mobile, this is a first-class user complaint — especially
for practice sessions lasting 30+ minutes.

**Why it happens:** Audio processing holds the CPU at elevated clock speeds and prevents
sleep states. A constant synthesized signal (white noise mix) is worse than silent periods
because there is always audio output to render.

**Prevention:**
- When the metronome is stopped, call `audioCtx.suspend()` to release the audio hardware
  — this is the most impactful single optimization
- Resume the context on the next play gesture via `audioCtx.resume()`
- Implement `document.addEventListener('visibilitychange')` to suspend the context when the
  tab is hidden and resume when visible again (prevents drain from accidental background tabs)
- Keep the audio node graph minimal: no unnecessary `AudioNode` instances, no always-on
  analyzers unless the UI requires them
- Use `return false` from `process()` to allow the worklet to be collected when stopped,
  rather than spinning idle at zero output

**Warning signs:**
- Device noticeably warm after 10 minutes of use
- Battery drain in "Settings > Battery" shows the browser as top consumer
- Users report "the app drained my battery"

**Phase:** Polish / Phase 4. Implement `suspend()`/`resume()` during core engine work so
it is available by default, even if battery profiling is deferred.

---

## Minor Pitfalls

---

### Pitfall 12: AudioContext `latencyHint: "playback"` on Android

**What goes wrong:** Using `latencyHint: "playback"` causes a specific, documented glitch
pattern on Android Chrome ([Chromium #40133762](https://issues.chromium.org/issues/40133762)).
Audio skips intermittently.

**Prevention:** Use `latencyHint: "interactive"` (the default) for a metronome. It is
designed for real-time instruments. Verify actual latency via `audioCtx.baseLatency` and
`audioCtx.outputLatency` after construction.

**Phase:** Phase 1 (AudioContext instantiation).

---

### Pitfall 13: `AudioWorkletNode` Disconnected But Still Executing

**What goes wrong:** Disconnecting an `AudioWorkletNode` from the graph does not stop
`process()` from being called. The processor continues consuming CPU and render budget
indefinitely.

**Prevention:** When stopping the metronome, use `return false` from `process()` or
explicitly call `audioWorkletNode.disconnect()` and then send a `stop` message via
`node.port` so the processor can return `false` on the next call.

**Phase:** Any phase that creates/destroys AudioWorkletNodes dynamically.

---

### Pitfall 14: Number of `AudioParam` Parameters Has Measurable Performance Cost

**What goes wrong:** Each registered `AudioParam` on an `AudioWorkletNode` adds per-frame
overhead to `AudioWorkletProcessor::Process`. Measured cases show this overhead going from
0.04ms to 0.013ms per call after reducing parameter count — a 50%+ improvement.

**Prevention:** Minimize the number of `AudioParam`s. Prefer sending control data (BPM,
time signature) as `postMessage` messages on state change rather than as continuously
interpolated `AudioParam`s, which are intended for audio-rate automation.

**Phase:** Audio engine design / Phase 2.

---

### Pitfall 15: WASM Nightly Toolchain Requirement for Threading

**What goes wrong:** Rust WASM threads require compiling the standard library with
`+atomics,+bulk-memory,+mutable-globals` — which requires a nightly toolchain and `build-std`.
If the toolchain is not pinned, CI or collaborator builds break silently when nightly advances.

**Prevention:**
- Add `rust-toolchain.toml` pinning the nightly version from day one of WASM threading use
- Set up CI to verify the WASM build on every push
- Document the nightly dependency explicitly — consider whether WASM threads are strictly
  necessary or whether a single-threaded WASM + ring buffer design is sufficient

**Phase:** WASM toolchain setup / Phase 1.

---

## Phase-Specific Warning Map

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|---------------|------------|
| 1 – Foundation | AudioContext init | Autoplay policy / suspended context | Create context inside play handler; show "Tap to Start" |
| 1 – Foundation | Server headers | Missing COOP/COEP breaks SharedArrayBuffer | Set headers on dev server from day one; test `typeof SharedArrayBuffer` |
| 1 – Foundation | Rust toolchain | Nightly needed for WASM threads | Pin `rust-toolchain.toml` immediately |
| 2 – Audio Engine | WASM loading | No fetch/importScripts in AudioWorkletGlobalScope | Use main-thread fetch + postMessage transfer pattern |
| 2 – Audio Engine | wasm-bindgen glue | TextEncoder crash + hot path allocation | Manual WASM instantiation; `#[no_mangle]` exports for `process()` |
| 2 – Audio Engine | Sample rate | Hardcoded 44100/48000 fails on Windows/Android | Read `AudioContext.sampleRate` at runtime; pass to WASM init |
| 2 – Audio Engine | Scheduler | Main thread throttled in background tabs | Run scheduler inside AudioWorklet; use audio clock not JS timers |
| 2 – Audio Engine | process() return | Missing `return true` silently stops audio | Always return `true`; add dev-mode assertion |
| 2 – Audio Engine | Memory allocation | New arrays/objects in `process()` → GC → glitches | Pre-allocate; ring buffer; zero allocations in hot path |
| 3 – Integration | Android testing | Timing instability, OEM fragmentation | Test on physical Android hardware; lookahead scheduler |
| 3 – Integration | iOS Safari | iOS 18 AudioWorklet silence bug; silent mode | Test on physical iPhone; explicit fallback plan |
| 3 – Integration | Deployment | COOP/COEP missing on production host | Configure headers on Netlify/Vercel/server before first deploy |
| 4 – Polish | Battery drain | Continuous audio keeps CPU elevated | Implement `suspend()`/`resume()` on stop/visibility change |

---

## Sources

- [Chrome Autoplay Policy](https://developer.chrome.com/blog/autoplay) — HIGH confidence
- [MDN Autoplay Guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) — HIGH confidence
- [Chrome Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern/) — HIGH confidence
- [wasm-bindgen Wasm Audio Worklet example](https://rustwasm.github.io/docs/wasm-bindgen/examples/wasm-audio-worklet.html) — HIGH confidence
- [Web Audio API Issue #1439: Expose fetch() in AudioWorkletGlobalScope](https://github.com/WebAudio/web-audio-api/issues/1439) — HIGH confidence (official spec tracker)
- [Web Audio API Issue #2632: AudioWorklet real-world issues](https://github.com/WebAudio/web-audio-api/issues/2632) — HIGH confidence
- [Chromium Bug #813825: Real-time priority for AudioWorklet](https://bugs.chromium.org/p/chromium/issues/detail?id=813825) — HIGH confidence
- [Chromium Bug #40610669: AudioWorklet glitches on Samsung Note 9](https://issues.chromium.org/issues/40610669) — HIGH confidence
- [GoogleChromeLabs web-audio-samples Issue #189: Garbled audio on Android](https://github.com/GoogleChromeLabs/web-audio-samples/issues/189) — HIGH confidence
- [Chromium Bug #40133762: AudioWorklet glitches with "playback" latencyHint](https://issues.chromium.org/issues/40133762) — HIGH confidence
- [Apple Developer Forums #768347: AudioWorklet not playing on iOS 18](https://developer.apple.com/forums/thread/768347) — MEDIUM confidence (forum, not official bug tracker)
- [videocall.rs: Making AudioWorklet fast enough for low-end Android](https://engineering.videocall.rs/posts/how-to-make-javascript-audio-not-suck/) — MEDIUM confidence (primary engineering source)
- [Casey Primozic: AudioWorkletProcessor Performance Pitfall](https://cprimozic.net/blog/webaudio-audioworklet-optimization/) — MEDIUM confidence
- [Web Audio API Issue #2658: Disconnected AudioWorkletNode still executes](https://github.com/WebAudio/web-audio-api/issues/2658) — HIGH confidence
- [MDN AudioWorkletProcessor.process()](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) — HIGH confidence
- [MDN BaseAudioContext.sampleRate](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/sampleRate) — HIGH confidence
- [Mozilla Hacks: High Performance Web Audio with AudioWorklet in Firefox](https://hacks.mozilla.org/2020/05/high-performance-web-audio-with-audioworklet-in-firefox/) — HIGH confidence
- [web.dev: Profiling Web Audio apps in Chrome](https://web.dev/articles/profiling-web-audio-apps-in-chrome) — HIGH confidence
- [wasm-bindgen Issue #2367: Unblock AudioWorklets — TextEncoder alternative](https://github.com/rustwasm/wasm-bindgen/issues/2367) — HIGH confidence (official issue tracker)
- [DEV Community: Why Sample Rate Matters in the Browser](https://dev.to/rijultp/why-sample-rate-matters-when-building-audio-features-in-the-browser-4982) — MEDIUM confidence
