// Main-thread AudioEngine — fetches + compiles WASM, creates AudioWorkletNode, allocates SABs.
// D-07: WASM compiled via WebAssembly.compile() on main thread, passed via processorOptions.
// D-12: AudioContext created ONLY on Play button click (user gesture). NEVER at import time.
// D-11: SharedArrayBuffers pre-allocated once; zero allocations in the audio hot path.

import type { PatternState, BeatPosition, Subdivision } from './pattern.js';
import { SUBDIV_MULT } from './pattern.js';

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
  private _paramBuffer: Int32Array | null = null;          // Int32Array view over _paramSAB
  private _stepInterval: number = 60.0 / 120;             // seconds per step (recomputed by updatePattern)
  private _beats: BeatPosition[] = [{ voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 0 }];
  private _stepCount: number = 4;
  private _barStep: number = 0;

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
      this._paramBuffer = new Int32Array(this._paramSAB, 0, 8);

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
    // Seed nextBeatTime 50ms ahead so the first quantum is always in the future when the
    // worklet processes it. Seeding at exactly currentTime causes the first beat's quantum
    // to be stale by the time the scheduler fires 25ms later (worklet drains it silently).
    this._nextBeatTime = this._audioCtx!.currentTime + 0.05;
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
    // Reset bar position so playback restarts from beat 0 (D-09)
    this._barStep = 0;

    if (this._audioCtx) {
      await this._audioCtx.suspend();
    }

    this._state = 'stopped';
    this._onStateChange?.(this._state);
  }

  /**
   * Update the audio engine with new pattern state.
   * Computes step interval (D-08), updates beat array, writes accent params to paramSAB.
   * Safe to call before start() — paramSAB writes are guarded (Pitfall P3-04).
   * Do NOT modify _nextBeatTime here (Pitfall P3-01: never reset nextBeatTime in updatePattern).
   */
  updatePattern(state: PatternState): void {
    const track = state.tracks[0];
    const mult = SUBDIV_MULT[track.subdivision as Subdivision] ?? 1;
    const newInterval = (60.0 / state.bpm) * (4 / track.denominator) / mult;
    const newStepCount = track.stepCount;

    // Reset bar position when step count changes (Pitfall P3-02: stale barStep OOB)
    if (newStepCount !== this._stepCount) {
      this._barStep = 0;
    }

    this._stepInterval = newInterval;
    this._stepCount    = newStepCount;
    this._beats        = track.beats;

    // Read accent params unconditionally so Svelte $effect tracks these fields on every run.
    // If reads are inside null-guarded blocks, Svelte won't register them as dependencies on
    // the first effect run (before start()), and toggle changes won't trigger updatePattern.
    const accentFreqHz = state.accentFreqHz;
    const accentAmpMillis = state.accentAmpMillis;

    // Write accent params to paramSAB — guarded for pre-start() calls (Pitfall P3-04)
    if (this._paramBuffer) {
      Atomics.store(this._paramBuffer, 2, accentFreqHz);
      Atomics.store(this._paramBuffer, 3, accentAmpMillis);
    }

    // Notify worklet to update accent params immediately (Research Open Question 1, Option A)
    if (this._workletNode) {
      this._workletNode.port.postMessage({
        type: 'update-accent',
        freqHz: accentFreqHz,
        amp: accentAmpMillis / 1000.0,
      });
    }
  }

  private _schedulerTick(): void {
    if (!this._audioCtx || !this._controlRingIndices || !this._controlRingData) return;

    const sampleRate = this._audioCtx.sampleRate;
    const lookahead = 0.1; // 100ms lookahead window (D-07)

    while (this._nextBeatTime < this._audioCtx.currentTime + lookahead) {
      const beatSampleAbs = this._nextBeatTime * sampleRate;
      const quantumIndex  = Math.floor(beatSampleAbs / 128);
      const sampleOffset  = Math.min(Math.round(beatSampleAbs % 128), 127); // clamp to 0–127

      // Compute step index and voice for this beat (D-09)
      const stepIndex = this._barStep % this._stepCount;
      const voice     = this._beats[stepIndex]?.voice ?? 0;

      // Pack u32 event (D-04):
      //   bits  0–6:  sampleOffset (0–127)
      //   bits  7–11: voice (0=normal, 1=accent)
      //   bits 12–31: quantumIndex (Strategy A — robust for Phase 3+ extensions)
      const event = (sampleOffset & 0x7F) | ((voice & 0x1F) << 7) | ((quantumIndex & 0xFFFFF) << 12); // mask to 20 bits before shift (CR-02)

      // Write to SPSC ring — producer side (D-06: Atomics.store on write index)
      const writeIdx  = Atomics.load(this._controlRingIndices, 1);
      const nextWrite = (writeIdx + 1) & 0xFF; // 256-slot ring mask
      if (nextWrite !== Atomics.load(this._controlRingIndices, 0)) { // not full (T-02-03)
        this._controlRingData[writeIdx] = event;
        Atomics.store(this._controlRingIndices, 1, nextWrite);
      }

      this._nextBeatTime += this._stepInterval; // dynamic step interval from updatePattern() (D-09)
      this._barStep++;                           // advance bar position for next event
    }
  }
}
