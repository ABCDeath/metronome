// AudioWorklet processor for Metronome — plain JS static file (NOT processed by Vite).
// D-07: receives WebAssembly.Module via processorOptions (compiled on main thread).
// D-08: uses only #[no_mangle] extern "C" exports — no TextEncoder/TextDecoder.
// D-11: Float32Array view created ONCE in constructor; process() has zero allocations.

class MetronomeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // Extract the pre-compiled WebAssembly.Module from processorOptions (D-07).
    const { wasmModule } = options.processorOptions;

    // Not ready until WASM instantiation completes.
    this._ready = false;
    this._exports = null;
    this._outputView = null;

    // Typed array views over SharedArrayBuffers — set when "init-buffers" message arrives.
    this._ringIndices = null;
    this._ringData = null;
    this._paramBuffer = null;

    // Instantiate WASM from the compiled module — no fetch, no TextEncoder needed (D-08).
    // sampleRate is a read-only global in AudioWorkletGlobalScope (MDN: AudioWorkletGlobalScope).
    WebAssembly.instantiate(wasmModule, {}).then((instance) => {
      this._exports = instance.exports;

      // Pass the AudioContext sample rate to WASM for Phase 2 DSP use.
      // sampleRate is a global in AudioWorkletGlobalScope — do NOT pass via processorOptions.
      this._exports.init(sampleRate);

      // Prime accent params from paramSAB slots 2 and 3 (written by main thread before 'ready').
      // The 'init-buffers' message arrives before WASM instantiation completes, so _paramBuffer
      // may already be set. If not (or if slots are 0), use safe defaults (1400 Hz / 1.3x amp).
      if (this._paramBuffer) {
        const freqHz = Atomics.load(this._paramBuffer, 2);
        const ampMillis = Atomics.load(this._paramBuffer, 3);
        if (freqHz > 0) {
          this._exports.set_accent_params(freqHz, ampMillis / 1000.0);
        } else {
          this._exports.set_accent_params(1400.0, 1.3);
        }
      } else {
        this._exports.set_accent_params(1400.0, 1.3);
      }

      // Get the pointer to the static AUDIO_OUT buffer in WASM linear memory.
      const ptr = this._exports.get_output_buffer_ptr();

      // Create Float32Array view ONCE — reused on every process() call (D-11).
      // 128 frames = one AudioWorklet render quantum.
      this._outputView = new Float32Array(instance.exports.memory.buffer, ptr, 128);

      this._ready = true;
      this.port.postMessage({ type: 'ready' });
    });

    // Handle messages from the main thread.
    this.port.onmessage = (event) => {
      if (event.data.type === 'init-buffers') {
        const { controlRing, paramBuffer } = event.data;
        // Create typed array views over SharedArrayBuffers ONCE (D-11).
        // controlRing layout: [readIdx: Int32][writeIdx: Int32][256 x Uint32 beat events]
        this._ringIndices = new Int32Array(controlRing, 0, 2);
        this._ringData = new Uint32Array(controlRing, 8, 256);
        // paramBuffer: 8 x Int32 parameter slots.
        this._paramBuffer = new Int32Array(paramBuffer, 0, 8);
      } else if (event.data.type === 'update-accent' && this._exports) {
        // Main thread called updatePattern() — propagate new accent params to WASM.
        // event.data.freqHz: accent frequency in Hz; event.data.amp: amplitude multiplier (float).
        this._exports.set_accent_params(event.data.freqHz, event.data.amp);
      }
    };
  }

  // Called every 128-sample render quantum by the audio thread.
  // MUST return true to keep the processor alive.
  // ZERO allocations: no new, no object literals, no string operations (D-11, T-01-03).
  process(_inputs, outputs) {
    // Guard: _ringIndices arrives via "init-buffers" message, which is async from _ready.
    // Both must be set before Atomics.load — a missing _ringIndices would throw TypeError
    // and kill the processor permanently (CR-01).
    if (!this._ready || !this._ringIndices || !this._paramBuffer) {
      return true;
    }

    // Read ring indices — Atomics.load, no allocation (D-06)
    const readIdx  = Atomics.load(this._ringIndices, 0);  // slot 0 = read index
    const writeIdx = Atomics.load(this._ringIndices, 1);  // slot 1 = write index

    let sampleOffset = 0xFF; // NO_BEAT_SENTINEL — default: no beat this quantum
    let voice = 0;

    if (readIdx !== writeIdx) {
      const event = this._ringData[readIdx];           // Uint32Array read — no allocation
      const evOffset  =  event & 0x7F;                // bits 0–6: sample offset (0–127)
      const evVoice   = (event >> 7) & 0x1F;          // bits 7–11: voice type
      const evQuantum = (event >>> 12) & 0xFFFFF;     // bits 12–31: quantum index (unsigned shift, CR-02)
      const myQuantum = (currentFrame / 128) | 0;     // (x | 0) = integer truncation, no alloc

      if (evQuantum === myQuantum) {
        // Event fires in the current quantum — consume it
        sampleOffset = evOffset;
        voice = evVoice;
        Atomics.store(this._ringIndices, 0, (readIdx + 1) & 0xFF);  // advance read index
      } else if (evQuantum < myQuantum) {
        // Stale event — drain it (prevents ring from blocking on missed quanta)
        Atomics.store(this._ringIndices, 0, (readIdx + 1) & 0xFF);
      }
      // evQuantum > myQuantum: leave in ring for a future quantum (do nothing)
    }

    // Read noise gain from paramSAB slot 4 — fresh every frame (slider can change any time).
    const noiseGainMillis = Atomics.load(this._paramBuffer, 4);
    const noiseGain = noiseGainMillis / 1000.0;

    // Call fill_output_buffer with 3 args per D-05 (updated from Phase 1 2-arg stub).
    this._exports.fill_output_buffer(sampleOffset, voice, noiseGain);

    // Copy 128 f32 samples from WASM linear memory to the output buffer.
    // outputs[0][0] is the mono output channel Float32Array.
    outputs[0][0].set(this._outputView);

    return true;
  }
}

registerProcessor('metronome-processor', MetronomeProcessor);
