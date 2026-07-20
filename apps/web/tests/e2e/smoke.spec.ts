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
const testApiBaseUrl = 'https://fhmql8x10m.execute-api.us-east-1.amazonaws.com'
const testApiRoute = `${testApiBaseUrl}/**`
const testSeason = {
  id: '2026-07',
  startsAt: '2026-07-06T10:00:00.000Z',
  endsAt: '2026-08-03T10:00:00.000Z',
  durationWeeks: 4,
  source: 'clash-royale',
  crSeasonId: 134,
  currentWeek: 2,
  daysRemainingInWeek: 2,
  periodType: 'warDay',
  clockUpdatedAt: '2026-07-18T19:00:00.000Z'
} as const
const testStats = { trophyRoadGames: 592, currentSeason: testSeason }
const testPlayer = {
  id: 'player-1',
  email: 'player@example.com',
  publicName: 'Knight Main',
  favoriteCardId: 26000000,
  totalGames: 12,
  xp: 480,
  level: 2,
  levelStartGames: 10,
  nextLevelGames: 25,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z'
}
const testRecentRuns = [
  {
    runId: 'recent-surge',
    mode: 'surge',
    score: 67_299,
    seasonId: '2026-07',
    completedAt: '2026-07-18T18:42:00.000Z'
  },
  {
    runId: 'recent-trade',
    mode: 'trade',
    score: 11_800,
    seasonId: '2026-07',
    completedAt: '2026-07-17T20:00:00.000Z'
  }
] as const

function leaderboardEntries(mode: GameMode) {
  const scores = mode === 'surge' ? [58_410, 61_220, 64_805, 67_299] : [42, 36, 29, 24]
  return [
    { id: 'player-2', name: 'Royal Ghosted', card: 26000050, level: 7 },
    { id: 'player-3', name: 'Mini P Menace', card: 26000018, level: 5 },
    { id: 'player-4', name: 'Skarmy Party', card: 26000012, level: 4 },
    { id: testPlayer.id, name: testPlayer.publicName, card: testPlayer.favoriteCardId, level: testPlayer.level }
  ].map((entry, index) => ({
    rank: index + 1,
    score: scores[index]!,
    achievedAt: `2026-07-${18 - index}T18:00:00.000Z`,
    player: {
      id: entry.id,
      publicName: entry.name,
      favoriteCardId: entry.card,
      level: entry.level,
      xp: 1000 - index * 200,
      totalGames: 120 - index * 23
    }
  }))
}

function testChallenge(mode: GameMode): RunChallenge {
  const cards = [...cardsData.cards]
  const ids = cards.map((card) => card.id)
  const sequence = (count: number) => Array.from({ length: count }, (_, index) => ids[index % ids.length]!)

  switch (mode) {
    case 'surge':
    case 'practice':
      return { mode, cardIds: sequence(15) }
    case 'survival':
      // Survival deals the whole catalog once (clearing it is a win), so the
      // signed deck length tracks the card count — matching the server and the
      // client's fullDeckSize check.
      return { mode, cardIds: [...ids] }
    case 'higher-lower': {
      // Every pair mixes a low- and a high-cost card so there is always a
      // strictly higher card (matches the server's higherLowerPairs), with the
      // higher card alternating sides.
      const low = cardsData.cards.filter((card) => card.elixir <= 2)
      const high = cardsData.cards.filter((card) => card.elixir >= 5)
      return {
        mode,
        pairs: Array.from({ length: 250 }, (_, index) => {
          const l = low[index % low.length]!
          const h = high[index % high.length]!
          return (index % 2 === 0 ? [l.id, h.id] : [h.id, l.id]) as [number, number]
        })
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
  { hash: '#/surge', label: 'Surge', ready: '.surge-ready' },
  { hash: '#/higher-lower', label: 'Higher / Lower', ready: '.hl' },
  { hash: '#/trade', label: 'Trade', ready: '.trade-ready' },
  { hash: '#/survival', label: 'Survival', ready: '.surge-ready' },
  { hash: '#/leaderboards', label: 'Season leaderboards', ready: '.leaderboard-screen' },
  { hash: '#/settings', label: 'Settings', ready: '.settings__card' },
  { hash: '#/privacy', label: 'Privacy', ready: '.privacy-screen' }
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
      !(allowExpectedApiErrors.has(page) && (text.includes('status of 400') || text.includes('status of 503')))
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
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apiBaseUrl: testApiBaseUrl })
    })
  )
  await page.route(testApiRoute, async (route) => {
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
        body: JSON.stringify({ player: testPlayer, recentRuns: testRecentRuns })
      })
      return
    }
    if (path === '/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(testStats)
      })
      return
    }
    if (path === '/leaderboards') {
      const mode = (new URL(route.request().url()).searchParams.get('mode') ?? 'surge') as GameMode
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode,
          seasonId: '2026-07',
          currentSeason: testSeason,
          entries: leaderboardEntries(mode)
        })
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

