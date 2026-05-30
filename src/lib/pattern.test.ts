import { describe, it, expect } from 'vitest'
import {
  computeStepInterval,
  rebuildBeats,
  defaultPatternState,
  SUBDIV_MULT,
} from './pattern.js'

// ---------------------------------------------------------------------------
// computeStepInterval
// Formula: (60.0 / bpm) * (4 / denominator) / subdivMult
// ---------------------------------------------------------------------------

describe('computeStepInterval', () => {
  it('4/4 quarter at 120 BPM = 0.5 s', () => {
    expect(computeStepInterval(120, 4, SUBDIV_MULT['quarter'])).toBeCloseTo(0.5)
  })

  it('4/4 eighth at 120 BPM = 0.25 s', () => {
    expect(computeStepInterval(120, 4, SUBDIV_MULT['eighth'])).toBeCloseTo(0.25)
  })

  it('4/4 triplet at 120 BPM ≈ 0.16667 s', () => {
    expect(computeStepInterval(120, 4, SUBDIV_MULT['triplet'])).toBeCloseTo(0.16667, 4)
  })

  it('4/4 sixteenth at 120 BPM = 0.125 s', () => {
    expect(computeStepInterval(120, 4, SUBDIV_MULT['sixteenth'])).toBeCloseTo(0.125)
  })

  it('6/8 eighth at 120 BPM = 0.25 s', () => {
    // denominator=8 → (60/120)*(4/8)/1 = 0.5*0.5 = 0.25
    expect(computeStepInterval(120, 8, 1)).toBeCloseTo(0.25)
  })

  it('3/4 quarter at 100 BPM = 0.6 s', () => {
    // (60/100)*(4/4)/1 = 0.6
    expect(computeStepInterval(100, 4, 1)).toBeCloseTo(0.6)
  })

  it('7/8 eighth at 100 BPM = 0.3 s', () => {
    // (60/100)*(4/8)/1 = 0.6*0.5 = 0.3
    expect(computeStepInterval(100, 8, 1)).toBeCloseTo(0.3)
  })

  it('20 BPM 4/4 quarter = 3.0 s (slow extreme)', () => {
    expect(computeStepInterval(20, 4, 1)).toBeCloseTo(3.0)
  })

  it('300 BPM 4/4 quarter = 0.2 s (fast extreme)', () => {
    expect(computeStepInterval(300, 4, 1)).toBeCloseTo(0.2)
  })
})

// ---------------------------------------------------------------------------
// rebuildBeats
// ---------------------------------------------------------------------------

describe('rebuildBeats', () => {
  it('returns array of correct length', () => {
    expect(rebuildBeats(4).length).toBe(4)
  })

  it('all beats are normal (voice=0) by default', () => {
    expect(rebuildBeats(4)[0].voice).toBe(0)
  })

  it('remaining beats are normal (voice=0)', () => {
    const beats = rebuildBeats(4)
    expect(beats[1].voice).toBe(0)
    expect(beats[2].voice).toBe(0)
    expect(beats[3].voice).toBe(0)
  })

  it('single step: [0].voice === 0', () => {
    expect(rebuildBeats(1)[0].voice).toBe(0)
  })

  it('12 steps: length 12, all voice === 0', () => {
    const beats = rebuildBeats(12)
    expect(beats.length).toBe(12)
    for (let i = 0; i < 12; i++) {
      expect(beats[i].voice).toBe(0)
    }
  })

  describe('with existingBeats', () => {
    it('grow 4→8: preserves existing voices and fills new positions with 0', () => {
      const existing = [{ voice: 1 }, { voice: 2 }, { voice: 0 }, { voice: 0 }]
      const result = rebuildBeats(8, existing)
      expect(result.length).toBe(8)
      expect(result[0].voice).toBe(1)
      expect(result[1].voice).toBe(2)
      expect(result[2].voice).toBe(0)
      expect(result[3].voice).toBe(0)
      expect(result[4].voice).toBe(0)
      expect(result[7].voice).toBe(0)
    })

    it('shrink 8→2: truncates from the right', () => {
      const existing = [
        { voice: 1 }, { voice: 2 }, { voice: 0 }, { voice: 0 },
        { voice: 1 }, { voice: 0 }, { voice: 0 }, { voice: 1 },
      ]
      const result = rebuildBeats(2, existing)
      expect(result.length).toBe(2)
      expect(result[0].voice).toBe(1)
      expect(result[1].voice).toBe(2)
    })

    it('same size: copies all voice assignments unchanged', () => {
      const existing = [{ voice: 1 }, { voice: 2 }, { voice: 0 }, { voice: 0 }]
      const result = rebuildBeats(4, existing)
      expect(result.length).toBe(4)
      expect(result[0].voice).toBe(1)
      expect(result[1].voice).toBe(2)
      expect(result[2].voice).toBe(0)
      expect(result[3].voice).toBe(0)
    })

    it('fresh init (no existingBeats) returns all-normal beats', () => {
      const result = rebuildBeats(4)
      expect(result[0].voice).toBe(0)
      expect(result[1].voice).toBe(0)
      expect(result[3].voice).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// defaultPatternState
// ---------------------------------------------------------------------------

describe('defaultPatternState', () => {
  it('bpm is 120', () => {
    expect(defaultPatternState().bpm).toBe(120)
  })

  it('tracks contains exactly one track', () => {
    expect(defaultPatternState().tracks.length).toBe(1)
  })

  it('first track has stepCount 4', () => {
    expect(defaultPatternState().tracks[0].stepCount).toBe(4)
  })

  it('first track subdivision is quarter', () => {
    expect(defaultPatternState().tracks[0].subdivision).toBe('quarter')
  })

  it('first track denominator is 4', () => {
    expect(defaultPatternState().tracks[0].denominator).toBe(4)
  })

  it('first beat is normal (voice=0)', () => {
    expect(defaultPatternState().tracks[0].beats[0].voice).toBe(0)
  })

  it('second beat is normal (voice=0)', () => {
    expect(defaultPatternState().tracks[0].beats[1].voice).toBe(0)
  })

  it('accentFreqHz is 1400', () => {
    expect(defaultPatternState().accentFreqHz).toBe(1400)
  })

  it('accentAmpMillis is 1300', () => {
    expect(defaultPatternState().accentAmpMillis).toBe(1300)
  })
})
