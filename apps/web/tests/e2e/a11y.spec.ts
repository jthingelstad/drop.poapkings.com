import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

const a11yRoutes = [
  { hash: '#/', label: 'Home', ready: '.ed-home' },
  { hash: '#/practice', label: 'Practice active play', ready: '.ed-game' },
  { hash: '#/surge', label: 'Surge', ready: '.ed-game' },
  { hash: '#/higher-lower', label: 'Higher / Lower', ready: '.ed-game' },
  { hash: '#/trade', label: 'Trade', ready: '.ed-game' },
  { hash: '#/survival', label: 'Survival', ready: '.ed-game' },
  { hash: '#/rain', label: 'Rain', ready: '.ed-game' },
  { hash: '#/leaderboards', label: 'Leaderboards', ready: '.ed-board' },
  { hash: '#/players/player-2', label: 'Public player', ready: '.ed-public-profile' },
  { hash: '#/profile', label: 'Profile', ready: '.ed-you' },
  { hash: '#/settings', label: 'Settings', ready: '.ed-you' },
  // A shared link is the one route a stranger reaches first, with no account and
  // often no prior visit — so it has to pass the same bar as the app itself.
  { hash: '#/r/SHRBBB', label: 'Shared run', ready: '.ed-sharedrun' }
]

for (const route of a11yRoutes) {
  test(`renders ${route.label} without serious accessibility issues`, async ({ page }, testInfo) => {
    await page.goto('/')
    await page.goto(`/${route.hash}`)
    await expect(page.locator(route.ready).first()).toBeVisible({ timeout: 12_000 })
    if (route.hash === '#/practice') {
      await expect(page.getByRole('main')).toHaveCount(1)
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

test('the signed-out You page exposes one page heading', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('elixirdrop:session:v1'))
  await page.goto('/#/profile')

  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'You' })).toHaveCount(1)
})

for (const slug of [
  'games',
  'xp',
  'learn-elixir-costs',
  'elixir-costs',
  'badges',
  'discord',
  'install',
  'fair-play',
  'about',
  'faq',
  'privacy',
  'updates'
]) {
  test(`renders standalone ${slug} without serious accessibility issues`, async ({ page }) => {
    await page.goto(`/${slug}/`)
    await expect(page.locator('.static-main')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
    expect(serious).toEqual([])
  })
}