test('shows a friendly API outage notice and recovers in place', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  let available = false
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/stats') {
      await route.fulfill({
        status: available ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(
          available ? testStats : { error: { code: 'temporarily_unavailable', message: 'Try again.' } }
        )
      })
      return
    }
    if (path === '/leaderboards') {
      await route.fulfill({
        status: available ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(
          available
            ? {
                mode: 'surge',
                seasonId: testSeason.id,
                currentSeason: testSeason,
                entries: leaderboardEntries('surge')
              }
            : { error: { code: 'temporarily_unavailable', message: 'Try again.' } }
        )
      })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await useSignedOutState(page)
  const outage = page.locator('.api-status')
  await expect(page.getByRole('heading', { name: 'Drop is taking a quick elixir break' })).toBeVisible()
  await expect(outage).toContainText('Your account and recorded games are safe.')

  available = true
  await page.getByRole('button', { name: 'Try reconnecting' }).click()
  await expect(outage).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in to compete' })).toBeVisible()
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
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
  // Redemption is click-gated so mail scanners cannot burn the single-use link.
  await page.getByRole('button', { name: 'Continue to Drop' }).click()
  await expect(page.locator('.surge-ready')).toBeVisible()
  await expect(page).toHaveURL(/#\/surge$/)
})

test('new players choose a favorite card and generated name before returning to a game', async ({ page }) => {
  const newPlayer = { ...testPlayer, publicName: undefined, favoriteCardId: undefined, totalGames: 0 }
  const configuredPlayer = { ...newPlayer, publicName: 'Knight Main', favoriteCardId: 26000000 }
  let savedIdentity: Record<string, unknown> | undefined

  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
        body: JSON.stringify(testStats)
      })
      return
    }
    if (await fulfillTestRun(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456&returnTo=%2Fsurge')
  await page.getByRole('button', { name: 'Continue to Drop' }).click()
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
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
      return
    }
    if (path === '/leaderboards') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'surge',
          seasonId: testSeason.id,
          currentSeason: testSeason,
          entries: leaderboardEntries('surge')
        })
      })
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

test('a malformed signed challenge is rejected without local gameplay fallback', async ({ page }) => {
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
      return
    }
    if (path === '/runs/start') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          runId: 'bad-run',
          runToken: 'bad-run',
          mode: 'surge',
          challenge: { mode: 'surge', cardIds: [26000000] },
          expiresAt: '2099-01-01T00:00:00.000Z'
        })
      })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/surge')
  await expect(page.getByText('Drop received an invalid signed Surge challenge.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start sprint' })).toHaveCount(0)
  await expect(page.locator('.pip-keypad')).toHaveCount(0)
})

test('a temporary authentication outage keeps the saved login', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/refresh') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Player services are restarting.' } })
      })
      return
    }
    if (path === '/stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/surge')
  await expect(page.getByRole('heading', { name: 'Player services are reconnecting' })).toBeVisible()
  await expect(page.getByText('Your saved login has not been removed.')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('elixirdrop:session:v1') || 'null')?.token))
    .toBe(testSession.token)
})

test('a failed completion blocks replay until the recorded run retry succeeds', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  let completionAttempts = 0
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
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

test('a permanently rejected game does not offer a retry that cannot work', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
      return
    }
    if (path === '/runs/complete') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'invalid_request', message: 'Card order is invalid.' } })
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

  await expect(page.getByText('This game could not be verified and was not recorded.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry recording' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('This game could not be verified and was not recorded.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Run it back' })).toBeVisible()
})

