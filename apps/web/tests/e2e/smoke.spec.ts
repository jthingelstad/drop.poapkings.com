import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { GameMode, RunChallenge } from '@elixir-drop/contracts'
import type { CardsData } from '../../src/types'

const cardsData = JSON.parse(
  readFileSync(new URL('../../../../packages/game-data/cards.json', import.meta.url), 'utf8')
) as CardsData
const cardsById = new Map(cardsData.cards.map((card) => [card.id, card]))
const testSession = { token: 'session-token', expiresAt: '2099-01-01T00:00:00.000Z' }
const testPlayer = {
  id: 'player-1',
  email: 'player@example.com',
  publicName: 'Knight Main',
  favoriteCardId: 26000000,
  totalGames: 12,
  level: 2,
  levelStartGames: 10,
  nextLevelGames: 25,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z'
}

function testChallenge(mode: GameMode): RunChallenge {
  const cards = [...cardsData.cards]
  const ids = cards.map((card) => card.id)
  const sequence = (count: number) => Array.from({ length: count }, (_, index) => ids[index % ids.length]!)

  switch (mode) {
    case 'surge':
    case 'practice':
    case 'identify':
      return { mode, cardIds: sequence(15) }
    case 'blitz':
      return { mode, cardIds: sequence(240) }
    case 'survival':
      return { mode, cardIds: sequence(250) }
    case 'higher-lower': {
      const pairIds = sequence(500)
      return {
        mode,
        pairs: Array.from({ length: 250 }, (_, index) => [pairIds[index * 2]!, pairIds[index * 2 + 1]!])
      }
    }
    case 'trade': {
      const byCost = cards.toSorted((left, right) => left.elixir - right.elixir)
      return {
        mode,
        rounds: Array.from({ length: 8 }, (_, index) => ({
          blueIds: [byCost[index * 2]!.id],
          redIds: [byCost[index * 2 + 1]!.id]
        }))
      }
    }
    case 'ladder': {
      const seenCosts = new Set<number>()
      const descending = cards
        .toSorted((left, right) => right.elixir - left.elixir)
        .filter((card) => {
          if (seenCosts.has(card.elixir)) return false
          seenCosts.add(card.elixir)
          return true
        })
        .slice(0, 5)
      return {
        mode,
        cardIds: descending.map((card) => card.id)
      }
    }
    case 'endless-ladder': {
      const starting = cards.toSorted((left, right) => left.elixir - right.elixir).slice(0, 2)
      return { mode, startingIds: starting.map((card) => card.id), cardIds: sequence(250) }
    }
    case 'cost-sweep': {
      const targetElixir = 4
      const targets = cards.filter((card) => card.elixir === targetElixir).slice(0, 3)
      const fillers = cards.filter((card) => card.elixir !== targetElixir).slice(0, 9)
      const board = { targetElixir, cardIds: [...targets, ...fillers].map((card) => card.id) }
      return { mode, boards: Array.from({ length: 50 }, () => board) }
    }
  }
}

async function fulfillTestRun(route: Route): Promise<boolean> {
  const path = new URL(route.request().url()).pathname
  if (path === '/runs/start') {
    const { mode } = route.request().postDataJSON() as { mode: GameMode }
    const challenge = testChallenge(mode)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        runId: `run-${mode}`,
        runToken: `run-${mode}`,
        mode,
        challenge,
        expiresAt: '2099-01-01T00:00:00.000Z'
      })
    })
    return true
  }
  if (path === '/runs/complete') {
    const { runToken } = route.request().postDataJSON() as { runToken: string }
    const mode = runToken.replace(/^run-/, '') as GameMode
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: true,
        runId: runToken,
        mode,
        score: 1,
        season: {
          id: '2026-07',
          startsAt: '2026-07-06T08:00:00.000Z',
          endsAt: '2026-08-03T08:00:00.000Z',
          durationWeeks: 4
        },
        completedAt: '2026-07-18T00:00:00.000Z',
        totalGames: 13,
        level: 2,
        levelStartGames: 10,
        nextLevelGames: 25
      })
    })
    return true
  }
  return false
}

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
  { hash: '#/endless-ladder', label: 'Endless Ladder', ready: '.endless-ready' },
  { hash: '#/cost-sweep', label: 'Cost Sweep', ready: '.sweep-ready' },
  { hash: '#/settings', label: 'Settings', ready: '.settings__card' }
]

