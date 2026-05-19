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
    this._onStateChange?.(this._state);
  }

  async stop(): Promise<void> {
    // Idempotent — no-op if already stopped.
    if (this._state === 'stopped') {
      return;
    }

    if (this._audioCtx) {
      await this._audioCtx.suspend();
    }

    this._state = 'stopped';
    this._onStateChange?.(this._state);
  }
}
