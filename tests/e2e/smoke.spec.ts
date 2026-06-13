import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const routes = [
  { hash: '#/', label: 'Elixir Drop', ready: '.home' },
  { hash: '#/practice', label: 'Practice', ready: '.pcard' },
  { hash: '#/surge', label: 'Surge', ready: '.surge-ready' },
  { hash: '#/higher-lower', label: 'Higher / Lower', ready: '.hl' },
  { hash: '#/blitz', label: 'Blitz', ready: '.surge-ready' },
  { hash: '#/survival', label: 'Survival', ready: '.surge-ready' },
  { hash: '#/focus', label: 'Focus', ready: '.home' },
  { hash: '#/deck-budget', label: 'Deck Budget', ready: '.budget' },
  { hash: '#/settings', label: 'Settings', ready: '.settings__card' }
]

const pageErrors = new WeakMap<Page, string[]>()
const allowBlockedAssets = new WeakSet<Page>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error' && !(allowBlockedAssets.has(page) && text.includes('net::ERR_FAILED'))) {
      errors.push(text)
    }
  })
  page.on('pageerror', (err) => errors.push(err.message))
  await page.route('https://tinylytics.app/embed/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: 'window.tinylytics = { triggerUpdate() {} };'
    })
  )
  await page.addInitScript(() => {
    Math.random = () => 0.42
  })
})

test.afterEach(async ({ page }) => {
  const errors = pageErrors.get(page) ?? []
  await page.close()
  expect(errors).toEqual([])
})

for (const route of routes) {
  test(`renders ${route.label} without serious accessibility issues`, async ({ page }, testInfo) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/${route.hash}`)
    await expect(page.locator(route.ready)).toBeVisible()
    await expect(page.locator('.site-head__name')).toHaveText('Elixir Drop')

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

test('card art fallback renders when the Clash Royale CDN is blocked', async ({ page }) => {
  allowBlockedAssets.add(page)
  await page.route('https://api-assets.clashroyale.com/**', (route) => route.abort())
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/#/practice')
  await expect(page.locator('.pcard__fallback')).toBeVisible()
})

test('deck budget does not reveal per-card elixir costs', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/#/deck-budget')
  await expect(page.locator('.budget')).toBeVisible()
  await expect(page.locator('.budget-cell__cost')).toHaveCount(0)

  const labels = await page
    .locator('.budget-cell')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('aria-label') ?? ''))
  expect(labels.every((label) => !/\b(?:1|2|3|4|5|6|7|8|9|10)\s+elixir\b/i.test(label))).toBe(true)

  const cells = page.locator('.budget-cell')
  for (let i = 0; i < 8; i += 1) {
    await cells.nth(i).click()
  }
  await page.getByRole('button', { name: 'Score this deck' }).click()
  await expect(page.locator('.budget-result')).toBeVisible()
  await expect(page.locator('.budget-result__deck .summary-chip__cost')).toHaveCount(0)
})

test('settings persist input and motion preferences across reload', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/#/settings')
  await page.getByRole('button', { name: '4 choices' }).click()
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await page.reload()

  await expect(page.getByRole('button', { name: '4 choices' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)
})