const pageErrors = new WeakMap<Page, string[]>()
const allowBlockedAssets = new WeakSet<Page>()
const allowExpectedApiErrors = new WeakSet<Page>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('console', (msg) => {
    const text = msg.text()
    if (
      msg.type() === 'error' &&
      !(allowBlockedAssets.has(page) && text.includes('net::ERR_FAILED')) &&
      !(allowExpectedApiErrors.has(page) && text.includes('status of 503'))
    ) {
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
  // Browser gameplay tests use a signed-in player but never create production
  // records. The deployed API has a separate live smoke in infra/scripts.
  await page.route('**/api-config.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"apiBaseUrl":"https://api.example"}' })
  )
  await page.route('https://api.example/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/refresh' || path === '/auth/redeem') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (path === '/auth/request') {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Check your email for a private login link.' })
      })
      return
    }
    if (path === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalGames: 100, authenticatedGames: 100 })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await page.addInitScript((session) => {
    Math.random = () => 0.42
    if (new URLSearchParams(location.search).get('signedOut') !== '1') {
      localStorage.setItem('elixirdrop:session:v1', JSON.stringify(session))
    }
  }, testSession)
})

test.afterEach(async ({ page }) => {
  const errors = pageErrors.get(page) ?? []
  await page.close()
  expect(errors).toEqual([])
})

async function useSignedOutState(page: Page, hash = '/'): Promise<void> {
  await page.goto(`/?signedOut=1#${hash}`)
}

test('requires email authentication before entering a game and returns after login', async ({ page }) => {
  await useSignedOutState(page, '/surge')

  await expect(page.getByRole('heading', { name: 'Sign in to play' })).toBeVisible()
  await expect(page.locator('.surge-ready')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign in with email' }).click()
  await expect(page).toHaveURL(/#\/login\?returnTo=%2Fsurge$/)

  let loginBody: Record<string, unknown> | undefined
  await page.unroute('https://api.example/**')
  await page.route('https://api.example/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/request') {
      loginBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Check your email for a private login link.' })
      })
      return
    }
    if (path === '/auth/redeem') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (path === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  const emailInput = page.getByLabel('Email address')
  await emailInput.fill('e***@p***.com')
  await page.getByRole('button', { name: 'Email me a login link' }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter your complete email address, not a masked address.')
  await expect(emailInput).toHaveAttribute('aria-invalid', 'true')
  expect(loginBody).toBeUndefined()

  await emailInput.fill('player@example.com')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Email me a login link' }).click()
  await expect(page.getByRole('status')).toContainText('Check your email')
  expect(loginBody).toEqual({ email: 'player@example.com', returnTo: '/surge' })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456&returnTo=%2Fsurge')
  await expect(page.locator('.surge-ready')).toBeVisible()
  await expect(page).toHaveURL(/#\/surge$/)
})

test('new players choose a favorite card and generated name before returning to a game', async ({ page }) => {
  const newPlayer = { ...testPlayer, publicName: undefined, favoriteCardId: undefined, totalGames: 0 }
  const configuredPlayer = { ...newPlayer, publicName: 'Knight Main', favoriteCardId: 26000000 }
  let savedIdentity: Record<string, unknown> | undefined

  await page.unroute('https://api.example/**')
  await page.route('https://api.example/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/auth/redeem') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (path === '/me' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: savedIdentity ? configuredPlayer : newPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/me/name-options') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ favoriteCardId: 26000000, names: ['Knight Main'], nameToken: 'name-token' })
      })
      return
    }
    if (path === '/me' && request.method() === 'PATCH') {
      savedIdentity = request.postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: configuredPlayer })
      })
      return
    }
    if (path === '/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalGames: 0, authenticatedGames: 0 })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456&returnTo=%2Fsurge')
  await expect(page).toHaveURL(/#\/profile\?returnTo=%2Fsurge$/)
  await expect(page.getByText('Choose a favorite card and generated name to continue')).toBeVisible()

  const favoriteCards = page.locator('.favorite-card-grid')
  await favoriteCards.getByRole('button', { name: 'Knight', exact: true }).click()
  await page.getByRole('button', { name: 'Get name choices' }).click()
  await page.getByRole('button', { name: 'Knight Main', exact: true }).click()

  await expect(page).toHaveURL(/#\/surge$/)
  await expect
    .poll(() => savedIdentity)
    .toEqual({ favoriteCardId: 26000000, publicName: 'Knight Main', nameToken: 'name-token' })
  await expect(page.locator('.surge-ready')).toBeVisible()
})

