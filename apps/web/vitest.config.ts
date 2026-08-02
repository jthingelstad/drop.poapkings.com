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
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      // Current actuals are ~81% stmts / 79% br / 81% fn / 83% ln. Keep a few
      // points of headroom so unrelated changes aren't blocked by minor drift;
      // ratchet these up as coverage grows.
      thresholds: {
        statements: 78,
        branches: 73,
        functions: 74,
        lines: 80
      }
    },
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/'
      }
    }
  }
})
