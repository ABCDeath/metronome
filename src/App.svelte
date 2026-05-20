<script lang="ts">
  import { AudioEngine } from './lib/audio-engine.js'
  import type { PatternState, Subdivision } from './lib/pattern.js'
  import { SUBDIV_MULT, rebuildBeats, defaultPatternState } from './lib/pattern.js'

  // AudioEngine instance created at component init — does NOT create AudioContext.
  // AudioContext is only created inside engine.start() on user gesture (D-12).
  let engineState = $state<'stopped' | 'running'>('stopped')

  const engine = new AudioEngine((state) => {
    engineState = state
  })

  // PatternState: full timing + accent state, drives engine via $effect (D-06).
  let pattern = $state<PatternState>(defaultPatternState())

  // numerator tracked separately for the number input (time sig numerator 1–12).
  let numerator = $state(4)

  // Accent toggle state (D-02, D-03): both default on.
  let accentPitchOn = $state(true)
  let accentAmpOn = $state(true)
  let accentAmpValue = $state(1.3)

  // $effect: re-runs whenever any field of pattern changes — drives engine.updatePattern() (D-06).
  $effect(() => {
    engine.updatePattern(pattern)
  })

  // $effect: recomputes accent params whenever toggles or amp value change.
  $effect(() => {
    updateAccentParams()
  })

  async function handlePlayStop() {
    if (engine.state === 'stopped') {
      // This click handler IS the user gesture — AudioContext is created inside start() (D-12).
      await engine.start()
      // P3-04 safety: write accent params after SAB is initialized.
      engine.updatePattern(pattern)
    } else {
      await engine.stop()
    }
  }

  // --- BPM helpers ---

  function adjustBpm(delta: number) {
    pattern.bpm = Math.max(20, Math.min(300, pattern.bpm + delta))
  }

  function onBpmInput(e: Event) {
    const input = e.target as HTMLInputElement
    const val = parseInt(input.value, 10)
    if (!isNaN(val)) {
      pattern.bpm = Math.max(20, Math.min(300, val))
    }
    // Revert display to actual pattern.bpm (covers out-of-range or non-numeric).
    input.value = String(pattern.bpm)
  }

  function onBpmSlider(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10)
    if (!isNaN(val)) {
      pattern.bpm = val // range input is already clamped by min/max attributes
    }
  }

  // --- Time signature helpers ---

  function onTimeSigChange() {
    const subdivMult = SUBDIV_MULT[pattern.tracks[0].subdivision]
    const stepCount = numerator * subdivMult
    pattern.tracks[0].stepCount = stepCount
    pattern.tracks[0].beats = rebuildBeats(stepCount)
  }

  function onNumeratorInput(e: Event) {
    const input = e.target as HTMLInputElement
    const val = parseInt(input.value, 10)
    if (!isNaN(val)) {
      numerator = Math.max(1, Math.min(12, val))
    }
    input.value = String(numerator)
    onTimeSigChange()
  }

  function onDenominatorChange(e: Event) {
    const val = parseInt((e.target as HTMLSelectElement).value, 10)
    if (!isNaN(val)) {
      pattern.tracks[0].denominator = val
    }
    onTimeSigChange()
  }

  function onSubdivisionChange(subdiv: Subdivision) {
    pattern.tracks[0].subdivision = subdiv
    const stepCount = numerator * SUBDIV_MULT[subdiv]
    pattern.tracks[0].stepCount = stepCount
    pattern.tracks[0].beats = rebuildBeats(stepCount)
  }

  // --- Accent helpers ---

  function updateAccentParams() {
    // D-02: 1400 Hz when pitch toggle on, 1000 Hz (normal click freq) when off.
    pattern.accentFreqHz = accentPitchOn ? 1400 : 1000
    // D-03: accentAmpValue * 1000 when amp toggle on, 1000 (1.0×) when off.
    pattern.accentAmpMillis = accentAmpOn ? Math.round(accentAmpValue * 1000) : 1000
  }
</script>

<main>
  <h1>Metronome</h1>
  <button id="play-btn" type="button" onclick={handlePlayStop}>
    {engineState === 'running' ? 'Stop' : 'Play'}
  </button>
  <p class="status">Status: {engineState}</p>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: 1rem;
    font-family: system-ui, sans-serif;
  }

  h1 {
    font-size: 2rem;
    margin: 0;
  }

  #play-btn {
    font-size: 1.25rem;
    padding: 0.75rem 2rem;
    cursor: pointer;
    border-radius: 6px;
    border: 2px solid #333;
    background: #fff;
  }

  #play-btn:hover {
    background: #f0f0f0;
  }

  .status {
    color: #666;
    font-size: 0.9rem;
  }
</style>