test('a signed run must be prepared before game controls become available', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  let attempts = 0
  await page.unroute('https://api.example/**')
  await page.route('https://api.example/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/refresh') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (path === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"totalGames":100}' })
      return
    }
    if (path === '/runs/start' && attempts++ === 0) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'temporarily_unavailable', message: 'Player services are reconnecting.' }
        })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/surge')
  await expect(page.getByRole('heading', { name: 'This game could not start' })).toBeVisible()
  await expect(page.locator('.surge-ready')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.surge-ready')).toBeVisible()
})

test('a failed completion blocks replay until the recorded run retry succeeds', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  let completionAttempts = 0
  await page.unroute('https://api.example/**')
  await page.route('https://api.example/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/refresh') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (path === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"totalGames":100}' })
      return
    }
    if (path === '/runs/complete' && completionAttempts++ === 0) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Try again.' } })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/survival')
  await page.getByRole('button', { name: 'Start run' }).click()
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  const wrongCost = card?.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()

  await expect(page.getByRole('button', { name: 'Retry recording' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry recording' }).click()
  await expect(page.getByText('Game recorded', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry recording' })).toHaveCount(0)
  expect(completionAttempts).toBe(2)
})

for (const route of routes) {
  test(`renders ${route.label} without serious accessibility issues`, async ({ page }, testInfo) => {
    await page.goto('/')
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

test('active play states use low chrome and keep controls visible', async ({ page }, testInfo) => {
  const activeModes = [
    { hash: '#/surge', ready: '.surge-ready', start: 'Start sprint', control: '.pip-keypad' },
    { hash: '#/blitz', ready: '.surge-ready', start: 'Start Blitz', control: '.pip-keypad' },
    { hash: '#/survival', ready: '.surge-ready', start: 'Start run', control: '.pip-keypad' },
    { hash: '#/identify', ready: '.identify-ready', start: 'Start Identify', control: '.identify-choices' },
    { hash: '#/trade', ready: '.trade-ready', start: 'Start Trade', control: '.trade-answers' },
    { hash: '#/ladder', ready: '.ladder-ready', start: 'Start Speed Ladder', control: '.ladder-board' },
    {
      hash: '#/endless-ladder',
      ready: '.endless-ready',
      start: 'Start Endless Ladder',
      control: '.endless-track'
    },
    { hash: '#/cost-sweep', ready: '.sweep-ready', start: 'Start Cost Sweep', control: '.sweep-grid' }
  ]

  for (const mode of activeModes) {
    await page.goto('/')
    await page.goto(`/${mode.hash}`)
    await expect(page.locator(mode.ready)).toBeVisible()
    await expect(page.locator('.site-foot')).toBeVisible()

    await page.getByRole('button', { name: mode.start }).click()
    await expect(page.locator('.game-run')).toBeVisible()
    await page.waitForTimeout(2_300)

    await expect(page.locator('.site-foot')).toBeHidden()
    await expect(page.locator('.starcount')).toBeHidden()
    await expect(page.locator(mode.control)).toBeVisible()

    if (mode.hash === '#/surge') {
      const artChrome = await page.locator('.cr-card-art').evaluate((element) => ({
        before: getComputedStyle(element, '::before').content,
        after: getComputedStyle(element, '::after').content
      }))
      const cardPanel = await page.locator('.pcard').evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          backgroundImage: style.backgroundImage,
          borderStyle: style.borderStyle,
          borderWidth: style.borderWidth
        }
      })

      expect(artChrome).toEqual({ before: 'none', after: 'none' })
      expect(cardPanel).toEqual({ backgroundImage: 'none', borderStyle: 'none', borderWidth: '0px' })
    }

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    expect(hasHorizontalOverflow).toBe(false)

    const screenshot = await page.screenshot({ fullPage: false })
    await testInfo.attach(`${mode.hash.slice(2).replaceAll('/', '-')}-running.png`, {
      body: screenshot,
      contentType: 'image/png'
    })
  }
})

test('continuous play modes expose working controls with low chrome', async ({ page }) => {
  const modes = [
    { hash: '#/practice', control: '.pip-keypad', answer: '4 elixir' },
    { hash: '#/higher-lower', control: '.hl-controls', answer: 'Equal' }
  ]

  for (const mode of modes) {
    await page.goto('/')
    await page.goto(`/${mode.hash}`)

    await expect(page.locator('.game-run')).toBeVisible()
    await expect(page.locator(mode.control)).toBeVisible()
    await expect(page.locator('.site-foot')).toBeHidden()
    await expect(page.getByRole('button', { name: mode.answer, exact: true })).toBeEnabled()
    await page.getByRole('button', { name: mode.answer, exact: true }).click()
  }
})

test('card art fallback renders when the Clash Royale CDN is blocked', async ({ page }) => {
  allowBlockedAssets.add(page)
  await page.route('https://api-assets.clashroyale.com/**', (route) => route.abort())
  await page.goto('/')
  await page.goto('/#/practice')
  await expect(page.locator('.pcard__fallback')).toBeVisible()
})

test('footer links to the Elixir Drop Discord', async ({ page }) => {
  await page.goto('/')

  const discord = page.getByRole('link', { name: 'Join the Elixir Drop Discord' })
  await expect(discord).toBeVisible()
  await expect(discord).toHaveAttribute('href', 'https://discord.gg/SdvKfJW5kA')
  await expect(discord).toHaveAttribute('target', '_blank')
  await expect(discord).toHaveAttribute('rel', 'noopener noreferrer')
})

test('identify eliminates wrong names and completes without repeated cards', async ({ page }) => {
  await page.goto('/')
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

  const choices = page.locator('.identify-choices')
  await choices.getByRole('button', { name: wrongName!, exact: true }).click()
  await expect(page.locator('.identify-prompt')).toContainText('Not that one')
  await expect(choices.getByRole('button', { name: wrongName!, exact: true })).toBeDisabled()
  await expect(choices.getByRole('button', { name: correctName!, exact: true })).toBeEnabled()
  await choices.getByRole('button', { name: correctName!, exact: true }).click()

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
    await choices.getByRole('button', { name: name!, exact: true }).click()
  }

  await expect(page.locator('.identify-result')).toBeVisible()
  expect(new Set(seenIds).size).toBe(seenIds.length)
})

test('speed ladder can be sorted and completed with move controls', async ({ page }) => {
  await page.goto('/')
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

test('endless ladder accepts valid inserts and ends on a wrong slot', async ({ page }) => {
  await page.goto('/')
  await page.goto('/#/endless-ladder')
  await expect(page.locator('.endless-ready')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Endless Ladder' })).toBeEnabled({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Start Endless Ladder' }).click()
  await expect(page.locator('.endless-track')).toBeVisible({ timeout: 5_000 })

  const readRowIds = async () =>
    page
      .locator('.endless-card')
      .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
  const readCurrentId = async () =>
    Number(await page.locator('[data-testid="endless-current-card"]').getAttribute('data-card-id'))
  const validSlots = (ids: number[], currentId: number) => {
    const current = cardsById.get(currentId)
    expect(current).toBeTruthy()
    const slots: number[] = []
    for (let slot = 0; slot <= ids.length; slot += 1) {
      const left = slot > 0 ? cardsById.get(ids[slot - 1]) : undefined
      const right = slot < ids.length ? cardsById.get(ids[slot]) : undefined
      if ((!left || left.elixir <= current!.elixir) && (!right || current!.elixir <= right.elixir)) slots.push(slot)
    }
    return slots
  }

  for (let insert = 0; insert < 3; insert += 1) {
    const ids = await readRowIds()
    const currentId = await readCurrentId()
    const [slot] = validSlots(ids, currentId)
    expect(slot).toBeDefined()
    await page.locator(`[data-testid="endless-slot"][data-slot-index="${slot}"]`).click()
    await page.waitForFunction(
      (prev) =>
        document.querySelector('[data-testid="endless-current-card"]')?.getAttribute('data-card-id') !== String(prev),
      currentId
    )
  }

  const ids = await readRowIds()
  const currentId = await readCurrentId()
  const valid = new Set(validSlots(ids, currentId))
  const wrongSlot = Array.from({ length: ids.length + 1 }, (_, index) => index).find((slot) => !valid.has(slot))
  expect(wrongSlot).toBeDefined()
  await page.locator(`[data-testid="endless-slot"][data-slot-index="${wrongSlot}"]`).click()
  await expect(page.locator('.ladder-result')).toBeVisible()
  await expect(page.locator('.ladder-result')).toContainText('Endless Ladder complete')
})

test('cost sweep clears a target board and penalizes wrong taps', async ({ page }) => {
  await page.goto('/')
  await page.goto('/#/cost-sweep')
  await expect(page.locator('.sweep-ready')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Cost Sweep' })).toBeEnabled({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Start Cost Sweep' }).click()
  await expect(page.locator('.sweep-grid')).toBeVisible({ timeout: 5_000 })

  const nonTarget = page.locator('.sweep-card[data-target="false"]').first()
  const nonTargetId = Number(await nonTarget.getAttribute('data-card-id'))
  const nonTargetCard = cardsById.get(nonTargetId)
  expect(nonTargetCard).toBeTruthy()
  await nonTarget.click()
  await expect(nonTarget).toHaveClass(/sweep-card--wrong/)
  await expect(nonTarget.locator('.sweep-card__cost')).toContainText(String(nonTargetCard!.elixir))
  await expect(nonTarget.locator('.sweep-card__cost')).toHaveClass(/sweep-card__cost--wrong/)

  const targetIds = await page
    .locator('.sweep-card[data-target="true"]')
    .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
  expect(targetIds.length).toBeGreaterThanOrEqual(2)

  for (const id of targetIds) await page.locator(`.sweep-card[data-card-id="${id}"]`).click()

  await expect(page.locator('.surge-hud__count')).toContainText('1 boards')
})

test('trade runs eight exchanges with one cost hint per wrong guess', async ({ page }) => {
  await page.goto('/')
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
  await page.goto('/#/ladder')
  await expect(page.getByRole('button', { name: 'Start Speed Ladder' })).toBeEnabled({ timeout: 8_000 })
  await page.getByRole('button', { name: 'Start Speed Ladder' }).click()
  await expect(page.locator('.ladder-board')).toBeVisible({ timeout: 5_000 })

  const hasCardContentOverlap = await page.locator('[data-testid="ladder-card"]').evaluateAll((cards) => {
    const overlaps = (left: DOMRect, right: DOMRect) =>
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    return cards.some((card) => {
      const art = card.querySelector('.ladder-card__art')?.getBoundingClientRect()
      const details = card.querySelector('.ladder-card__details')?.getBoundingClientRect()
      const controls = card.querySelector('.ladder-card__controls')?.getBoundingClientRect()
      return Boolean(art && details && controls && (overlaps(art, details) || overlaps(details, controls)))
    })
  })
  expect(hasCardContentOverlap).toBe(false)

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
      await page.locator(`[data-card-id="${movingId}"] .ladder-card__details`).tap()
      await expect(page.locator(`[data-card-id="${movingId}"]`)).toHaveClass(/ladder-card--selected/)
      await page.locator(`[data-card-id="${targetId}"] .ladder-card__details`).tap()
    }

    expect(isSorted(await readIds())).toBe(true)
    await page.getByRole('button', { name: 'Lock order' }).tap()
    await expect(page.locator('.ladder-result')).toBeVisible()
  })
})