test('account deletion requires typed confirmation and clears the saved session', async ({ page }) => {
  let deletionBody: unknown
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/refresh') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (path === '/me' && route.request().method() === 'DELETE') {
      deletionBody = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
      return
    }
    if (path === '/leaderboards') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'surge',
          seasonId: testSeason.id,
          currentSeason: testSeason,
          entries: leaderboardEntries('surge')
        })
      })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/profile')
  await page.getByRole('button', { name: 'Delete account' }).click()
  const confirmDelete = page.getByRole('button', { name: 'Permanently delete account' })
  await expect(confirmDelete).toBeDisabled()
  await page.getByLabel('Type DELETE to confirm').fill('delete')
  await expect(confirmDelete).toBeDisabled()
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  await confirmDelete.click()

  await expect(page.locator('.home')).toBeVisible()
  expect(deletionBody).toEqual({ confirmation: 'DELETE' })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('elixirdrop:session:v1'))).toBeNull()
})

test('nav player block shows Player XP and opens the profile', async ({ page }) => {
  await page.goto('/')

  const block = page.getByRole('button', { name: /Your profile — 480 XP, .+ arena/ })
  await expect(block).toBeVisible()
  await block.click()

  await expect(page.locator('.profile-xp')).toContainText('Player XP')
  await expect(page.locator('.profile-xp')).toContainText('480')
})

test('nav offers a visible screensaver launcher', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play the screensaver' })).toBeVisible()
})

test('higher/lower: tap the higher card; a miss resets the streak', async ({ page }) => {
  await page.goto('/#/higher-lower')
  await expect(page.locator('.hl__pair')).toBeVisible()
  // Low chrome + effects present, like the other running modes.
  await expect(page.locator('.game-motion')).toBeVisible()
  await expect(page.locator('.game-fx-layer')).toHaveCount(1)
  await expect(page.locator('.site-foot')).toBeHidden()

  // Index (0 = left, 1 = right) of the higher-cost card, read from the two
  // rendered card names.
  const higherIndex = async () => {
    const names = await page
      .locator('.hl__card .pcard__img')
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt')))
    const costs = names.map((name) => cardsData.cards.find((card) => card.name === name)?.elixir ?? 0)
    return costs[0]! > costs[1]! ? 0 : 1
  }

  // Tap the higher card → correct, streak advances to 1.
  await page
    .locator('.hl__card')
    .nth(await higherIndex())
    .click()
  await expect(page.locator('.hl__card--correct')).toBeVisible()
  await expect(page.locator('.session-bar__val').first()).toHaveText('1')

  // Next round: tap the lower card → miss, streak resets to 0.
  await page.waitForTimeout(900)
  const lower = (await higherIndex()) === 0 ? 1 : 0
  await page.locator('.hl__card').nth(lower).click()
  await expect(page.locator('.hl__card--wrong')).toBeVisible()
  await expect(page.locator('.session-bar__val').first()).toHaveText('0')
})

test('higher/lower: running out the clock ends the round', async ({ page }) => {
  await page.goto('/#/higher-lower')
  await expect(page.locator('.hl__pair')).toBeVisible()
  // Never tap — the 5s opening window runs out and the timeout reveals the round
  // (the lower card, auto-picked on timeout, is flagged wrong).
  await expect(page.locator('.hl__card--wrong')).toBeVisible({ timeout: 7_000 })
  await expect(page.locator('.hl__card--correct')).toBeVisible()
})

test('home brings season standings, player bests, activity, and Trophy Road forward', async ({ page }, testInfo) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Season standings: Surge' })).toBeVisible()
  await expect(page.locator('.season-standings')).toContainText('Royal Ghosted')
  await expect(page.locator('.season-standings')).toContainText('Knight Main')
  await expect(page.getByRole('heading', { name: 'Your season' })).toBeVisible()
  await expect(page.locator('.player-bests')).toContainText('67.30s')
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
  await expect(page.locator('.activity-list')).toContainText('Trade')
  await expect(page.getByRole('heading', { name: 'Drop together' })).toBeVisible()
  await expect(page.locator('.community-progress')).toContainText('592')
  await expect(page.getByRole('button', { name: /Surge/ }).last()).toContainText('Your season best')

  await testInfo.attach('competition-home.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
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

test('surge points higher or lower after a wrong guess and clears on the solve', async ({ page }) => {
  await page.goto('/#/surge')
  await page.getByRole('button', { name: 'Start sprint' }).click()

  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  const wrongCost = card!.elixir === 1 ? 2 : 1
  const expectedCue = wrongCost < card!.elixir ? 'Higher' : 'Lower'

  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()
  await expect(page.getByTestId('surge-hint')).toContainText(expectedCue)

  // Solving the card clears the cue for the next one.
  const correctButton = page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true })
  await expect(correctButton).toBeEnabled()
  await correctButton.click()
  await expect(page.getByTestId('surge-hint')).toBeEmpty()
})

