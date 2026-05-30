<script lang="ts">
  import { AudioEngine } from './lib/audio-engine.js'
  import type { BarType } from './lib/audio-engine.js'
  import type { PatternState, Subdivision } from './lib/pattern.js'
  import { SUBDIV_MULT, rebuildBeats, defaultPatternState } from './lib/pattern.js'

  // AudioEngine instance created at component init — does NOT create AudioContext.
  // AudioContext is only created inside engine.start() on user gesture (D-12).
  let engineState = $state<'stopped' | 'running'>('stopped')
  let currentStep = $state(-1)
  let accentOpen = $state(false)
  let theme = $state<'light' | 'dark' | 'system'>('system')

  // Training mode state — declared BEFORE engine construction (Pitfall 6: closure timing)
  let trainingEnabled = $state(false)
  let normalBarCount = $state(2)
  let altBarCount = $state(2)
  let altType = $state<'silent' | 'skips'>('silent')
  let skipsPattern = $state<PatternState>(defaultPatternState())
  let currentBarType = $state<BarType>('normal')
  let currentBarIndex = $state(0)

  const engine = new AudioEngine(
    (state) => { engineState = state },
    (type, barIndex) => { currentBarType = type; currentBarIndex = barIndex },
    (step) => { currentStep = step }
  )

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

  // Subdivisions per beat for the skips pattern grid.
  const skipsSubdivPerBeat = $derived(SUBDIV_MULT[skipsPattern.tracks[0].subdivision] ?? 1)

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

  // $effect: sync theme with document data-theme attribute.
  $effect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
  })

  // $effect: sync training mode enable/disable with engine.
  $effect(() => { engine.setTrainingMode(trainingEnabled) })

  // $effect: sync training cycle config with engine.
  $effect(() => { engine.setTrainingConfig(normalBarCount, altBarCount, altType) })

  // $effect: sync skips beat pattern with engine.
  $effect(() => { engine.setAltBeats(skipsPattern.tracks[0].beats) })

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
    // Keep skipsPattern in sync with time sig changes (Pitfall 4: step count drift)
    skipsPattern.tracks[0].stepCount = stepCount
    skipsPattern.tracks[0].beats = rebuildBeats(stepCount, skipsPattern.tracks[0].beats)
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
      skipsPattern.tracks[0].denominator = val
    }
    onTimeSigChange()
  }

  function onSubdivisionChange(subdiv: Subdivision) {
    pattern.tracks[0].subdivision = subdiv
    const stepCount = numerator * SUBDIV_MULT[subdiv]
    pattern.tracks[0].stepCount = stepCount
    pattern.tracks[0].beats = rebuildBeats(stepCount, pattern.tracks[0].beats)
    // Keep skipsPattern in sync with subdivision changes (Pitfall 4: step count drift)
    skipsPattern.tracks[0].subdivision = subdiv
    skipsPattern.tracks[0].stepCount = stepCount
    skipsPattern.tracks[0].beats = rebuildBeats(stepCount, skipsPattern.tracks[0].beats)
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

  // --- Training mode helpers ---

  function onNormalBarCountInput(e: Event) {
    const input = e.target as HTMLInputElement
    const val = parseInt(input.value, 10)
    if (!isNaN(val)) {
      normalBarCount = Math.max(1, Math.min(32, val))
    }
    input.value = String(normalBarCount)
  }

  function onAltBarCountInput(e: Event) {
    const input = e.target as HTMLInputElement
    const val = parseInt(input.value, 10)
    if (!isNaN(val)) {
      altBarCount = Math.max(1, Math.min(32, val))
    }
    input.value = String(altBarCount)
  }

  function onAltTypeChange(type: 'silent' | 'skips') {
    altType = type
  }

  function cycleSkipsBeatVoice(i: number) {
    // Same voice cycle as cycleBeatVoice but mutates skipsPattern independently.
    skipsPattern.tracks[0].beats[i].voice = (skipsPattern.tracks[0].beats[i].voice + 1) % 4
  }

  // --- Theme helpers ---

  function cycleTheme() {
    const order = ['system', 'light', 'dark'] as const
    theme = order[(order.indexOf(theme) + 1) % 3]
  }

  // --- Noise helpers ---

  function onNoiseInput(e: Event) {
    noiseLevel = parseInt((e.target as HTMLInputElement).value, 10)
    engine.setNoiseGain(Math.round(noiseLevel * 0.25))
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main>
  <div class="app-header">
    <h1>Metronome</h1>
    <button type="button" class="theme-btn" onclick={cycleTheme} title="Switch theme: {theme}">
      {theme === 'light' ? '◯' : theme === 'dark' ? '●' : '◑'}
    </button>
  </div>
  <button id="play-btn" class={engineState === 'running' ? 'playing' : ''} type="button" onclick={handlePlayStop}>
    {engineState === 'running' ? 'Stop' : 'Play'}
  </button>

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
      {#if engineState === 'running'}
        <div class="beat-indicator" aria-hidden="true">
          {#each Array.from({length: numerator}, (_, i) => i) as i}
            {@const isActive = currentStep >= 0 && Math.floor(currentStep / subdivPerBeat) === i}
            <span class="beat-dot {isActive ? 'beat-dot-active' : ''}"></span>
          {/each}
        </div>
      {/if}
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

    <!-- Training Section -->
    <div class="section">
      <div class="section-header">
        <h2>Training</h2>
        <input
          type="checkbox"
          class="toggle"
          checked={trainingEnabled}
          onchange={() => trainingEnabled = !trainingEnabled}
        />
      </div>

      {#if trainingEnabled}
        <!-- Bar count inputs row -->
        <div class="row" style="margin-top: 12px;">
          <label>
            Normal bars
            <input
              type="number"
              class="num-input"
              min="1"
              max="32"
              value={normalBarCount}
              oninput={onNormalBarCountInput}
            />
          </label>
          <label>
            Alt bars
            <input
              type="number"
              class="num-input"
              min="1"
              max="32"
              value={altBarCount}
              oninput={onAltBarCountInput}
            />
          </label>
        </div>

        <!-- Alt type selector -->
        <div class="subdiv-group" role="group" style="margin-top: 12px;">
          <button
            type="button"
            class="subdiv-option {altType === 'silent' ? 'selected' : ''}"
            onclick={() => onAltTypeChange('silent')}
          >Silent</button>
          <button
            type="button"
            class="subdiv-option {altType === 'skips' ? 'selected' : ''}"
            onclick={() => onAltTypeChange('skips')}
          >Skips</button>
        </div>

        {#if altType === 'skips'}
          <div style="margin-top: 12px;">
            <p style="margin: 0 0 8px; font-size: 14px; color: var(--fg-dim);">Skips pattern</p>
            {#if engineState === 'running'}
              <div class="beat-indicator" aria-hidden="true">
                {#each Array.from({length: numerator}, (_, i) => i) as i}
                  {@const isActive = currentStep >= 0 && Math.floor(currentStep / skipsSubdivPerBeat) === i}
                  <span class="beat-dot {isActive ? 'beat-dot-active' : ''}"></span>
                {/each}
              </div>
            {/if}
            {#if skipsSubdivPerBeat === 1}
              <!-- Single-row layout for quarter notes -->
              <div class="beat-grid" role="group" aria-label="Skips beat pattern">
                {#each skipsPattern.tracks[0].beats as beat, i}
                  {@const voiceLabel = beat.voice === 1 ? 'A' : beat.voice === 2 ? '\u2014' : beat.voice === 3 ? 'G' : 'N'}
                  {@const voiceState = beat.voice === 1 ? 'Accent' : beat.voice === 2 ? 'Silent' : beat.voice === 3 ? 'Ghost' : 'Normal'}
                  {@const voiceClass = beat.voice === 1 ? 'beat-cell-accent' : beat.voice === 2 ? 'beat-cell-silent' : beat.voice === 3 ? 'beat-cell-ghost' : 'beat-cell-normal'}
                  <button
                    type="button"
                    class="beat-cell {voiceClass}"
                    onclick={() => cycleSkipsBeatVoice(i)}
                    aria-label="Skips beat {i + 1}: {voiceState}"
                  >{voiceLabel}</button>
                {/each}
              </div>
            {:else}
              <!-- 2D grid layout: columns = beats, rows = subdivisions per beat -->
              <div
                class="beat-grid-2d"
                role="group"
                aria-label="Skips beat pattern"
                style="grid-template-columns: repeat({numerator}, auto)"
              >
                {#each Array.from({length: skipsSubdivPerBeat}, (_, r) => r) as row}
                  {#each Array.from({length: numerator}, (_, c) => c) as col}
                    {@const i = col * skipsSubdivPerBeat + row}
                    {@const beat = skipsPattern.tracks[0].beats[i]}
                    {@const voiceLabel = beat.voice === 1 ? 'A' : beat.voice === 2 ? '\u2014' : beat.voice === 3 ? 'G' : 'N'}
                    {@const voiceState = beat.voice === 1 ? 'Accent' : beat.voice === 2 ? 'Silent' : beat.voice === 3 ? 'Ghost' : 'Normal'}
                    {@const voiceClass = beat.voice === 1 ? 'beat-cell-accent' : beat.voice === 2 ? 'beat-cell-silent' : beat.voice === 3 ? 'beat-cell-ghost' : 'beat-cell-normal'}
                    <button
                      type="button"
                      class="beat-cell {voiceClass}"
                      onclick={() => cycleSkipsBeatVoice(i)}
                      aria-label="Skips beat {col + 1} sub {row + 1}: {voiceState}"
                    >{voiceLabel}</button>
                  {/each}
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if engineState === 'running'}
          <div class="cycle-strip">
            {#each Array.from({length: normalBarCount + altBarCount}, (_, i) => i) as i}
              {@const label = i < normalBarCount ? 'N' : (altType === 'skips' ? 'K' : 'S')}
              {@const isActive = (currentBarIndex % (normalBarCount + altBarCount)) === i}
              <span class="cycle-block {isActive ? 'cycle-block-active' : ''}">{label}</span>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <!-- Accent Section -->
    <div class="section">
      <div class="section-header">
        <h2>Accent</h2>
        <button type="button" class="collapse-btn" onclick={() => accentOpen = !accentOpen}>
          {accentOpen ? '▲' : '▼'}
        </button>
      </div>
      {#if accentOpen}
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
      {/if}
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
    background: var(--bg);
    color: var(--fg);
  }

  /* App header: title + theme button */
  .app-header {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h1 {
    font-size: 2rem;
    margin: 0;
  }

  .theme-btn {
    background: none;
    border: 2px solid var(--border-light);
    border-radius: 50%;
    width: 32px;
    height: 32px;
    cursor: pointer;
    font-size: 14px;
    color: var(--fg-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: border-color 0.2s;
  }

  .theme-btn:hover {
    border-color: var(--border);
    color: var(--fg);
  }

  /* Play/Stop button */
  #play-btn {
    font-size: 1.25rem;
    padding: 0.75rem 2rem;
    min-height: 44px;
    cursor: pointer;
    border-radius: 6px;
    border: 2px solid var(--border);
    background: var(--play-bg);
    color: var(--play-fg);
    transition: background 0.15s, color 0.15s;
  }

  #play-btn:hover:not(.playing) {
    background: var(--hover-bg);
  }

  #play-btn.playing {
    background: var(--play-active-bg);
    color: var(--play-active-fg);
    border-color: var(--play-active-bg);
  }

  #play-btn.playing:hover {
    opacity: 0.85;
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

  /* Section header row (title + inline control) */
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .section-header h2 {
    margin: 0;
  }

  .collapse-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    color: var(--fg-dim);
    padding: 4px 8px;
  }

  .collapse-btn:hover {
    color: var(--fg);
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
    border: 2px solid var(--border-light);
    border-radius: 4px;
    padding: 4px;
    background: var(--bg);
    color: var(--fg);
  }

  .bpm-input:focus {
    border-color: var(--border);
    outline: none;
  }

  .step-buttons {
    display: flex;
    gap: 4px;
  }

  .step-btn {
    min-height: 44px;
    padding: 8px 16px;
    border: 2px solid var(--border);
    border-radius: 6px;
    background: var(--hover-bg);
    color: var(--fg);
    cursor: pointer;
    font-size: 16px;
  }

  .step-btn:hover {
    background: var(--hover-bg2);
  }

  .step-btn:active {
    background: var(--border);
    color: var(--bg);
  }

  /* Time signature */
  .num-input {
    width: 52px;
    text-align: center;
    font-size: 16px;
    border: 2px solid var(--border-light);
    border-radius: 4px;
    padding: 4px;
    background: var(--bg);
    color: var(--fg);
  }

  .num-input:focus {
    border-color: var(--border);
    outline: none;
  }

  .sep {
    margin: 0 8px;
    color: var(--fg);
    font-size: 16px;
  }

  .denom-select {
    width: 72px;
    font-size: 16px;
    border: 2px solid var(--border-light);
    border-radius: 4px;
    padding: 4px;
    background: var(--bg);
    color: var(--fg);
  }

  .denom-select:focus {
    border-color: var(--border);
    outline: none;
  }

  /* Subdivision picker */
  .subdiv-group {
    display: flex;
    border: 2px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .subdiv-option {
    min-height: 44px;
    padding: 8px 16px;
    border: none;
    border-right: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
    font-size: 16px;
    flex: 1;
  }

  .subdiv-option:last-child {
    border-right: none;
  }

  .subdiv-option.selected {
    background: var(--border);
    color: var(--bg);
  }

  .subdiv-option:hover:not(.selected) {
    background: var(--hover-bg);
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
    background: var(--inactive-bg);
    cursor: pointer;
    position: relative;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .toggle:checked {
    background: var(--border);
  }

  .toggle::after {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--bg);
    top: 2px;
    left: 2px;
    transition: left 0.2s;
  }

  .toggle:checked::after {
    left: 18px;
  }

  /* Beat indicator row */
  .beat-indicator {
    display: flex;
    gap: 4px;
    margin-bottom: 6px;
  }

  .beat-dot {
    min-width: 44px;
    height: 6px;
    border-radius: 3px;
    background: var(--border-light);
    transition: background 0.08s;
  }

  .beat-dot-active {
    background: var(--border);
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
    border: 2px solid var(--border);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--fg);
  }

  .beat-cell-normal {
    background: var(--bg);
    color: var(--fg);
    border-color: var(--border);
  }

  .beat-cell-normal:hover {
    background: var(--hover-bg);
  }

  .beat-cell-accent {
    background: var(--border);
    color: var(--bg);
    border-color: var(--border);
  }

  .beat-cell-accent:hover {
    background: var(--accent-hover);
  }

  .beat-cell-silent {
    background: var(--silent-bg);
    color: var(--silent-fg);
    border-color: var(--border-light);
  }

  .beat-cell-silent:hover {
    background: var(--hover-bg2);
    border-color: var(--ghost-border-hover);
  }

  .beat-cell-ghost {
    background: var(--bg);
    color: var(--ghost-fg);
    border-color: var(--ghost-fg);
    border-style: dashed;
  }

  .beat-cell-ghost:hover {
    background: var(--ghost-hover-bg);
    border-color: var(--ghost-border-hover);
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

  /* Training mode cycle-strip */
  .cycle-strip {
    display: flex;
    gap: 4px;
    margin-top: 12px;
    flex-wrap: wrap;
  }

  .cycle-block {
    min-width: 32px;
    min-height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--border-light);
    border-radius: 4px;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg-dim);
  }

  .cycle-block-active {
    background: var(--border);
    color: var(--bg);
    border-color: var(--border);
  }
</style>
