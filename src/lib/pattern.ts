// Phase 3: PatternState type contracts and pure utility functions.
// All functions are pure (no side effects, no DOM/Web Audio dependencies).
// Consumed by Plans 02, 03, and 04 in this phase.

export type Subdivision = 'quarter' | 'eighth' | 'triplet' | 'sixteenth';

export type BeatPosition = {
  voice: number; // 0 = normal beat, 1 = accent
};

export type Track = {
  stepCount: number;
  subdivision: Subdivision;
  denominator: number; // time signature denominator (4 = quarter note, 8 = eighth note)
  beats: BeatPosition[];
};

export type PatternState = {
  bpm: number;
  tracks: Track[];
  accentFreqHz: number;   // accent click pitch in Hz (D-05)
  accentAmpMillis: number; // accent amplitude multiplier × 1000 (integer for Atomics.store)
};

// SUBDIV_MULT maps each subdivision label to its beat divisor.
// quarter=1 beat, eighth=2 subdivisions/beat, triplet=3, sixteenth=4.
export const SUBDIV_MULT: Record<Subdivision, number> = {
  quarter: 1,
  eighth: 2,
  triplet: 3,
  sixteenth: 4,
};

/**
 * Compute the interval in seconds between consecutive steps.
 *
 * Formula (D-08): (60.0 / bpm) * (4 / denominator) / subdivMult
 *
 * Examples at 120 BPM, denominator=4:
 *   quarter   (subdivMult=1): 0.500 s
 *   eighth    (subdivMult=2): 0.250 s
 *   triplet   (subdivMult=3): 0.1667 s
 *   sixteenth (subdivMult=4): 0.125 s
 */
export function computeStepInterval(
  bpm: number,
  denominator: number,
  subdivMult: number,
): number {
  return (60.0 / bpm) * (4 / denominator) / subdivMult;
}

/**
 * Build a beats array of length stepCount.
 *
 * Without existingBeats: returns Phase 3 default — step 0 is the downbeat
 * (voice=1), all others are normal (voice=0).
 *
 * With existingBeats: merges existing voice assignments into the new length.
 * Positions within existingBeats.length copy the existing voice; positions
 * beyond existingBeats.length fill with Normal (voice=0). When stepCount is
 * less than existingBeats.length, Array.from implicitly truncates from the
 * right. The input existingBeats array is never mutated.
 */
export function rebuildBeats(stepCount: number, existingBeats?: BeatPosition[]): BeatPosition[] {
  if (!existingBeats) {
    return Array.from({ length: stepCount }, (_, i) => ({ voice: i === 0 ? 1 : 0 }));
  }
  return Array.from({ length: stepCount }, (_, i) => ({
    voice: i < existingBeats.length ? existingBeats[i].voice : 0,
  }));
}

/**
 * Return the canonical default PatternState for the app.
 * 120 BPM, 4/4, quarter-note subdivision, accent at 1400 Hz / amp 1.3.
 */
export function defaultPatternState(): PatternState {
  return {
    bpm: 120,
    tracks: [
      {
        stepCount: 4,
        subdivision: 'quarter',
        denominator: 4,
        beats: [{ voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 0 }],
      },
    ],
    accentFreqHz: 1400,
    accentAmpMillis: 1300, // 1.3 × 1000 (integer representation for Atomics)
  };
}
