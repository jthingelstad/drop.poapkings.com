import { expect, test } from './fixtures'

// The one-time named-release notice (components/ReleaseNotice.tsx). The rules
// that matter to a player are all about when it does NOT appear.
const NOTICE = '[data-testid="release-notice"]'
const OLDER_RELEASE = 'ancient-arrows'

test('a first-time visitor is recorded and never interrupted', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator(NOTICE)).toHaveCount(0)
  // The current release is recorded, so the next visit is quiet too.
  expect(await page.evaluate(() => localStorage.getItem('elixirdrop:releaseSeen'))).not.toBe(null)
  await page.waitForLoadState('networkidle')
  await page.reload()
  await expect(page.locator(NOTICE)).toHaveCount(0)
  await page.waitForLoadState('networkidle')
})

test('a newer release is announced once, opens the history, and stays dismissed', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate((id) => localStorage.setItem('elixirdrop:releaseSeen', id), OLDER_RELEASE)
  await page.reload()

  const notice = page.locator(NOTICE)
  await expect(notice).toBeVisible()
  await expect(notice.locator('[role="dialog"]')).toHaveAttribute('aria-modal', 'true')

  await notice.getByRole('link', { name: /See what/ }).click()
  await expect(page).toHaveURL(/\/releases\/$/)
  await expect(page.getByRole('heading', { name: 'Elixir Drop Releases' })).toBeVisible()
  await expect(page.locator('.static-section')).not.toHaveCount(0)

  await page.waitForLoadState('networkidle')
  await page.goto('/')
  await expect(page.locator(NOTICE)).toHaveCount(0)
  await page.reload()
  await expect(page.locator(NOTICE)).toHaveCount(0)
  await page.waitForLoadState('networkidle')
})

test('Escape dismisses the notice for good', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate((id) => localStorage.setItem('elixirdrop:releaseSeen', id), OLDER_RELEASE)
  await page.reload()
  await expect(page.locator(NOTICE)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator(NOTICE)).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  await page.reload()
  await expect(page.locator(NOTICE)).toHaveCount(0)
  await page.waitForLoadState('networkidle')
})

test('the notice never interrupts a game, and waits until play is over', async ({ page }) => {
  // Seed before the first load so the app boots straight onto a game route with
  // an unseen release pending. Reloading *into* a lazily-chunked game route
  // instead would abort the module fetch and log a console error.
  await page.addInitScript((id) => localStorage.setItem('elixirdrop:releaseSeen', id), OLDER_RELEASE)
  await page.goto('/#/surge')
  await expect(page.locator('.ed-game')).toBeVisible()
  await expect(page.locator(NOTICE)).toHaveCount(0)

  await page.waitForLoadState('networkidle')
  await page.goto('/#/profile')
  await expect(page.locator(NOTICE)).toBeVisible()
  await page.waitForLoadState('networkidle')
})
