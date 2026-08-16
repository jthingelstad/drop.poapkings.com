import AxeBuilder from '@axe-core/playwright'
import { expect, isDesktopViewport, test } from './fixtures'

const a11yRoutes = [
  { hash: '#/', label: 'Home', ready: '.ed-home, .ed-home-d' },
  { hash: '#/practice', label: 'Practice', ready: '.practice-hub, .ed-home' },
  { hash: '#/practice/costs', label: 'Cost Recall', ready: '.ed-game' },
  { hash: '#/practice/ledger', label: 'Ledger', ready: '.ed-game' },
  { hash: '#/surge', label: 'Surge', ready: '.ed-game' },
  { hash: '#/higher-lower', label: 'Higher / Lower', ready: '.ed-game' },
  { hash: '#/trade', label: 'Trade', ready: '.ed-game' },
  { hash: '#/survival', label: 'Survival', ready: '.ed-game' },
  { hash: '#/rain', label: 'Rain', ready: '.ed-game' },
  { hash: '#/leaderboards', label: 'Leaderboards', ready: '.ed-board' },
  { hash: '#/players/player-2', label: 'Public player', ready: '.ed-public-profile' },
  { hash: '#/profile', label: 'Profile', ready: '.ed-profile' },
  { hash: '#/settings', label: 'Settings', ready: '.settings__card' }
]

for (const route of a11yRoutes) {
  test(`renders ${route.label} without serious accessibility issues`, async ({ page, viewport }, testInfo) => {
    await page.goto('/')
    await page.goto(`/${route.hash}`)
    await expect(page.locator(route.ready).first()).toBeVisible({ timeout: 12_000 })
    if (route.label === 'Practice') {
      await expect(page.getByRole('main')).toHaveCount(1)
      if (isDesktopViewport(viewport)) await expect(page.locator('.practice-hub')).toBeVisible()
      else {
        await expect(page).toHaveURL(/#\/$/)
        await expect(page.locator('.ed-practice-options')).toBeVisible()
      }
    }

    const screenshot = await page.screenshot({ fullPage: true })
    await testInfo.attach(`${route.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.png`, {
      body: screenshot,
      contentType: 'image/png'
    })

    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    expect(serious).toEqual([])
  })
}

for (const slug of [
  'games',
  'learn-elixir-costs',
  'elixir-costs',
  'badges',
  'discord',
  'install',
  'fair-play',
  'about',
  'faq',
  'privacy',
  'releases'
]) {
  test(`renders standalone ${slug} without serious accessibility issues`, async ({ page }) => {
    await page.goto(`/${slug}/`)
    await expect(page.locator('.static-main')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    expect(serious).toEqual([])
  })
}

// The release notice is the app's only modal dialog, so it never appears on a
// route walk above (a first visit records the release and shows nothing).
test('renders the release notice without serious accessibility issues', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('elixirdrop:releaseSeen', 'ancient-arrows'))
  await page.reload()
  await expect(page.locator('[data-testid="release-notice"]')).toBeVisible()

  await testInfo.attach('release-notice.png', { body: await page.screenshot(), contentType: 'image/png' })

  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
  expect(serious).toEqual([])
})
