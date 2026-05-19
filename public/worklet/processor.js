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
    WebAssembly.instantiate(wasmModule, {}).then(({ instance }) => {
      this._exports = instance.exports;

      // Pass the AudioContext sample rate to WASM for Phase 2 DSP use.
      // sampleRate is a global in AudioWorkletGlobalScope — do NOT pass via processorOptions.
      this._exports.init(sampleRate);

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
      }
    };
  }

  // Called every 128-sample render quantum by the audio thread.
  // MUST return true to keep the processor alive.
  // ZERO allocations: no new, no object literals, no string operations (D-11, T-01-03).
  process(_inputs, outputs) {
    if (!this._ready) {
      return true;
    }

    // Phase 1: fill with silence — no beat scheduling yet.
    // beat_flags=0, noise_gain=0.0
    this._exports.fill_output_buffer(0, 0.0);

    // Copy 128 f32 samples from WASM linear memory to the output buffer.
    // outputs[0][0] is the mono output channel Float32Array.
    outputs[0][0].set(this._outputView);

    return true;
  }
}

registerProcessor('metronome-processor', MetronomeProcessor);