test.describe('mobile site header', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps account and navigation controls readable without overflow', async ({ page }) => {
    await useSignedOutState(page)

    const account = page.locator('.site-head__account')
    await expect(account).toHaveText('Sign in')
    await expect(page.locator('.site-head__name')).toBeHidden()

    const accountIsClipped = await account.evaluate((element) => element.scrollWidth > element.clientWidth + 1)
    const pageHasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )

    expect(accountIsClipped).toBe(false)
    expect(pageHasHorizontalOverflow).toBe(false)
  })
})

test.describe('mobile timed-mode controls', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true })

  test('keeps every timed keypad in the first viewport', async ({ page }) => {
    const modes = [
      { hash: '#/surge', start: 'Start sprint' },
      { hash: '#/blitz', start: 'Start Blitz' },
      { hash: '#/survival', start: 'Start run' }
    ]

    for (const mode of modes) {
      await page.goto(`/${mode.hash}`)
      const start = page.getByRole('button', { name: mode.start })
      await expect(start).toBeEnabled({ timeout: 8_000 })
      await start.tap()
      const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
      await expect(keypad).toBeVisible({ timeout: 5_000 })

      const controlsFit = await keypad.evaluate((element) => {
        const buttons = [...element.querySelectorAll('button')]
        return buttons.every((button) => button.getBoundingClientRect().bottom <= window.innerHeight + 1)
      })
      expect(controlsFit).toBe(true)
    }
  })
})

