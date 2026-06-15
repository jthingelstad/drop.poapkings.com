import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { CardsData } from '../../src/types'

const cardsData = JSON.parse(readFileSync(new URL('../../src/data/cards.json', import.meta.url), 'utf8')) as CardsData
const cardsById = new Map(cardsData.cards.map((card) => [card.id, card]))

const routes = [
  { hash: '#/', label: 'Elixir Drop', ready: '.home' },
  { hash: '#/practice', label: 'Practice', ready: '.pcard' },
  { hash: '#/identify', label: 'Identify', ready: '.identify-ready' },
  { hash: '#/surge', label: 'Surge', ready: '.surge-ready' },
  { hash: '#/higher-lower', label: 'Higher / Lower', ready: '.hl' },
  { hash: '#/trade', label: 'Trade', ready: '.trade-ready' },
  { hash: '#/blitz', label: 'Blitz', ready: '.surge-ready' },
  { hash: '#/survival', label: 'Survival', ready: '.surge-ready' },
  { hash: '#/ladder', label: 'Speed Ladder', ready: '.ladder-ready' },
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

test('identify eliminates wrong names and completes without repeated cards', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/#/identify')
  await expect(page.locator('.identify-ready')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Identify' })).toBeEnabled({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Start Identify' }).click()
  await expect(page.locator('.identify-run')).toBeVisible({ timeout: 5_000 })

  const currentCard = page.locator('[data-testid="identify-card"]')
  await expect(currentCard.locator('.pcard__name')).toHaveCount(0)
  await expect(page.locator('.identify-choice')).toHaveCount(6)

  const readId = async () => Number(await currentCard.getAttribute('data-card-id'))
  const seenIds: number[] = []
  let id = await readId()
  seenIds.push(id)
  const correctName = cardsById.get(id)?.name
  expect(correctName).toBeTruthy()
  const choiceNames = (await page.locator('.identify-choice').allTextContents()).map((name) => name.trim())
  const wrongName = choiceNames.find((name) => name !== correctName)
  expect(wrongName).toBeTruthy()

  await page.getByRole('button', { name: wrongName! }).click()
  await expect(page.locator('.identify-prompt')).toContainText('Not that one')
  await expect(page.getByRole('button', { name: wrongName! })).toBeDisabled()
  await expect(page.getByRole('button', { name: correctName! })).toBeEnabled()
  await page.getByRole('button', { name: correctName! }).click()

  for (let answered = 1; answered < 15; answered += 1) {
    const previousId = id
    await page.waitForFunction(
      (prev) => document.querySelector('[data-testid="identify-card"]')?.getAttribute('data-card-id') !== String(prev),
      previousId
    )
    id = await readId()
    seenIds.push(id)
    const name = cardsById.get(id)?.name
    expect(name).toBeTruthy()
    await page.getByRole('button', { name: name! }).click()
  }

  await expect(page.locator('.identify-result')).toBeVisible()
  expect(new Set(seenIds).size).toBe(seenIds.length)
})

test('speed ladder can be sorted and completed with move controls', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/#/ladder')
  await expect(page.locator('.ladder-ready')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Speed Ladder' })).toBeEnabled({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Start Speed Ladder' }).click()
  await expect(page.locator('.ladder-board')).toBeVisible({ timeout: 5_000 })

  const ladderCards = page.locator('[data-testid="ladder-card"]')
  const readIds = async () =>
    ladderCards.evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
  const isSorted = (ids: number[]) =>
    ids.every(
      (id, index) => index === 0 || (cardsById.get(ids[index - 1])?.elixir ?? 0) <= (cardsById.get(id)?.elixir ?? 0)
    )

  for (let step = 0; step < 30; step += 1) {
    const ids = await readIds()
    if (isSorted(ids)) break

    const inversion = ids.findIndex(
      (id, index) => index > 0 && (cardsById.get(ids[index - 1])?.elixir ?? 0) > (cardsById.get(id)?.elixir ?? 0)
    )
    expect(inversion).toBeGreaterThan(0)
    const movingId = ids[inversion - 1]
    const movingCard = cardsById.get(movingId)
    expect(movingCard).toBeTruthy()
    await page
      .locator(`[data-card-id="${movingId}"]`)
      .getByRole('button', { name: `Move ${movingCard!.name} later` })
      .click()
  }

  expect(isSorted(await readIds())).toBe(true)
  await page.getByRole('button', { name: 'Lock order' }).click()
  await expect(page.locator('.ladder-result')).toBeVisible()
  await expect(page.locator('.ladder-result')).toContainText('Speed Ladder complete')
})

