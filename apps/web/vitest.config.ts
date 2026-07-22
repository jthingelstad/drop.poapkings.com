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
      // Floor locked in after the coverage pass (actuals ~56% stmts / 53% br /
      // 57% fn / 57% ln). A few points of headroom so unrelated changes aren't
      // blocked by minor drift; ratchet these up as coverage grows.
      thresholds: {
        statements: 52,
        branches: 48,
        functions: 52,
        lines: 53
      }
    },
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/'
      }
    }
  }
})
