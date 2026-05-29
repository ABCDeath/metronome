import { describe, it, expect } from 'vitest'
import { computeBarType } from './audio-engine.js'

// ---------------------------------------------------------------------------
// computeBarType
// Formula: cyclePos = barCount % (normalBars + altBars)
//          return cyclePos < normalBars ? 'normal' : altType
// ---------------------------------------------------------------------------

describe('computeBarType', () => {
  // --- 2 normal + 2 silent cycle ---

  it('2+2 silent: barCount=0 returns normal', () => {
    expect(computeBarType(0, 2, 2, 'silent')).toBe('normal')
  })

  it('2+2 silent: barCount=1 returns normal', () => {
    expect(computeBarType(1, 2, 2, 'silent')).toBe('normal')
  })

  it('2+2 silent: barCount=2 returns silent', () => {
    expect(computeBarType(2, 2, 2, 'silent')).toBe('silent')
  })

  it('2+2 silent: barCount=3 returns silent', () => {
    expect(computeBarType(3, 2, 2, 'silent')).toBe('silent')
  })

  // --- cycle wrap ---

  it('2+2 silent: barCount=4 returns normal (cycle wraps)', () => {
    expect(computeBarType(4, 2, 2, 'silent')).toBe('normal')
  })

  it('2+2 silent: barCount=5 returns normal (cycle wraps, position 1)', () => {
    expect(computeBarType(5, 2, 2, 'silent')).toBe('normal')
  })

  // --- 1 normal + 1 skips (alternating) ---

  it('1+1 skips: barCount=0 returns normal', () => {
    expect(computeBarType(0, 1, 1, 'skips')).toBe('normal')
  })

  it('1+1 skips: barCount=1 returns skips', () => {
    expect(computeBarType(1, 1, 1, 'skips')).toBe('skips')
  })

  it('1+1 skips: barCount=2 returns normal (cycle wraps)', () => {
    expect(computeBarType(2, 1, 1, 'skips')).toBe('normal')
  })

  it('1+1 skips: barCount=3 returns skips (cycle wraps)', () => {
    expect(computeBarType(3, 1, 1, 'skips')).toBe('skips')
  })

  // --- large barCount values ---

  it('large barCount: barCount=100, normalBars=3, altBars=2 => normal (100 % 5 = 0 < 3)', () => {
    expect(computeBarType(100, 3, 2, 'silent')).toBe('normal')
  })

  it('large barCount: barCount=103, normalBars=3, altBars=2 => silent (103 % 5 = 3, >= 3)', () => {
    expect(computeBarType(103, 3, 2, 'silent')).toBe('silent')
  })

  // --- single normal bar + multiple alt bars ---

  it('1 normal + 3 silent: barCount=0 returns normal', () => {
    expect(computeBarType(0, 1, 3, 'silent')).toBe('normal')
  })

  it('1 normal + 3 silent: barCount=1 returns silent', () => {
    expect(computeBarType(1, 1, 3, 'silent')).toBe('silent')
  })

  it('1 normal + 3 silent: barCount=3 returns silent', () => {
    expect(computeBarType(3, 1, 3, 'silent')).toBe('silent')
  })

  // --- multiple normal bars + single alt bar ---

  it('4 normal + 1 skips: barCount=3 returns normal', () => {
    expect(computeBarType(3, 4, 1, 'skips')).toBe('normal')
  })

  it('4 normal + 1 skips: barCount=4 returns skips', () => {
    expect(computeBarType(4, 4, 1, 'skips')).toBe('skips')
  })

  it('4 normal + 1 skips: barCount=5 returns normal (cycle wraps)', () => {
    expect(computeBarType(5, 4, 1, 'skips')).toBe('normal')
  })
})