test('trade runs eight exchanges with one cost hint per wrong guess', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/#/trade')
  await expect(page.locator('.trade-ready')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Trade' })).toBeEnabled({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Start Trade' }).click()
  await expect(page.locator('.trade-board')).toBeVisible({ timeout: 5_000 })

  const readSideIds = async (selector: string) =>
    page
      .locator(`${selector} [data-card-id]`)
      .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
  const total = (ids: number[]) => ids.reduce((sum, id) => sum + (cardsById.get(id)?.elixir ?? 0), 0)
  const answers = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
  const format = (value: number) => (value === 0 ? 'Even trade' : `${value > 0 ? `+${value}` : value} trade`)
  const seenIds: number[] = []

  for (let trade = 1; trade <= 8; trade += 1) {
    await expect(page.locator('.trade-board')).toHaveAttribute('data-trade-index', String(trade))
    const blueIds = await readSideIds('.trade-side--blue')
    const redIds = await readSideIds('.trade-side--red')
    const roundIds = [...blueIds, ...redIds]
    expect(new Set(roundIds).size).toBe(roundIds.length)
    seenIds.push(...roundIds)

    const answer = total(redIds) - total(blueIds)
    expect(answer).toBeGreaterThanOrEqual(-4)
    expect(answer).toBeLessThanOrEqual(4)

    if (trade === 1) {
      const wrong = answers.find((value) => value !== answer)
      expect(wrong).toBeDefined()
      await expect(page.locator('.trade-card__cost')).toHaveCount(0)
      await page.getByRole('button', { name: format(wrong!) }).click()
      await expect(page.locator('.trade-prompt')).toContainText('Cost revealed')
      await expect(page.locator('.trade-card__cost')).toHaveCount(1)
    }

    await expect(page.getByRole('button', { name: format(answer) })).toBeEnabled()
    await page.getByRole('button', { name: format(answer) }).click()

    if (trade < 8) {
      await page.waitForFunction(
        (expected) => document.querySelector('.trade-board')?.getAttribute('data-trade-index') === String(expected),
        trade + 1
      )
    }
  }

  await expect(page.locator('.trade-result')).toBeVisible()
  await expect(page.locator('.trade-result__value')).toContainText('8 trades')
  expect(new Set(seenIds).size).toBe(seenIds.length)
})

test('speed ladder reveals one persistent cost hint per wrong lock', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/#/ladder')
  await expect(page.getByRole('button', { name: 'Start Speed Ladder' })).toBeEnabled({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Start Speed Ladder' }).click()
  await expect(page.locator('.ladder-board')).toBeVisible({ timeout: 5_000 })

  await expect(page.locator('.ladder-card__cost')).toHaveCount(0)
  await page.getByRole('button', { name: 'Lock order' }).click()
  await expect(page.locator('.ladder-actions__feedback')).toContainText('Cost revealed')
  await expect(page.locator('.ladder-card__cost')).toHaveCount(1)

  await expect(page.getByRole('button', { name: 'Lock order' })).toBeEnabled()
  await page.getByRole('button', { name: 'Lock order' }).click()
  await expect(page.locator('.ladder-card__cost')).toHaveCount(2)
})

test.describe('mobile Speed Ladder interactions', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('speed ladder can be sorted and completed with tap-to-place', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/#/ladder')
    await expect(page.getByRole('button', { name: 'Start Speed Ladder' })).toBeEnabled({ timeout: 8_000 })
    await page.getByRole('button', { name: 'Start Speed Ladder' }).tap()
    await expect(page.locator('.ladder-board')).toBeVisible({ timeout: 5_000 })

    const ladderCards = page.locator('[data-testid="ladder-card"]')
    const readIds = async () =>
      ladderCards.evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
    const isSorted = (ids: number[]) =>
      ids.every(
        (id, index) => index === 0 || (cardsById.get(ids[index - 1])?.elixir ?? 0) <= (cardsById.get(id)?.elixir ?? 0)
      )

    for (let step = 0; step < 30; step += 1) {
      const ids = await readIds()
      if (isSorted(ids)) break

      const inversion = ids.findIndex(
        (id, index) => index > 0 && (cardsById.get(ids[index - 1])?.elixir ?? 0) > (cardsById.get(id)?.elixir ?? 0)
      )
      expect(inversion).toBeGreaterThan(0)

      const movingId = ids[inversion - 1]
      const targetId = ids[inversion]
      await page.locator(`[data-card-id="${movingId}"]`).tap()
      await expect(page.locator(`[data-card-id="${movingId}"]`)).toHaveClass(/ladder-card--selected/)
      await page.locator(`[data-card-id="${targetId}"]`).tap()
    }

    expect(isSorted(await readIds())).toBe(true)
    await page.getByRole('button', { name: 'Lock order' }).tap()
    await expect(page.locator('.ladder-result')).toBeVisible()
  })
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
  await expect(page.getByLabel('Build information')).toContainText('Build ID')
  await expect(page.getByLabel('Build information')).toContainText('Build date')
})
