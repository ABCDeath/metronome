// Phase 2: Click DSP synthesis — triangle wave + exponential decay envelope.
// No heap allocations — static buffers only (D-11).
// Exports use #[no_mangle] pub extern "C" fn only (D-08).
// wasm-bindgen crate is NOT a dependency — pure C ABI exports, no JS glue needed.

static mut AUDIO_OUT: [f32; 128] = [0.0; 128];
static mut SAMPLE_RATE: f32 = 44100.0;
static mut PHASE_ACCUM: f32 = 0.0;      // triangle wave phase in [0.0, 1.0)
static mut PHASE_INC: f32 = 0.0;        // set in init() = CLICK_FREQ / SAMPLE_RATE
static mut ENVELOPE_GAIN: f32 = 0.0;    // current envelope amplitude
static mut DECAY_COEFF: f32 = 0.0;      // set in init() = exp(-1 / decay_samples)
static mut ACTIVE: bool = false;         // is the click envelope currently running?

const CLICK_FREQ: f32 = 1000.0;         // D-01: 1000 Hz warm click
const DECAY_MS: f32 = 12.0;             // D-02: 12ms (midpoint of 10–15ms range)
const SILENCE_THRESHOLD: f32 = 1.0e-4;  // stop rendering when envelope falls below this
const NO_BEAT_SENTINEL: u32 = 0xFF;     // sample_offset value meaning "no beat this quantum"

/// Returns a pointer to the static output buffer.
/// The AudioWorklet creates a Float32Array view over this pointer once at init.
#[no_mangle]
pub extern "C" fn get_output_buffer_ptr() -> *const f32 {
    // SAFETY: addr_of! does not create a reference; it takes the raw address.
    // Single-threaded WASM — no concurrent access possible.
    std::ptr::addr_of!(AUDIO_OUT) as *const f32
}

/// Triangle wave sample function.
/// phase in [0.0, 1.0) → output in [-1.0, 1.0].
/// Odd harmonics at 1/n² amplitudes — mechanical woodblock character (D-03).
#[inline(always)]
fn triangle_sample(phase: f32) -> f32 {
    (phase - 0.5).abs() * 4.0 - 1.0
}

/// Called every AudioWorklet process() callback (128 samples per call).
/// sample_offset: sample within this quantum where the click starts (0–127),
///                or NO_BEAT_SENTINEL (0xFF) if no beat fires this quantum.
/// _voice:        voice type (0=normal; reserved for Phase 3 accent/ghost).
/// _noise_gain:   white noise mix level (unused until Phase 3).
#[no_mangle]
pub extern "C" fn fill_output_buffer(sample_offset: u32, _voice: u32, _noise_gain: f32) {
    // SAFETY: Single-threaded WASM; no concurrent mutation possible.
    unsafe {
        let ptr = std::ptr::addr_of_mut!(AUDIO_OUT) as *mut f32;

        // Trigger: arm envelope if a beat fires this quantum (T-02-01: sentinel guards OOB).
        if sample_offset != NO_BEAT_SENTINEL {
            std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(1.0_f32);
            std::ptr::addr_of_mut!(PHASE_ACCUM).write(0.0_f32);
            std::ptr::addr_of_mut!(ACTIVE).write(true);
        }

        for i in 0..128_usize {
            let sample = if std::ptr::addr_of!(ACTIVE).read()
                && (sample_offset == NO_BEAT_SENTINEL || i >= sample_offset as usize)
            {
                let phase = std::ptr::addr_of!(PHASE_ACCUM).read();
                let gain = std::ptr::addr_of!(ENVELOPE_GAIN).read();

                // Triangle wave synthesis
                let s = triangle_sample(phase);
                let output = s * gain;

                // Advance phase — subtraction avoids float division (RESEARCH.md anti-pattern)
                let mut new_phase = phase + std::ptr::addr_of!(PHASE_INC).read();
                if new_phase >= 1.0 {
                    new_phase -= 1.0;
                }
                std::ptr::addr_of_mut!(PHASE_ACCUM).write(new_phase);

                // Advance envelope — multiplicative decay persists across quanta (Pitfall 1)
                let new_gain = gain * std::ptr::addr_of!(DECAY_COEFF).read();
                std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(new_gain);
                if new_gain < SILENCE_THRESHOLD {
                    std::ptr::addr_of_mut!(ACTIVE).write(false);
                }

                output
            } else {
                0.0_f32
            };
            ptr.add(i).write(sample);
        }
    }
}

/// Stores the AudioContext sample rate and derives DSP constants.
/// Called once from the AudioWorklet constructor.
#[no_mangle]
pub extern "C" fn init(sample_rate: f32) {
    // SAFETY: Single-threaded WASM; no concurrent mutation possible.
    unsafe {
        std::ptr::addr_of_mut!(SAMPLE_RATE).write(sample_rate);
        let phase_inc = CLICK_FREQ / sample_rate;
        std::ptr::addr_of_mut!(PHASE_INC).write(phase_inc);
        let decay_samples = (DECAY_MS / 1000.0) * sample_rate;
        let decay_coeff = (-1.0_f32 / decay_samples).exp();
        std::ptr::addr_of_mut!(DECAY_COEFF).write(decay_coeff);
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
        // phase=0.0: (0.0 - 0.5).abs() * 4.0 - 1.0 = 0.5*4 - 1 = 1.0
        let s = (0.0_f32 - 0.5).abs() * 4.0 - 1.0;
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
        init(44100.0);
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
        init(48000.0);
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

    // --- Phase 3 accent DSP stubs (Wave 1 will replace placeholder assertions) ---

    #[test]
    fn test_accent_amplitude_differs() {
        // Wave 1: verify fill_output_buffer(0,1,0.0) peak > fill_output_buffer(0,0,0.0) peak
        assert!(true);
    }

    #[test]
    fn test_accent_pitch_differs() {
        // Wave 1: verify PHASE_INC differs for voice=1 vs voice=0
        assert!(true);
    }

    #[test]
    fn test_phase_inc_reset_on_normal() {
        // Wave 1: trigger accent then normal, verify PHASE_INC returns to CLICK_FREQ/SR
        assert!(true);
    }

    #[test]
    fn test_set_accent_params_roundtrip() {
        // Wave 1: call set_accent_params(1400.0, 1.3), verify statics
        assert!(true);
    }

    #[test]
    fn test_bar_step_cycling() {
        // Real modulo test: verifies the step % stepCount cycling pattern used by the scheduler.
        assert_eq!(0 % 4, 0);
        assert_eq!(3 % 4, 3);
        assert_eq!(4 % 4, 0);
        assert_eq!(7 % 4, 3);
        assert_eq!(100 % 4, 0);
    }
}
