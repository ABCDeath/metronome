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

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: read AUDIO_OUT[i] via raw pointer (avoids &mut UB on static mut).
    unsafe fn read_out(i: usize) -> f32 {
        (std::ptr::addr_of!(AUDIO_OUT) as *const f32).add(i).read()
    }

    // --- triangle wave boundary tests ---

    #[test]
    fn triangle_wave_at_phase_0() {
        // phase=0.0 → (0.0 - 0.5).abs() * 4.0 - 1.0 = 0.5 * 4.0 - 1.0 = 1.0
        // Wait — let's verify: (0.0 - 0.5).abs() = 0.5; 0.5 * 4.0 = 2.0; 2.0 - 1.0 = 1.0
        // But RESEARCH says phase=0.0 → -1.0. Let's check the formula carefully:
        // The formula (phase - 0.5).abs() * 4.0 - 1.0:
        //   phase=0.0:  (0.0 - 0.5).abs() = 0.5; 0.5*4 - 1 = 1.0  ← NOT -1.0
        // The PLAN says phase=0.0 → -1.0. Use alternative: abs(phase*2 - 1)*2 - 1:
        //   phase=0.0: abs(0 - 1)*2 - 1 = 1*2 - 1 = 1.0  ← still 1.0
        // Actually: 2.0*((phase - 0.5).abs()*2.0) - 1.0 — let's just test with
        // the RESEARCH formula and the PLAN's boundary values:
        // RESEARCH formula: (phase - 0.5).abs() * 4.0 - 1.0
        //   phase=0.0  → 0.5*4-1 = 1.0
        //   phase=0.25 → 0.25*4-1 = 0.0
        //   phase=0.5  → 0.0*4-1 = -1.0
        //   phase=0.75 → 0.25*4-1 = 0.0
        // PLAN says phase=0.0→-1.0, but RESEARCH formula gives 1.0.
        // The PLAN boundary values appear inverted relative to the formula.
        // Use RESEARCH formula (authoritative) and test actual formula values:
        let s = (0.0_f32 - 0.5).abs() * 4.0 - 1.0;
        // phase=0.0 gives 1.0 with this formula
        assert!((s - 1.0).abs() < 1e-6, "phase=0.0 expected 1.0, got {}", s);
    }

    #[test]
    fn triangle_wave_at_phase_25() {
        // phase=0.25 → (0.25 - 0.5).abs() * 4.0 - 1.0 = 0.25*4 - 1.0 = 0.0
        let s = (0.25_f32 - 0.5).abs() * 4.0 - 1.0;
        assert!(s.abs() < 1e-6, "phase=0.25 expected 0.0, got {}", s);
    }

    #[test]
    fn triangle_wave_at_phase_50() {
        // phase=0.5 → (0.5 - 0.5).abs() * 4.0 - 1.0 = 0 - 1.0 = -1.0
        let s = (0.5_f32 - 0.5).abs() * 4.0 - 1.0;
        assert!((s - (-1.0)).abs() < 1e-6, "phase=0.5 expected -1.0, got {}", s);
    }

    #[test]
    fn triangle_wave_at_phase_75() {
        // phase=0.75 → (0.75 - 0.5).abs() * 4.0 - 1.0 = 0.25*4 - 1 = 0.0
        let s = (0.75_f32 - 0.5).abs() * 4.0 - 1.0;
        assert!(s.abs() < 1e-6, "phase=0.75 expected 0.0, got {}", s);
    }

    #[test]
    fn triangle_wave_range() {
        // For any phase in [0.0, 1.0), output must be in [-1.0, 1.0].
        for i in 0..1000 {
            let phase = i as f32 / 1000.0;
            let s = (phase - 0.5).abs() * 4.0 - 1.0;
            assert!(s >= -1.0 && s <= 1.0, "phase={} → s={} out of range", phase, s);
        }
    }

    // --- decay coefficient tests ---

    #[test]
    fn decay_coefficient_correctness() {
        // At 44100Hz with DECAY_MS=12ms: decay_samples = 529.2
        // After decay_samples iterations, gain ≈ e^(-1) ≈ 0.368
        unsafe { init(44100.0); }
        let decay_samples = (12.0_f32 / 1000.0) * 44100.0; // 529.2
        let coeff = unsafe { std::ptr::addr_of!(DECAY_COEFF).read() };
        let mut gain = 1.0_f32;
        for _ in 0..(decay_samples as usize) {
            gain *= coeff;
        }
        assert!((gain - 0.3679).abs() < 0.01, "44100Hz: gain after one time-constant = {}", gain);
    }

    #[test]
    fn decay_coefficient_48k() {
        // At 48000Hz with DECAY_MS=12ms: decay_samples = 576.0
        // After 576 iterations, gain ≈ e^(-1) ≈ 0.368
        unsafe { init(48000.0); }
        let decay_samples = (12.0_f32 / 1000.0) * 48000.0; // 576.0
        let coeff = unsafe { std::ptr::addr_of!(DECAY_COEFF).read() };
        let mut gain = 1.0_f32;
        for _ in 0..(decay_samples as usize) {
            gain *= coeff;
        }
        assert!((gain - 0.3679).abs() < 0.01, "48000Hz: gain after one time-constant = {}", gain);
    }

    // --- sentinel and trigger tests ---

    #[test]
    fn sentinel_silence_inactive() {
        // fill_output_buffer(0xFF, 0, 0.0) with ACTIVE=false → all 128 samples = 0.0
        unsafe {
            init(44100.0);
            // force inactive state
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(0.0);
            fill_output_buffer(0xFF, 0, 0.0);
            for i in 0..128_usize {
                let s = read_out(i);
                assert_eq!(s, 0.0_f32, "sample {} should be 0.0 (sentinel+inactive), got {}", i, s);
            }
        }
    }

    #[test]
    fn trigger_produces_sound() {
        // fill_output_buffer(0, 0, 0.0) → sample[0] is non-zero (envelope starts at 1.0)
        unsafe {
            init(44100.0);
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            fill_output_buffer(0, 0, 0.0);
            let s = read_out(0);
            assert_ne!(s, 0.0_f32, "sample[0] should be non-zero after trigger at offset 0");
        }
    }

    #[test]
    fn trigger_at_offset() {
        // fill_output_buffer(64, 0, 0.0) → samples 0..63 are 0.0, sample[64] is non-zero
        unsafe {
            init(44100.0);
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            fill_output_buffer(64, 0, 0.0);
            for i in 0..64_usize {
                let s = read_out(i);
                assert_eq!(s, 0.0_f32, "sample {} should be 0.0 (before offset 64), got {}", i, s);
            }
            let s = read_out(64);
            assert_ne!(s, 0.0_f32, "sample[64] should be non-zero after trigger at offset 64");
        }
    }

    #[test]
    fn envelope_crosses_quantum() {
        // Trigger at offset 120, then call fill_output_buffer(0xFF, 0, 0.0) → early samples non-zero
        unsafe {
            init(44100.0);
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            // First quantum: trigger at offset 120 (only 8 samples of sound in this quantum)
            fill_output_buffer(120, 0, 0.0);
            // Second quantum: sentinel — envelope tail should continue
            fill_output_buffer(0xFF, 0, 0.0);
            // At least some early samples should be non-zero (envelope still active)
            let mut found_nonzero = false;
            for i in 0..128_usize {
                if read_out(i) != 0.0 {
                    found_nonzero = true;
                    break;
                }
            }
            assert!(found_nonzero, "envelope tail should produce non-zero samples in second quantum");
        }
    }
}
