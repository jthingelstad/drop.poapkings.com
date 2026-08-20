import { defineConfig, devices } from '@playwright/test'

const deploymentGate = process.env.PLAYWRIGHT_DEPLOY_GATE === '1'
const deploymentSmoke = deploymentGate ? { grep: /@deploy/ } : {}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Tests are independent (each one mocks the API on its own page), so run them
  // in parallel within a file as well as across files.
  fullyParallel: true,
  // Half the cores locally; a fixed two on CI, where the runner also hosts the
  // Vite dev server and over-subscribing browsers reads back as flake.
  workers: process.env.CI ? 2 : '50%',
  // One retry on CI absorbs genuine infrastructure blips (and is what makes the
  // `on-first-retry` trace below actually get recorded); locally a failure
  // should fail immediately.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI
  },
  // Only the projects a script actually runs live here: `npm test` uses
  // chromium + iphone-14, `npm run verify` adds firefox + webkit. The former
  // pixel-7 / ipad-portrait / ipad-landscape entries were referenced by no
  // script or workflow, so they never ran — carrying them just invited someone
  // to triple the deploy gate's runtime by accident.
  // Desktop projects use their normal mouse/keyboard input model. Ranked modes
  // intentionally run on desktop now; the iPhone project preserves touch QA.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, ...deploymentSmoke },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, ...deploymentSmoke },
    { name: 'iphone-14', use: { ...devices['iPhone 14'] }, ...deploymentSmoke }
  ]
})
