// Main-thread AudioEngine — fetches + compiles WASM, creates AudioWorkletNode, allocates SABs.
// D-07: WASM compiled via WebAssembly.compile() on main thread, passed via processorOptions.
// D-12: AudioContext created ONLY on Play button click (user gesture). NEVER at import time.
// D-11: SharedArrayBuffers pre-allocated once; zero allocations in the audio hot path.

type AudioEngineState = 'stopped' | 'running';

export class AudioEngine {
  private _audioCtx: AudioContext | null = null;
  private _workletNode: AudioWorkletNode | null = null;
  private _controlRingSAB: SharedArrayBuffer | null = null;
  private _paramSAB: SharedArrayBuffer | null = null;
  private _state: AudioEngineState = 'stopped';
  private _onStateChange: ((state: AudioEngineState) => void) | null;
  private _schedulerIntervalId: ReturnType<typeof setInterval> | null = null;
  private _nextBeatTime: number = 0;
  private _controlRingIndices: Int32Array | null = null;
  private _controlRingData: Uint32Array | null = null;

  constructor(onStateChange?: (state: AudioEngineState) => void) {
    // AudioContext is NOT created here — only in start() via user gesture (D-12).
    this._onStateChange = onStateChange ?? null;
  }

  get state(): AudioEngineState {
    return this._state;
  }

  async start(): Promise<void> {
    // Idempotent — no-op if already running.
    if (this._state === 'running') {
      return;
    }

    // Create AudioContext only on the first call to start() — satisfies user gesture gate (D-12).
    if (!this._audioCtx) {
      this._audioCtx = new AudioContext({ latencyHint: 'interactive' });
    }

    // Resume if the context was suspended (e.g., auto-suspended by browser autoplay policy).
    if (this._audioCtx.state === 'suspended') {
      await this._audioCtx.resume();
    }

    if (!this._workletNode) {
      // Fetch and compile WASM on the main thread (D-07).
      // Fetch is available on the main thread; AudioWorkletGlobalScope has no fetch.
      const response = await fetch('/wasm/metronome_engine_bg.wasm');
      const buffer = await response.arrayBuffer();
      const wasmModule = await WebAssembly.compile(buffer);

      // Load the AudioWorklet processor script (served from public/ as a static asset, D-03).
      await this._audioCtx.audioWorklet.addModule('/worklet/processor.js');

      // Allocate SharedArrayBuffers (D-11 — pre-allocated, never re-allocated).
      // controlRingSAB layout:
      //   Bytes 0-3:    read index (Int32)
      //   Bytes 4-7:    write index (Int32)
      //   Bytes 8-1031: 256 x Uint32 beat event slots
      this._controlRingSAB = new SharedArrayBuffer(4 + 4 + 256 * 4); // 1032 bytes
      // paramSAB: 8 x Int32 parameter slots (noise gain, is_playing, BPM, etc. for Phase 2+).
      this._paramSAB = new SharedArrayBuffer(8 * 4); // 32 bytes

      // Create typed array views for the scheduler's ring writes (producer side).
      // Matches the layout the worklet creates: indices at bytes 0-7, data at bytes 8-1031.
      this._controlRingIndices = new Int32Array(this._controlRingSAB, 0, 2);
      this._controlRingData = new Uint32Array(this._controlRingSAB, 8, 256);

      // Pass the compiled WebAssembly.Module via processorOptions (D-07).
      // WebAssembly.Module is serializable via structured clone — no postMessage needed.
      this._workletNode = new AudioWorkletNode(
        this._audioCtx,
        'metronome-processor',
        {
          processorOptions: { wasmModule },
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1], // mono
        }
      );

      // Transfer SharedArrayBuffers to the AudioWorklet processor.
      // The worklet creates typed array views over these buffers (D-11).
      this._workletNode.port.postMessage({
        type: 'init-buffers',
        controlRing: this._controlRingSAB,
        paramBuffer: this._paramSAB,
      });

      // Listen for the "ready" message from the worklet (emitted after WASM instantiates).
      this._workletNode.port.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'ready') {
          console.log(
            '[AudioEngine] AudioWorklet ready — crossOriginIsolated:',
            (self as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated
          );
        }
      };

      // Connect the worklet node to the audio output.
      this._workletNode.connect(this._audioCtx.destination);
    }

    this._state = 'running';
    // Seed nextBeatTime to now — prevents flooding the ring with stale events (RESEARCH.md Pitfall 2)
    this._nextBeatTime = this._audioCtx!.currentTime;
    this._schedulerIntervalId = setInterval(() => this._schedulerTick(), 25);
    this._onStateChange?.(this._state);
  }

  async stop(): Promise<void> {
    // Idempotent — no-op if already stopped.
    if (this._state === 'stopped') {
      return;
    }

    // Cancel scheduler before suspending context (D-07 scheduler cleanup)
    if (this._schedulerIntervalId !== null) {
      clearInterval(this._schedulerIntervalId);
      this._schedulerIntervalId = null;
    }
    // Clear the ring buffer to prevent stale events on next start() (RESEARCH.md Pitfall 4)
    if (this._controlRingIndices) {
      Atomics.store(this._controlRingIndices, 0, 0); // reset read index
      Atomics.store(this._controlRingIndices, 1, 0); // reset write index
    }

    if (this._audioCtx) {
      await this._audioCtx.suspend();
    }

    this._state = 'stopped';
    this._onStateChange?.(this._state);
  }

  private _schedulerTick(): void {
    if (!this._audioCtx || !this._controlRingIndices || !this._controlRingData) return;

    const sampleRate = this._audioCtx.sampleRate;
    const lookahead = 0.1; // 100ms lookahead window (D-07)

    while (this._nextBeatTime < this._audioCtx.currentTime + lookahead) {
      const beatSampleAbs = this._nextBeatTime * sampleRate;
      const quantumIndex  = Math.floor(beatSampleAbs / 128);
      const sampleOffset  = Math.min(Math.round(beatSampleAbs % 128), 127); // clamp to 0–127

      // Pack u32 event (D-04):
      //   bits  0–6:  sampleOffset (0–127)
      //   bits  7–11: voice = 0 (normal; accent reserved for Phase 3)
      //   bits 12–31: quantumIndex (Strategy A — robust for Phase 3+ extensions)
      const event = (sampleOffset & 0x7F) | (quantumIndex << 12);

      // Write to SPSC ring — producer side (D-06: Atomics.store on write index)
      const writeIdx  = Atomics.load(this._controlRingIndices, 1);
      const nextWrite = (writeIdx + 1) & 0xFF; // 256-slot ring mask
      if (nextWrite !== Atomics.load(this._controlRingIndices, 0)) { // not full (T-02-03)
        this._controlRingData[writeIdx] = event;
        Atomics.store(this._controlRingIndices, 1, nextWrite);
      }

      this._nextBeatTime += 60.0 / 120; // fixed 120 BPM for Phase 2 (Phase 3 replaces constant)
    }
  }
}
