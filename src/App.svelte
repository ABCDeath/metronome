<script lang="ts">
  let status = 'not started'
</script>

<main>
  <h1>Metronome</h1>
  <button id="play-btn" type="button">Play</button>
  <p class="status">Status: {status}</p>
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
