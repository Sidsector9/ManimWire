import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Vite's dev client pings the server from a SharedWorker built from a blob when the
// connection drops, which the page's policy blocks. Widened while serving only, so
// the shipped app keeps the strict policy.
const devWorkerPolicy: Plugin = {
  name: 'mnw-dev-worker-policy',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("default-src 'self';", "default-src 'self'; worker-src 'self' blob:;")
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    plugins: [react(), devWorkerPolicy]
  }
})
