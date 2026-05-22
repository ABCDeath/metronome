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

  // numerator tracked separately for the number input (time sig numerator 1–32).
  let numerator = $state(4)

  // Click sound selector: 0=Beep, 1=Woodblock, 2=Sticks.
  let clickSound = $state(0)

  function onClickSoundChange(sound: number) {
    clickSound = sound
    engine.setClickSound(sound)
  }

  // Noise level state (0–100 integer, maps to 0–1000 millis for setNoiseGain).
  let noiseLevel = $state(0)

  // Subdivisions per beat — drives 2D grid layout.
  const subdivPerBeat = $derived(SUBDIV_MULT[pattern.tracks[0].subdivision] ?? 1)

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

  function handleKeydown(e: KeyboardEvent) {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault()
      handlePlayStop()
    }
  }

  async function handlePlayStop() {
    if (engine.state === 'stopped') {
      // This click handler IS the user gesture — AudioContext is created inside start() (D-12).
      await engine.start()
      // P3-04 safety: write accent params after SAB is initialized.
      engine.updatePattern(pattern)
      // Replay noise slider value — SAB is now ready (audio-engine also replays _pendingNoiseGainMillis).
      engine.setNoiseGain(Math.round(noiseLevel * 0.25))
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
    pattern.tracks[0].beats = rebuildBeats(stepCount, pattern.tracks[0].beats)
  }

  function onNumeratorInput(e: Event) {
    const input = e.target as HTMLInputElement
    const val = parseInt(input.value, 10)
    if (!isNaN(val)) {
      numerator = Math.max(1, Math.min(32, val))
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
    pattern.tracks[0].beats = rebuildBeats(stepCount, pattern.tracks[0].beats)
  }

  // --- Accent helpers ---

  function updateAccentParams() {
    // D-02: 1400 Hz when pitch toggle on, 1000 Hz (normal click freq) when off.
    pattern.accentFreqHz = accentPitchOn ? 1400 : 1000
    // D-03: accentAmpValue * 1000 when amp toggle on, 1000 (1.0×) when off.
    pattern.accentAmpMillis = accentAmpOn ? Math.round(accentAmpValue * 1000) : 1000
  }

  // --- Beat grid helpers ---

  function cycleBeatVoice(i: number) {
    // Cycle voice 0 (Normal) → 1 (Accent) → 2 (Silent) → 3 (Ghost) → 0.
    // Direct property mutation on Svelte 5 $state proxy triggers $effect → engine.updatePattern().
    pattern.tracks[0].beats[i].voice = (pattern.tracks[0].beats[i].voice + 1) % 4
  }

  // --- Noise helpers ---

  function onNoiseInput(e: Event) {
    noiseLevel = parseInt((e.target as HTMLInputElement).value, 10)
    engine.setNoiseGain(Math.round(noiseLevel * 0.25))
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main>
  <h1>Metronome</h1>
  <button id="play-btn" type="button" onclick={handlePlayStop}>
    {engineState === 'running' ? 'Stop' : 'Play'}
  </button>
  <p class="status">Status: {engineState}</p>

  <div class="controls-container">

    <!-- BPM Section -->
    <div class="section">
      <h2>BPM</h2>
      <div class="row">
        <input
          type="range"
          class="bpm-slider"
          min="20"
          max="300"
          step="1"
          value={pattern.bpm}
          oninput={onBpmSlider}
        />
        <input
          type="text"
          class="bpm-input"
          value={pattern.bpm}
          onblur={onBpmInput}
          onkeydown={(e) => { if (e.key === 'Enter') onBpmInput(e) }}
        />
        <div class="step-buttons">
          <button type="button" class="step-btn" onclick={() => adjustBpm(-10)}>-10</button>
          <button type="button" class="step-btn" onclick={() => adjustBpm(-5)}>-5</button>
          <button type="button" class="step-btn" onclick={() => adjustBpm(-1)}>-1</button>
          <button type="button" class="step-btn" onclick={() => adjustBpm(1)}>+1</button>
          <button type="button" class="step-btn" onclick={() => adjustBpm(5)}>+5</button>
          <button type="button" class="step-btn" onclick={() => adjustBpm(10)}>+10</button>
        </div>
      </div>
    </div>

    <!-- Time Signature Section -->
    <div class="section">
      <h2>Time</h2>
      <div class="row">
        <input
          type="number"
          class="num-input"
          min="1"
          max="32"
          step="1"
          value={numerator}
          onchange={onNumeratorInput}
          onblur={onNumeratorInput}
        />
        <span class="sep">/</span>
        <select
          class="denom-select"
          value={pattern.tracks[0].denominator}
          onchange={onDenominatorChange}
        >
          <option value={2}>2</option>
          <option value={4}>4</option>
          <option value={8}>8</option>
          <option value={16}>16</option>
        </select>
      </div>
    </div>

    <!-- Subdivision Section -->
    <div class="section">
      <h2>Subdivision</h2>
      <div class="subdiv-group" role="group">
        {#each ([
          { value: 'quarter',   label: 'Quarter'  },
          { value: 'eighth',    label: '8th'       },
          { value: 'triplet',   label: 'Triplet'   },
          { value: 'sixteenth', label: '16th'      },
        ] as const) as opt}
          <button
            type="button"
            class="subdiv-option {pattern.tracks[0].subdivision === opt.value ? 'selected' : ''}"
            onclick={() => onSubdivisionChange(opt.value as Subdivision)}
          >{opt.label}</button>
        {/each}
      </div>
    </div>

    <!-- Sound Section -->
    <div class="section">
      <h2>Sound</h2>
      <div class="subdiv-group" role="group">
        {#each ([
          { value: 0, label: 'Beep' },
          { value: 1, label: 'Woodblock' },
          { value: 2, label: 'Sticks' },
        ] as const) as opt}
          <button
            type="button"
            class="subdiv-option {clickSound === opt.value ? 'selected' : ''}"
            onclick={() => onClickSoundChange(opt.value)}
          >{opt.label}</button>
        {/each}
      </div>
    </div>

    <!-- Pattern Section -->
    <div class="section">
      <h2>Pattern</h2>
      {#if subdivPerBeat === 1}
        <!-- Single-row layout for quarter notes -->
        <div class="beat-grid" role="group" aria-label="Beat pattern">
          {#each pattern.tracks[0].beats as beat, i}
            {@const voiceLabel = beat.voice === 1 ? 'A' : beat.voice === 2 ? '\u2014' : beat.voice === 3 ? 'G' : 'N'}
            {@const voiceState = beat.voice === 1 ? 'Accent' : beat.voice === 2 ? 'Silent' : beat.voice === 3 ? 'Ghost' : 'Normal'}
            {@const voiceClass = beat.voice === 1 ? 'beat-cell-accent' : beat.voice === 2 ? 'beat-cell-silent' : beat.voice === 3 ? 'beat-cell-ghost' : 'beat-cell-normal'}
            <button
              type="button"
              class="beat-cell {voiceClass}"
              onclick={() => cycleBeatVoice(i)}
              aria-label="Beat {i + 1}: {voiceState}"
            >{voiceLabel}</button>
          {/each}
        </div>
      {:else}
        <!-- 2D grid layout: columns = beats, rows = subdivisions per beat -->
        <div
          class="beat-grid-2d"
          role="group"
          aria-label="Beat pattern"
          style="grid-template-columns: repeat({numerator}, auto)"
        >
          {#each Array.from({length: subdivPerBeat}, (_, r) => r) as row}
            {#each Array.from({length: numerator}, (_, c) => c) as col}
              {@const i = col * subdivPerBeat + row}
              {@const beat = pattern.tracks[0].beats[i]}
              {@const voiceLabel = beat.voice === 1 ? 'A' : beat.voice === 2 ? '\u2014' : beat.voice === 3 ? 'G' : 'N'}
              {@const voiceState = beat.voice === 1 ? 'Accent' : beat.voice === 2 ? 'Silent' : beat.voice === 3 ? 'Ghost' : 'Normal'}
              {@const voiceClass = beat.voice === 1 ? 'beat-cell-accent' : beat.voice === 2 ? 'beat-cell-silent' : beat.voice === 3 ? 'beat-cell-ghost' : 'beat-cell-normal'}
              <button
                type="button"
                class="beat-cell {voiceClass}"
                onclick={() => cycleBeatVoice(i)}
                aria-label="Beat {col + 1} sub {row + 1}: {voiceState}"
              >{voiceLabel}</button>
            {/each}
          {/each}
        </div>
      {/if}
    </div>

    <!-- Accent Section -->
    <div class="section">
      <h2>Accent</h2>
      <!-- Row 1: Pitch toggle -->
      <div class="accent-row">
        <span class="accent-label">Pitch (1400 Hz)</span>
        <input
          type="checkbox"
          class="toggle"
          checked={accentPitchOn}
          onchange={() => { accentPitchOn = !accentPitchOn }}
        />
      </div>
      <!-- Row 2: Amplitude slider + value + toggle -->
      <div class="accent-row" style="margin-top: 16px;">
        <span class="accent-label">Amplitude</span>
        <input
          type="range"
          class="amp-slider {accentAmpOn ? '' : 'disabled'}"
          min="1.0"
          max="1.5"
          step="0.1"
          value={accentAmpValue}
          disabled={!accentAmpOn}
          oninput={(e) => { accentAmpValue = parseFloat((e.target as HTMLInputElement).value) }}
        />
        <span class="amp-value">{accentAmpValue.toFixed(1)}x</span>
        <input
          type="checkbox"
          class="toggle"
          checked={accentAmpOn}
          onchange={() => { accentAmpOn = !accentAmpOn }}
        />
      </div>
    </div>

    <!-- Noise Section -->
    <div class="section">
      <h2>Noise</h2>
      <div class="row">
        <input
          type="range"
          class="noise-slider"
          min="0"
          max="100"
          step="1"
          value={noiseLevel}
          oninput={onNoiseInput}
        />
        <span class="noise-value">{noiseLevel}%</span>
      </div>
    </div>

  </div>
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
    min-height: 44px;
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

  /* Controls container */
  .controls-container {
    max-width: 480px;
    width: 100%;
    padding: 0 16px;
  }

  /* Section */
  .section {
    margin-bottom: 24px;
  }

  .section h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 8px;
  }

  /* Row layout */
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  /* BPM controls */
  .bpm-slider {
    flex-grow: 1;
  }

  .bpm-input {
    width: 64px;
    text-align: center;
    font-size: 16px;
    border: 2px solid #ccc;
    border-radius: 4px;
    padding: 4px;
  }

  .bpm-input:focus {
    border-color: #333;
    outline: none;
  }

  .step-buttons {
    display: flex;
    gap: 4px;
  }

  .step-btn {
    min-height: 44px;
    padding: 8px 16px;
    border: 2px solid #333;
    border-radius: 6px;
    background: #f0f0f0;
    cursor: pointer;
    font-size: 16px;
  }

  .step-btn:hover {
    background: #e0e0e0;
  }

  .step-btn:active {
    background: #333;
    color: #fff;
  }

  /* Time signature */
  .num-input {
    width: 52px;
    text-align: center;
    font-size: 16px;
    border: 2px solid #ccc;
    border-radius: 4px;
    padding: 4px;
  }

  .num-input:focus {
    border-color: #333;
    outline: none;
  }

  .sep {
    margin: 0 8px;
    color: #333;
    font-size: 16px;
  }

  .denom-select {
    width: 72px;
    font-size: 16px;
    border: 2px solid #ccc;
    border-radius: 4px;
    padding: 4px;
  }

  .denom-select:focus {
    border-color: #333;
    outline: none;
  }

  /* Subdivision picker */
  .subdiv-group {
    display: flex;
    border: 2px solid #333;
    border-radius: 6px;
    overflow: hidden;
  }

  .subdiv-option {
    min-height: 44px;
    padding: 8px 16px;
    border: none;
    border-right: 1px solid #333;
    background: #fff;
    color: #333;
    cursor: pointer;
    font-size: 16px;
    flex: 1;
  }

  .subdiv-option:last-child {
    border-right: none;
  }

  .subdiv-option.selected {
    background: #333;
    color: #fff;
  }

  .subdiv-option:hover:not(.selected) {
    background: #f0f0f0;
  }

  /* Accent panel */
  .accent-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .accent-label {
    font-size: 14px;
    min-width: 120px;
  }

  .amp-slider {
    width: 120px;
  }

  .amp-slider.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .amp-value {
    width: 36px;
    font-size: 14px;
    text-align: right;
  }

  /* Toggle (checkbox styled as pill) */
  .toggle {
    appearance: none;
    -webkit-appearance: none;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: #ccc;
    cursor: pointer;
    position: relative;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .toggle:checked {
    background: #333;
  }

  .toggle::after {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    top: 2px;
    left: 2px;
    transition: left 0.2s;
  }

  .toggle:checked::after {
    left: 18px;
  }

  /* Beat grid — single row (quarter notes) */
  .beat-grid {
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
    overflow-x: auto;
  }

  /* Beat grid — 2D layout (subdivisions): columns = beats, rows = subdivisions */
  .beat-grid-2d {
    display: grid;
    width: fit-content;
    row-gap: 4px;
    column-gap: 10px;
    overflow-x: auto;
  }

  .beat-cell {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: 2px solid #333333;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    color: #333333;
  }

  .beat-cell-normal {
    background: #ffffff;
    color: #333333;
    border-color: #333333;
  }

  .beat-cell-normal:hover {
    background: #f0f0f0;
  }

  .beat-cell-accent {
    background: #333333;
    color: #ffffff;
    border-color: #333333;
  }

  .beat-cell-accent:hover {
    background: #555555;
  }

  .beat-cell-silent {
    background: #f0f0f0;
    color: #999999;
    border-color: #cccccc;
  }

  .beat-cell-silent:hover {
    background: #e0e0e0;
    border-color: #aaaaaa;
  }

  .beat-cell-ghost {
    background: #ffffff;
    color: #aaaaaa;
    border-color: #aaaaaa;
    border-style: dashed;
  }

  .beat-cell-ghost:hover {
    background: #f5f5f5;
    border-color: #888888;
  }

  /* Noise slider */
  .noise-slider {
    flex-grow: 1;
  }

  .noise-value {
    width: 36px;
    font-size: 14px;
    text-align: right;
  }
</style>
