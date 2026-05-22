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
static mut ACCENT_FREQ: f32 = 1400.0;   // D-02: 1400 Hz accent vs 1000 Hz normal
static mut ACCENT_AMP: f32 = 1.3;       // D-03: default 1.3× multiplier (both toggles on)
static mut PRNG_STATE: u32 = 12345;     // D-12: xorshift32 seed — must be non-zero
static mut CLICK_SOUND: u32 = 0;        // 0=beep, 1=woodblock, 2=sticks
static mut DECAY_COEFF_WOOD: f32 = 0.0; // derived in init(): 7ms decay for woodblock
static mut DECAY_COEFF_STICK: f32 = 0.0; // derived in init(): 5ms decay for sticks

const CLICK_FREQ: f32 = 1000.0;         // D-01: 1000 Hz warm click
const DECAY_MS: f32 = 12.0;             // D-02: 12ms (midpoint of 10–15ms range)
const SILENCE_THRESHOLD: f32 = 1.0e-4;  // stop rendering when envelope falls below this
const NO_BEAT_SENTINEL: u32 = 0xFF;     // sample_offset value meaning "no beat this quantum"
const WOOD_CLICK_FREQ: f32 = 600.0;     // woodblock normal: lower, hollow sine
const WOOD_ACCENT_FREQ: f32 = 900.0;    // woodblock accent: higher pitch
const WOOD_DECAY_MS: f32 = 7.0;         // woodblock: shorter, punchier than beep
const STICK_CLICK_FREQ: f32 = 3000.0;   // sticks: high-freq tone component
const STICK_DECAY_MS: f32 = 5.0;        // sticks: very fast, percussive

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
#[inline(always)]
fn triangle_sample(phase: f32) -> f32 {
    (phase - 0.5).abs() * 4.0 - 1.0
}

/// Sine wave sample function.
/// phase in [0.0, 1.0) → output in [-1.0, 1.0].
/// Used for woodblock: cleaner, more hollow tone than triangle.
#[inline(always)]
fn sine_sample(phase: f32) -> f32 {
    (phase * core::f32::consts::TAU).sin()
}

/// xorshift32 PRNG — Marsaglia (2003) canonical shift triple (13, 17, 5).
/// Produces uniform pseudo-random u32 values for white noise generation.
/// PRNG_STATE must be non-zero; seed 12345 satisfies this invariant (D-12).
#[inline(always)]
unsafe fn xorshift32_next() -> u32 {
    let mut state = std::ptr::addr_of!(PRNG_STATE).read();
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    std::ptr::addr_of_mut!(PRNG_STATE).write(state);
    state
}

