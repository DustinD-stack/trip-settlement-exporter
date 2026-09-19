import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * GitHub Pages project sites are served from https://<user>.github.io/<repo>/,
 * so every asset URL needs that `/<repo>/` prefix. The deploy workflow sets
 * BASE_PATH to the repository name; local dev and user/organisation pages use
 * "/". Nothing else in the app hardcodes a path - the PDF template is fetched
 * through `import.meta.env.BASE_URL`.
 */
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    // The scanned settlement template lives in public/ and is copied as-is.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Keep the two large libraries in their own chunks, so a change to the
        // app does not make everyone re-download them.
        manualChunks: {
          pdflib: ['pdf-lib'],
          sheetjs: ['xlsx'],
        },
      },
    },
  },
  test: {
    // The library suites are plain Node; the UI smoke test opts into jsdom
    // with a docblock at the top of the file.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Building a real two-page settlement takes a couple of seconds.
    testTimeout: 60_000,
  },
})
