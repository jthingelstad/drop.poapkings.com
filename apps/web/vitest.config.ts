import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/vite-env.d.ts',
        // Vaulted modes (GAMES.md "Vaulted for launch"): retained for
        // re-release, unrouted, so no test exercises them.
        'src/modes/blitz/**',
        'src/modes/cost-sweep/**',
        'src/modes/endless-ladder/**',
        'src/modes/identify/**',
        'src/modes/ladder/**'
      ],
      thresholds: {
        statements: 30,
        branches: 20,
        functions: 25,
        lines: 30
      }
    },
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/'
      }
    }
  }
})
