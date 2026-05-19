// Phase 1: Silence-only WASM module.
// No heap allocations — static buffers only (D-11).
// Exports use #[no_mangle] pub extern "C" fn only (D-08).
// wasm-bindgen crate is NOT a dependency — pure C ABI exports, no JS glue needed.

static mut AUDIO_OUT: [f32; 128] = [0.0; 128];
static mut SAMPLE_RATE: f32 = 44100.0;

/// Returns a pointer to the static output buffer.
/// The AudioWorklet creates a Float32Array view over this pointer once at init.
#[no_mangle]
pub extern "C" fn get_output_buffer_ptr() -> *const f32 {
    // SAFETY: addr_of! does not create a reference; it takes the raw address.
    // Single-threaded WASM — no concurrent access possible.
    std::ptr::addr_of!(AUDIO_OUT) as *const f32
}

/// Called every AudioWorklet process() callback.
/// Fills AUDIO_OUT with silence (Phase 1 — DSP added in Phase 2).
/// beat_flags: bitmask of voices to trigger (unused in Phase 1)
/// noise_gain: float 0.0–1.0 (unused in Phase 1)
#[no_mangle]
pub extern "C" fn fill_output_buffer(_beat_flags: u32, _noise_gain: f32) {
    // Phase 1: silence. No allocation, no branching.
    // SAFETY: Single-threaded WASM; no concurrent mutation possible.
    unsafe {
        let ptr = std::ptr::addr_of_mut!(AUDIO_OUT) as *mut f32;
        for i in 0..128_usize {
            ptr.add(i).write(0.0_f32);
        }
    }
}

/// Stores the AudioContext sample rate for Phase 2 DSP use.
/// Called once from the AudioWorklet constructor.
#[no_mangle]
pub extern "C" fn init(sample_rate: f32) {
    // SAFETY: Single-threaded WASM; no concurrent mutation possible.
    unsafe {
        std::ptr::addr_of_mut!(SAMPLE_RATE).write(sample_rate);
    }
}