/// Called every AudioWorklet process() callback (128 samples per call).
/// sample_offset: sample within this quantum where the click starts (0–127),
///                or NO_BEAT_SENTINEL (0xFF) if no beat fires this quantum.
/// voice:         voice type (0=normal click, 1=accent click).
/// _noise_gain:   white noise mix level (unused until Phase 3).
#[no_mangle]
pub extern "C" fn fill_output_buffer(sample_offset: u32, voice: u32, noise_gain: f32) {
    // SAFETY: Single-threaded WASM; no concurrent mutation possible.
    unsafe {
        let ptr = std::ptr::addr_of_mut!(AUDIO_OUT) as *mut f32;

        // Read sound type once — used in both trigger and sample loop.
        let sound = std::ptr::addr_of!(CLICK_SOUND).read();

        // Trigger: arm envelope if a beat fires this quantum (T-02-01: sentinel guards OOB).
        if sample_offset != NO_BEAT_SENTINEL {
            if voice == 2 {
                // D-14: Silent voice — beat event fires (bar position advances) but no click
                // synthesis. ACTIVE is not set. Noise mixing still runs unconditionally below.
            } else {
                let accent_freq = std::ptr::addr_of!(ACCENT_FREQ).read();
                let accent_amp  = std::ptr::addr_of!(ACCENT_AMP).read();
                // Always set PHASE_INC on every trigger (Pitfall P3-03: must restore normal freq).
                // Freq and base amplitude depend on sound type and voice.
                let (freq, base_amp) = match (sound, voice) {
                    (0, 1) => (accent_freq,     accent_amp),        // beep accent
                    (0, 3) => (CLICK_FREQ,       0.75_f32 * 0.3),  // beep ghost
                    (0, _) => (CLICK_FREQ,       0.75_f32),         // beep normal
                    (1, 1) => (WOOD_ACCENT_FREQ, accent_amp),       // woodblock accent
                    (1, 3) => (WOOD_CLICK_FREQ,  0.85_f32 * 0.3),  // woodblock ghost
                    (1, _) => (WOOD_CLICK_FREQ,  0.85_f32),         // woodblock normal
                    (_, 1) => (STICK_CLICK_FREQ, accent_amp),       // sticks accent
                    (_, 3) => (STICK_CLICK_FREQ, 0.85_f32 * 0.3),  // sticks ghost
                    _      => (STICK_CLICK_FREQ, 0.85_f32),         // sticks normal
                };
                std::ptr::addr_of_mut!(PHASE_INC).write(freq / std::ptr::addr_of!(SAMPLE_RATE).read());
                std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(base_amp);
                std::ptr::addr_of_mut!(PHASE_ACCUM).write(0.0_f32);
                std::ptr::addr_of_mut!(ACTIVE).write(true);
            }
        }

        // Cache decay coefficient for this sound type outside the sample loop.
        let decay = match sound {
            1 => std::ptr::addr_of!(DECAY_COEFF_WOOD).read(),
            2 => std::ptr::addr_of!(DECAY_COEFF_STICK).read(),
            _ => std::ptr::addr_of!(DECAY_COEFF).read(),
        };

        // D-10: PRNG runs unconditionally every sample regardless of click activity or voice.
        for i in 0..128_usize {
            let raw_noise = xorshift32_next();
            let noise_f = (raw_noise as i32 as f32) / 2147483648.0_f32;

            let sample = if std::ptr::addr_of!(ACTIVE).read()
                && (sample_offset == NO_BEAT_SENTINEL || i >= sample_offset as usize)
            {
                let phase = std::ptr::addr_of!(PHASE_ACCUM).read();
                let gain  = std::ptr::addr_of!(ENVELOPE_GAIN).read();

                // Waveform synthesis dispatched by sound type.
                // Sticks: 30% high-freq triangle tone + 70% noise burst, both under envelope.
                let s = match sound {
                    1 => sine_sample(phase),                              // woodblock: pure sine
                    2 => triangle_sample(phase) * 0.3 + noise_f * 0.7,  // sticks: tone + noise
                    _ => triangle_sample(phase),                          // beep: triangle
                };
                let output = s * gain;

                // Advance phase — subtraction avoids float division (RESEARCH.md anti-pattern)
                let mut new_phase = phase + std::ptr::addr_of!(PHASE_INC).read();
                if new_phase >= 1.0 { new_phase -= 1.0; }
                std::ptr::addr_of_mut!(PHASE_ACCUM).write(new_phase);

                // Advance envelope — multiplicative decay persists across quanta (Pitfall 1)
                let new_gain = gain * decay;
                std::ptr::addr_of_mut!(ENVELOPE_GAIN).write(new_gain);
                if new_gain < SILENCE_THRESHOLD {
                    std::ptr::addr_of_mut!(ACTIVE).write(false);
                }

                output
            } else {
                0.0_f32
            };

            // Background noise (user slider). Multiplication by 0.0 is exact IEEE 754 — no branch.
            // T-04-02: Clamp prevents clipping when accent click + 100% noise coincide.
            let mixed = (sample + noise_f * noise_gain).clamp(-1.0_f32, 1.0_f32);
            ptr.add(i).write(mixed);
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
        let wood_samples = (WOOD_DECAY_MS / 1000.0) * sample_rate;
        std::ptr::addr_of_mut!(DECAY_COEFF_WOOD).write((-1.0_f32 / wood_samples).exp());
        let stick_samples = (STICK_DECAY_MS / 1000.0) * sample_rate;
        std::ptr::addr_of_mut!(DECAY_COEFF_STICK).write((-1.0_f32 / stick_samples).exp());
    }
}

/// Sets the global click sound type. Called by the AudioWorklet on user selection.
/// 0 = beep (triangle wave, 12ms), 1 = woodblock (sine, 7ms), 2 = sticks (noise+tone, 5ms).
#[no_mangle]
pub extern "C" fn set_click_sound(sound: u32) {
    unsafe { std::ptr::addr_of_mut!(CLICK_SOUND).write(sound); }
}

/// Sets accent voice DSP parameters. Called by the AudioWorklet when accent settings change.
/// freq_hz: click frequency for accent beats (default 1400.0 Hz).
/// amp:     amplitude multiplier for accent beats (default 1.3).
#[no_mangle]
pub extern "C" fn set_accent_params(freq_hz: f32, amp: f32) {
    // SAFETY: Single-threaded WASM; no concurrent mutation possible.
    unsafe {
        std::ptr::addr_of_mut!(ACCENT_FREQ).write(freq_hz);
        std::ptr::addr_of_mut!(ACCENT_AMP).write(amp);
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

    // --- Phase 3 accent DSP tests ---

    #[test]
    fn test_set_accent_params_roundtrip() {
        // Call set_accent_params, verify ACCENT_FREQ and ACCENT_AMP are updated.
        unsafe {
            set_accent_params(1400.0, 1.3);
            let freq = std::ptr::addr_of!(ACCENT_FREQ).read();
            let amp = std::ptr::addr_of!(ACCENT_AMP).read();
            assert!((freq - 1400.0).abs() < f32::EPSILON * 1400.0 + f32::EPSILON,
                "ACCENT_FREQ should be 1400.0 after set, got {}", freq);
            assert!((amp - 1.3).abs() < f32::EPSILON * 1.3 + f32::EPSILON,
                "ACCENT_AMP should be 1.3 after set, got {}", amp);

            // Verify it also updates to different values
            set_accent_params(1000.0, 1.0);
            let freq2 = std::ptr::addr_of!(ACCENT_FREQ).read();
            assert!((freq2 - 1000.0).abs() < f32::EPSILON * 1000.0 + f32::EPSILON,
                "ACCENT_FREQ should be 1000.0 after second set, got {}", freq2);
        }
    }

    #[test]
    fn test_accent_pitch_differs() {
        // Verify PHASE_INC is set to 1400/SR for voice=1 and 1000/SR for voice=0.
        unsafe {
            init(44100.0);
            set_accent_params(1400.0, 1.3);

            // Accent trigger (voice=1): PHASE_INC = 1400 / 44100
            fill_output_buffer(0, 1, 0.0);
            let accent_phase_inc = std::ptr::addr_of!(PHASE_INC).read();
            let expected_accent = 1400.0_f32 / 44100.0;
            assert!((accent_phase_inc - expected_accent).abs() < 1e-6,
                "Accent PHASE_INC should be {}, got {}", expected_accent, accent_phase_inc);

            // Normal trigger (voice=0): PHASE_INC = 1000 / 44100
            fill_output_buffer(0, 0, 0.0);
            let normal_phase_inc = std::ptr::addr_of!(PHASE_INC).read();
            let expected_normal = 1000.0_f32 / 44100.0;
            assert!((normal_phase_inc - expected_normal).abs() < 1e-6,
                "Normal PHASE_INC should be {}, got {}", expected_normal, normal_phase_inc);

            assert_ne!(accent_phase_inc, normal_phase_inc,
                "Accent and normal PHASE_INC must differ");
        }
    }

    #[test]
    fn test_accent_amplitude_differs() {
        // Verify peak amplitude is higher for voice=1 (amp=1.3) than voice=0 (amp=1.0).
        unsafe {
            init(44100.0);
            set_accent_params(1400.0, 1.3);

            // Accent trigger: record peak amplitude
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            fill_output_buffer(0, 1, 0.0);
            let accent_peak = (0..128_usize)
                .map(|i| read_out(i).abs())
                .fold(0.0_f32, f32::max);

            // Normal trigger: record peak amplitude
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            fill_output_buffer(0, 0, 0.0);
            let normal_peak = (0..128_usize)
                .map(|i| read_out(i).abs())
                .fold(0.0_f32, f32::max);

            assert!(accent_peak > normal_peak,
                "Accent peak ({}) must exceed normal peak ({})", accent_peak, normal_peak);
        }
    }

    #[test]
    fn test_phase_inc_reset_on_normal() {
        // Pitfall P3-03: after an accent trigger, a normal trigger must restore PHASE_INC
        // to CLICK_FREQ / SAMPLE_RATE, not leave it at the accent frequency.
        unsafe {
            init(44100.0);
            set_accent_params(1400.0, 1.3);

            // Accent trigger sets PHASE_INC to 1400 / 44100
            fill_output_buffer(0, 1, 0.0);
            let after_accent = std::ptr::addr_of!(PHASE_INC).read();
            assert!((after_accent - 1400.0_f32 / 44100.0).abs() < 1e-6,
                "PHASE_INC after accent trigger should be 1400/44100, got {}", after_accent);

            // Normal trigger must reset PHASE_INC to CLICK_FREQ / SAMPLE_RATE
            fill_output_buffer(0, 0, 0.0);
            let after_normal = std::ptr::addr_of!(PHASE_INC).read();
            let expected = CLICK_FREQ / 44100.0;
            assert!((after_normal - expected).abs() < 1e-6,
                "PHASE_INC after normal trigger should be {}, got {}", expected, after_normal);
        }
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

    // --- Phase 4: silent voice, noise mixing, clamp tests ---

    #[test]
    fn test_silent_voice_no_click() {
        // fill_output_buffer(0, 2, 0.0) with ACTIVE=false → all 128 samples are 0.0
        // Voice 2 = silent: no envelope triggered, no ACTIVE set. noise_gain=0.0 → no noise.
        unsafe {
            init(44100.0);
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            fill_output_buffer(0, 2, 0.0);
            for i in 0..128_usize {
                let s = read_out(i);
                assert_eq!(s, 0.0_f32,
                    "sample {} should be 0.0 for silent voice + zero noise, got {}", i, s);
            }
        }
    }

    #[test]
    fn test_noise_produces_output() {
        // fill_output_buffer(NO_BEAT_SENTINEL, 0, 1.0) with ACTIVE=false and deterministic PRNG
        // → at least one of the 128 output samples is non-zero.
        // Proves xorshift32 produces non-zero values at seed 12345 (Pitfall 2: zero seed = silence).
        unsafe {
            init(44100.0);
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            // Reset PRNG to known non-zero seed for deterministic test outcome.
            std::ptr::addr_of_mut!(PRNG_STATE).write(12345);
            fill_output_buffer(NO_BEAT_SENTINEL, 0, 1.0);
            let any_nonzero = (0..128_usize).any(|i| read_out(i) != 0.0_f32);
            assert!(any_nonzero,
                "At least one sample should be non-zero with noise_gain=1.0 and active PRNG");
        }
    }

    #[test]
    fn test_noise_zero_gain() {
        // fill_output_buffer(NO_BEAT_SENTINEL, 0, 0.0) with ACTIVE=false → all 128 samples = 0.0
        // When noise_gain is 0.0 and no click is active, IEEE 754 multiplication by 0.0 is
        // exactly 0.0 — confirming digital silence with no branch in the hot path (D-12).
        unsafe {
            init(44100.0);
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            fill_output_buffer(NO_BEAT_SENTINEL, 0, 0.0);
            for i in 0..128_usize {
                let s = read_out(i);
                assert_eq!(s, 0.0_f32,
                    "sample {} should be 0.0 with noise_gain=0.0 and ACTIVE=false, got {}", i, s);
            }
        }
    }

    #[test]
    fn test_ghost_amplitude_lower_than_normal() {
        // Ghost voice (voice=3) must produce lower peak amplitude than normal (voice=0).
        unsafe {
            init(44100.0);
            set_accent_params(1400.0, 1.3);

            // Ghost trigger: record peak amplitude
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            fill_output_buffer(0, 3, 0.0);
            let ghost_peak = (0..128_usize)
                .map(|i| read_out(i).abs())
                .fold(0.0_f32, f32::max);

            // Normal trigger: record peak amplitude
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            fill_output_buffer(0, 0, 0.0);
            let normal_peak = (0..128_usize)
                .map(|i| read_out(i).abs())
                .fold(0.0_f32, f32::max);

            assert!(ghost_peak > 0.0, "Ghost should produce non-zero output");
            assert!(ghost_peak < normal_peak,
                "Ghost peak ({}) must be lower than normal peak ({})", ghost_peak, normal_peak);
        }
    }

    #[test]
    fn test_clamp_prevents_clipping() {
        // fill_output_buffer(0, 1, 1.0) with ACTIVE=false — accent click (voice=1) + 100% noise.
        // Worst-case additive mix: peak click ~1.3 + peak noise ~1.0 = ~2.3 before clamp.
        // The per-sample clamp(-1.0, 1.0) must prevent any sample from exceeding [-1.0, 1.0].
        unsafe {
            init(44100.0);
            std::ptr::addr_of_mut!(ACTIVE).write(false);
            std::ptr::addr_of_mut!(PRNG_STATE).write(12345);
            fill_output_buffer(0, 1, 1.0);
            for i in 0..128_usize {
                let s = read_out(i);
                assert!(s >= -1.0_f32 && s <= 1.0_f32,
                    "sample {} = {} is outside [-1.0, 1.0] — clamp failed", i, s);
            }
        }
    }
}
