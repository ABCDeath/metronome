import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// Startup assertion: SharedArrayBuffer is required for the ring buffer (D-10, D-11).
// If COOP/COEP headers are missing, SharedArrayBuffer is undefined — the app cannot function.
if (typeof SharedArrayBuffer === 'undefined') {
  const errorMsg =
    'SharedArrayBuffer is not available. ' +
    'The server must send Cross-Origin-Opener-Policy: same-origin and ' +
    'Cross-Origin-Embedder-Policy: require-corp headers. ' +
    'Check vite.config.ts server.headers and ensure the dev server is running.'

  document.getElementById('app')!.innerHTML =
    `<div style="color:red;padding:1rem;font-family:monospace">${errorMsg}</div>`
  throw new Error(errorMsg)
}

// Log cross-origin isolation status to console for verification.
// crossOriginIsolated === true means COOP/COEP headers are correctly set and
// SharedArrayBuffer + Atomics are available. Verify this in DevTools console.
console.info('[metronome] crossOriginIsolated:', (self as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated)

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