test('surge runtime cues drive card motion and the optional effects canvas', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium provides the stable WebGL test surface for Pixi effects.')

  await page.goto('/#/surge')
  await page.getByRole('button', { name: 'Start sprint' }).click()

  const motionCard = page.locator('.game-motion')
  const cardName = await motionCard.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  await expect(page.locator('.game-fx-layer canvas')).toHaveCount(1)

  const wrongCost = card!.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()
  await page.waitForTimeout(60)
  expect(await motionCard.evaluate((element) => getComputedStyle(element).transform)).not.toBe('none')
  await testInfo.attach('surge-wrong-shake.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })

  const correctButton = page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true })
  await expect(correctButton).toBeEnabled()
  await correctButton.click()
  await expect.poll(() => motionCard.locator('.pcard__img').getAttribute('alt')).not.toBe(cardName)
  await expect(motionCard).toBeVisible()
  await testInfo.attach('surge-correct-transition.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
})

test('surge keeps gameplay still and skips optional effects when reduced motion is enabled', async ({ page }) => {
  await page.goto('/#/settings')
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await page.goto('/#/surge')
  await page.getByRole('button', { name: 'Start sprint' }).click()

  const motionCard = page.locator('.game-motion')
  const cardName = await motionCard.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  await expect(page.locator('.game-fx-layer canvas')).toHaveCount(0)

  const wrongCost = card!.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()
  await page.waitForTimeout(60)
  expect(await motionCard.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
  await expect(motionCard).toBeVisible()
})

test('active play states use low chrome and keep controls visible', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const activeModes = [
    { hash: '#/surge', ready: '.surge-ready', start: 'Start sprint', control: '.pip-keypad' },
    { hash: '#/survival', ready: '.surge-ready', start: 'Start run', control: '.pip-keypad' },
    { hash: '#/trade', ready: '.trade-ready', start: 'Start Trade', control: '.trade-answers' }
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
    await expect(page.locator('.player-block__xp')).toBeHidden()
    await expect(page.locator(mode.control)).toBeVisible()
    await expect(page.locator('.game-motion')).toBeVisible()
    await expect(page.locator('.game-fx-layer')).toHaveCount(1)
    if (testInfo.project.name === 'chromium') {
      await expect(page.locator('.game-fx-layer canvas')).toHaveCount(1)
    }

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

test('continuous play modes expose working controls with low chrome', async ({ page }, testInfo) => {
  // Higher/Lower has its own tap-the-card coverage above.
  const modes = [{ hash: '#/practice', control: '.pip-keypad', answer: '4 elixir' }]

  for (const mode of modes) {
    await page.goto('/')
    await page.goto(`/${mode.hash}`)

    await expect(page.locator('.game-run')).toBeVisible()
    await expect(page.locator(mode.control)).toBeVisible()
    await expect(page.locator('.game-motion')).toBeVisible()
    await expect(page.locator('.game-fx-layer')).toHaveCount(1)
    if (testInfo.project.name === 'chromium') {
      await expect(page.locator('.game-fx-layer canvas')).toHaveCount(1)
    }
    await expect(page.locator('.site-foot')).toBeHidden()
    await expect(page.getByRole('button', { name: mode.answer, exact: true })).toBeEnabled()

    await testInfo.attach(`${mode.hash.slice(2)}-running.png`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    })
    await page.getByRole('button', { name: mode.answer, exact: true }).click()
  }
})

test('card art fallback renders when card images cannot load', async ({ page }) => {
  allowBlockedAssets.add(page)
  // Card art is mirrored same-origin under /cards/; block that path.
  await page.route('**/cards/*.png', (route) => route.abort())
  await page.goto('/')
  await page.goto('/#/practice')
  await expect(page.locator('.pcard__fallback')).toBeVisible()
})

test('five hero-logo taps start the screensaver and any key exits it', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'egg smoke runs on desktop chromium only')
  await page.goto('/')
  const logo = page.locator('.hero__title')
  for (let tap = 0; tap < 5; tap += 1) await logo.click()

  const overlay = page.getByTestId('screensaver')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('role', 'dialog')
  const axe = await new AxeBuilder({ page }).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
  await expect(page.locator('.hero__title')).toBeVisible()
  await expect(page.locator('.home')).toBeVisible()
})

