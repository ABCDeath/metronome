import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const COOP_COEP_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    target: 'es2020',
  },
  server: {
    headers: COOP_COEP_HEADERS,
  },
  preview: {
    headers: COOP_COEP_HEADERS,
  },
})