test.describe('low-height desktop timed controls', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('keeps the entire Surge keypad in view', async ({ page }) => {
    await page.goto('/#/surge')
    await page.getByRole('button', { name: 'Start sprint' }).click()
    const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
    await expect(keypad).toBeVisible({ timeout: 5_000 })

    const controlsFit = await keypad.evaluate((element) =>
      [...element.querySelectorAll('button')].every((button) => {
        const bounds = button.getBoundingClientRect()
        return bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1
      })
    )
    expect(controlsFit).toBe(true)
  })
})

test('settings persist input and motion preferences across reload', async ({ page }) => {
  await page.goto('/')
  await page.goto('/#/settings')
  await page.getByRole('button', { name: '4 choices' }).click()
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await page.reload()

  await expect(page.getByRole('button', { name: '4 choices' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)
  await expect(page.getByLabel('Build information')).toContainText('Build ID')
  await expect(page.getByLabel('Build information')).toContainText('Build date')
})

test('saved player tag resolves through the bridge profile states', async ({ page }, testInfo) => {
  await page.unroute('https://api.example/**')
  await page.unroute('**/api-config.json')
  await page.route('**/api-config.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"apiBaseUrl":"https://api.example"}' })
  )

  const basePlayer = {
    id: 'player-1',
    email: 'player@example.com',
    publicName: 'Knight Main',
    favoriteCardId: 26000000,
    totalGames: 12,
    level: 2,
    levelStartGames: 10,
    nextLevelGames: 25,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z'
  }
  const session = { token: 'session-token', expiresAt: '2099-01-01T00:00:00.000Z' }
  let saved = false
  await page.route('https://api.example/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/refresh') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session }) })
      return
    }
    if (url.pathname === '/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalGames: 100, authenticatedGames: 80 })
      })
      return
    }
    if (url.pathname === '/me' && route.request().method() === 'PATCH') {
      saved = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          player: {
            ...basePlayer,
            playerTag: '#20JJJ2CCRU',
            clashRoyale: { tag: '#20JJJ2CCRU', status: 'pending' }
          }
        })
      })
      return
    }
    if (url.pathname === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          player: saved
            ? {
                ...basePlayer,
                playerTag: '#20JJJ2CCRU',
                clashRoyale: {
                  tag: '#20JJJ2CCRU',
                  status: 'ready',
                  name: 'King Thing',
                  clan: { tag: '#J2RGCRVG', name: 'POAP KINGS', badgeId: 16000000, role: 'leader' },
                  cards: [
                    {
                      id: 26000000,
                      name: 'Knight',
                      iconUrl: cardsById.get(26000000)?.icon
                    },
                    {
                      id: 26000001,
                      name: 'Archers',
                      iconUrl: cardsById.get(26000001)?.icon
                    }
                  ],
                  fetchedAt: '2026-07-18T13:27:25.039Z'
                }
              }
            : basePlayer,
          recentRuns: []
        })
      })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await page.addInitScript((storedSession) => {
    localStorage.setItem('elixirdrop:session:v1', JSON.stringify(storedSession))
  }, session)

  await page.goto('/#/profile')
  const tagInput = page.getByPlaceholder('#PLAYER_TAG')
  await expect(tagInput).toBeVisible()
  await tagInput.fill('20JJJ2CCRU')
  await page.getByRole('button', { name: 'Save tag' }).click()

  await expect(page.getByRole('heading', { name: 'Loading Clash Royale profile' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'King Thing' })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Clash Royale profile loaded.')).toBeVisible()
  await expect(page.getByText('Player tag saved. Loading its public Clash Royale profile…')).toHaveCount(0)
  await expect(page.locator('.cr-profile')).toContainText('POAP KINGS')
  await expect(page.locator('.cr-profile')).toContainText('Account age unavailable')
  await expect(page.locator('.cr-profile')).toContainText('Years Played badge not returned by Clash Royale')
  await expect(page.getByLabel('Clash Royale card collection')).toContainText('Knight')
  await expect(page.getByLabel('Clash Royale card collection')).toContainText('Archers')
  await expect(page.locator('.cr-profile')).not.toContainText(/troph|arena|card level/i)

  const screenshot = await page.screenshot({ fullPage: true })
  await testInfo.attach('resolved-cr-profile.png', { body: screenshot, contentType: 'image/png' })
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
  expect(serious).toEqual([])
})