test('footer links to the Elixir Drop Discord', async ({ page }) => {
  await page.goto('/')

  const discord = page.getByRole('link', { name: 'Join the Elixir Drop Discord' })
  await expect(discord).toBeVisible()
  await expect(discord).toHaveAttribute('href', 'https://discord.gg/SdvKfJW5kA')
  await expect(discord).toHaveAttribute('target', '_blank')
  await expect(discord).toHaveAttribute('rel', 'noopener noreferrer')
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
      await expect(page.getByTestId('trade-hint')).toContainText('Cost revealed')
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

test.describe('mobile site header', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps account and navigation controls readable without overflow', async ({ page }) => {
    await useSignedOutState(page)

    const account = page.locator('.site-head__signin')
    await expect(account).toHaveAttribute('aria-label', 'Sign in')
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

  // Practice is untimed (no Start), but pairs a full card with the same 3×3
  // keypad — its bottom row must not fall off the first viewport either.
  test('keeps the Practice keypad in the first viewport', async ({ page }) => {
    await page.goto('/#/practice')
    const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
    await expect(keypad).toBeVisible({ timeout: 5_000 })

    const controlsFit = await keypad.evaluate((element) =>
      [...element.querySelectorAll('button')].every(
        (button) => button.getBoundingClientRect().bottom <= window.innerHeight + 1
      )
    )
    expect(controlsFit).toBe(true)
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

test('leaderboards are season-scoped, not week-scoped', async ({ page }) => {
  await page.goto('/#/leaderboards')

  await expect(page.getByRole('heading', { name: 'Season 134 leaderboards' })).toBeVisible()
  await expect(page.locator('.leaderboard-hero')).toContainText(
    'Season ends August 3 at 10:00 UTC — new boards open then'
  )
  // The Clan-Wars weekly clock must not appear on the season board.
  await expect(page.locator('.leaderboard-hero')).not.toContainText('left in week')
  await expect(page.locator('.leaderboard-list')).toContainText('Knight Main')
  await expect(page.locator('.leaderboard-row--player')).toContainText('You')
  await expect(page.locator('.leaderboard-list')).toContainText('XP')

  await page.getByRole('button', { name: /Survival/ }).click()
  await expect(page.getByRole('heading', { name: 'Survival' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Survival' })).toBeVisible()
})

test('saved player tag resolves through the bridge profile states', async ({ page }, testInfo) => {
  // The mocked CR profile carries CDN-shaped iconUrls (as the bridge relays);
  // serve them a pixel so no browser logs a 404.
  await page.route('https://api-assets.clashroyale.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      )
    })
  )
  await page.unroute(testApiRoute)
  await page.unroute('**/api-config.json')
  await page.route('**/api-config.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apiBaseUrl: testApiBaseUrl })
    })
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
  await page.route(testApiRoute, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/refresh') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session }) })
      return
    }
    if (url.pathname === '/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(testStats)
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
                      iconUrl: 'https://api-assets.clashroyale.com/cards/300/knight.png'
                    },
                    {
                      id: 26000001,
                      name: 'Archers',
                      iconUrl: 'https://api-assets.clashroyale.com/cards/300/archers.png'
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
  await expect(page.locator('.cr-profile')).toContainText('POAP KINGS')
  await expect(page.locator('.cr-profile')).toContainText('Account age unavailable')
  await expect(page.locator('.cr-profile')).toContainText('Years Played badge not returned by Clash Royale')
  // The collection COUNT stays; the card grid was removed (no use in Drop).
  await expect(page.locator('.cr-profile')).toContainText('Collection')
  await expect(page.locator('.cr-profile')).toContainText('Not used in Drop')
  await expect(page.getByLabel('Clash Royale card collection')).toHaveCount(0)
  await expect(page.locator('.cr-profile')).not.toContainText(/troph|arena|card level/i)

  const screenshot = await page.screenshot({ fullPage: true })
  await testInfo.attach('resolved-cr-profile.png', { body: screenshot, contentType: 'image/png' })
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
  expect(serious).toEqual([])
})
