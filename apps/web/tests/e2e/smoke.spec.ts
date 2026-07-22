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

// The desktop right rail polls GET /activity ("Recent runs"); a small feed keeps it
// from 404-ing (which the console-error guard would flag) and lets the desktop
// home test assert the recent-activity surface.
const testActivity = {
  seasonId: '2026-07',
  entries: [
    {
      mode: 'trade' as GameMode,
      score: 11_800,
      achievedAt: '2026-07-18T18:00:00.000Z',
      runCount: 8,
      player: {
        id: 'player-9',
        publicName: 'Skarmy Party',
        favoriteCardId: 26000012,
        level: 4,
        xp: 300,
        totalGames: 40
      }
    }
  ]
}

// The two shells both mount read-only surfaces that hit the API on every route:
// the desktop right rail (GET /leaderboards + GET /activity) and Home
// (GET /stats + per-mode /leaderboards). Any override test that navigates on the
// desktop viewport must answer these or the browser logs a failed-fetch console
// error that the afterEach guard treats as a failure. Tests that handle a path
// with their own behavior match it first; this only backstops the rest.
async function fulfillSupportData(route: Route): Promise<boolean> {
  const url = new URL(route.request().url())
  const path = url.pathname
  if (path === '/stats') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
    return true
  }
  if (path === '/leaderboards') {
    const mode = (url.searchParams.get('mode') ?? 'surge') as GameMode
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode,
        scope: url.searchParams.get('scope') === 'all-time' ? 'all-time' : 'season',
        seasonId: testSeason.id,
        currentSeason: testSeason,
        entries: leaderboardEntries(mode)
      })
    })
    return true
  }
  if (path === '/activity') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testActivity) })
    return true
  }
  return false
}

function testChallenge(mode: GameMode): RunChallenge {
  const cards = [...cardsData.cards]
  const ids = cards.map((card) => card.id)
  const sequence = (count: number) => Array.from({ length: count }, (_, index) => ids[index % ids.length]!)

  switch (mode) {
    case 'surge':
    case 'practice':
      return { mode, cardIds: sequence(15) }
    case 'rain':
      return { mode, cardIds: sequence(250) }
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
    const guest = !route.request().headers()['authorization']
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        runId: `run-${mode}`,
        runToken: `run-${mode}`,
        mode,
        challenge,
        ...(guest ? { guest: true } : {}),
        expiresAt: '2099-01-01T00:00:00.000Z'
      })
    })
    return true
  }
  if (path === '/runs/complete') {
    const { runToken } = route.request().postDataJSON() as { runToken: string }
    const mode = runToken.replace(/^run-/, '') as GameMode
    const season = {
      id: '2026-07',
      startsAt: '2026-07-06T08:00:00.000Z',
      endsAt: '2026-08-03T08:00:00.000Z',
      durationWeeks: 4
    }
    // No bearer token → a guest completion: scored but never recorded, so the
    // server returns the minimal guest shape with no progress fields.
    if (!route.request().headers()['authorization']) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true, guest: true, mode, score: 1, season })
      })
      return true
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: true,
        runId: runToken,
        mode,
        score: 1,
        season,
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
      body: `window.__tinylyticsEvents = [];
        document.addEventListener('click', (event) => {
          const node = event.target.closest?.('[data-tinylytics-event]');
          if (!node) return;
          window.__tinylyticsEvents.push({
            event: node.getAttribute('data-tinylytics-event'),
            value: node.getAttribute('data-tinylytics-event-value')
          });
        });`
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
      const params = new URL(route.request().url()).searchParams
      const mode = (params.get('mode') ?? 'surge') as GameMode
      const allTime = params.get('scope') === 'all-time'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          allTime
            ? {
                mode,
                scope: 'all-time',
                currentSeason: testSeason,
                entries: leaderboardEntries(mode)
              }
            : {
                mode,
                scope: 'season',
                seasonId: '2026-07',
                currentSeason: testSeason,
                entries: leaderboardEntries(mode)
              }
        )
      })
      return
    }
    if (path === '/activity') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testActivity) })
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

// Redesign: games auto-start (no "Start" button) — the keypad appears once the
// signed run is prepared and the 3-2-1 countdown finishes. This waits for that
// playing state on a keypad mode.
async function waitForKeypad(page: Page) {
  const keypad = page.locator('.pip-keypad')
  await expect(keypad).toBeVisible({ timeout: 12_000 })
  return keypad
}

async function completeSurge(page: Page) {
  await waitForKeypad(page)

  for (let index = 0; index < 15; index += 1) {
    const cardName = await page.locator('.pcard__img').getAttribute('alt')
    const card = cardsData.cards.find((candidate) => candidate.name === cardName)
    expect(card).toBeTruthy()
    await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()

    if (index < 14) {
      await expect(page.locator('.ed-game__progress')).toHaveText(`Card ${index + 2} / 15`)
    }
  }

  await expect(page.locator('.ed-sum')).toBeVisible()
}

function isDesktopViewport(viewport: { width: number; height: number } | null): boolean {
  return (viewport?.width ?? 0) >= 1024
}

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
    // The desktop right rail also polls /activity; keep it benign so the outage
    // banner (driven by /stats) is what the test observes.
    if (path === '/activity') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testActivity) })
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
  // Recovers in place: the Home surface renders (the Surge hero + PLAY button).
  await expect(page.locator('.ed-hero')).toBeVisible()
})

test('a signed-out visitor plays a game as a guest and is nudged to save the score', async ({ page }) => {
  // Hold the response long enough to inspect the in-flight guest state. Guest
  // runs are scored, never recorded, and must not cover the whole play surface.
  await page.route(`${testApiBaseUrl}/runs/complete`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.fallback()
  })

  // Guests are no longer redirected to sign in: they can open any game, and it
  // auto-starts (no "Start" button).
  await useSignedOutState(page, '/survival')
  await expect(page.getByRole('heading', { name: 'Sign in to play' })).toHaveCount(0)

  await waitForKeypad(page)
  // Survival ends on a single miss — a complete run for a guest.
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  const wrongCost = card?.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()

  const scoringNotice = page.locator('.run-recording')
  await expect(scoringNotice).toContainText('Scoring your game…')
  await expect(scoringNotice).not.toHaveClass(/run-recording--blocking/)
  await expect(page.getByText('Recording your game…')).toHaveCount(0)

  // The shared summary appears with the guest sign-in-to-save nudge.
  const summary = page.locator('.ed-sum')
  await expect(summary).toBeVisible()
  await expect(summary.getByRole('button', { name: 'Play again' })).toBeVisible()
  await expect(page.getByText('Create an account to save this score to the leaderboard — forever.')).toBeVisible()
  await summary.getByRole('button', { name: 'Sign in to save' }).click()
  await expect(page).toHaveURL(/#\/login$/)
})

test('signing in from the login screen returns the player to the requested game', async ({ page }) => {
  await useSignedOutState(page, '/login?returnTo=%2Fsurge')

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
    if (await fulfillSupportData(route)) return
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
  await expect(page).toHaveURL(/#\/surge$/)
  // The requested game opens and auto-starts.
  await waitForKeypad(page)
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
    if (await fulfillTestRun(route)) return
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456&returnTo=%2Fsurge')
  await page.getByRole('button', { name: 'Continue to Drop' }).click()
  await expect(page).toHaveURL(/#\/profile\?returnTo=%2Fsurge$/)
  // The identity editor (redesign) opens straight into setup for a new player.
  await expect(page.getByText('Choose a favorite card and generated name to continue')).toBeVisible()

  const favoriteCards = page.locator('.favorite-card-grid')
  // The grid caps at 60 cards, so narrow to the Knight before selecting it.
  await page.getByPlaceholder('Search cards').fill('Knight')
  await favoriteCards.getByRole('button', { name: 'Knight', exact: true }).click()
  await page.getByRole('button', { name: 'Get name ideas' }).click()
  await page.getByRole('button', { name: 'Knight Main', exact: true }).click()

  await expect(page).toHaveURL(/#\/surge$/)
  await expect
    .poll(() => savedIdentity)
    .toEqual({ favoriteCardId: 26000000, publicName: 'Knight Main', nameToken: 'name-token' })
  // With the identity saved, the requested game opens and auto-starts.
  await waitForKeypad(page)
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
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/surge')
  await expect(page.getByRole('heading', { name: 'This game could not start' })).toBeVisible()
  await expect(page.locator('.pip-keypad')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try again' }).click()
  // The recovered run prepares, auto-starts, and the keypad becomes available.
  await waitForKeypad(page)
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
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/surge')
  await expect(page.getByText('Drop received an invalid signed Surge challenge.')).toBeVisible()
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
    if (await fulfillSupportData(route)) return
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
    if (path === '/runs/complete' && completionAttempts++ === 0) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Try again.' } })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/survival')
  await waitForKeypad(page)
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
    if (path === '/runs/complete') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'invalid_request', message: 'Card order is invalid.' } })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/survival')
  await waitForKeypad(page)
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  const wrongCost = card?.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()

  await expect(page.getByText('This game could not be verified and was not recorded.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry recording' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('This game could not be verified and was not recorded.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()
})

test('account deletion requires typed confirmation and clears the saved session', async ({ page, viewport }) => {
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
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/profile')
  // Delete-account now lives inside the profile editor (redesign).
  await page.locator('.ed-profile__edit').click()
  await page.getByRole('button', { name: 'Delete account' }).click()
  const confirmDelete = page.getByRole('button', { name: 'Permanently delete account' })
  await expect(confirmDelete).toBeDisabled()
  await page.getByLabel('Type DELETE to confirm').fill('delete')
  await expect(confirmDelete).toBeDisabled()
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  await confirmDelete.click()

  const home = isDesktopViewport(viewport) ? '.ed-home-d' : '.ed-home'
  await expect(page.locator(home)).toBeVisible()
  expect(deletionBody).toEqual({ confirmation: 'DELETE' })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('elixirdrop:session:v1'))).toBeNull()
})

test('the profile is reachable from the shell and shows Player XP', async ({ page, viewport }) => {
  await page.goto('/')
  // Both shells expose a profile entry point; the XP itself now lives on the
  // profile (the old nav player-block XP chrome is gone).
  if (isDesktopViewport(viewport)) {
    await page.locator('.ed-rail-chip').first().click()
  } else {
    await page.locator('.ed-idchip').click()
  }

  await expect(page.locator('.profile-xp')).toContainText('Player XP')
  await expect(page.locator('.profile-xp')).toContainText('480')
})

test('the desktop rail launches the Falling Cards screensaver', async ({ page, viewport }) => {
  test.skip(!isDesktopViewport(viewport), 'the visible screensaver launcher is a desktop-rail control')
  await page.goto('/')

  const launcher = page.getByRole('button', { name: 'Falling Cards' })
  await expect(launcher).toBeVisible()
  await launcher.click()

  const overlay = page.getByTestId('screensaver')
  await expect(overlay).toBeVisible()
  // Any input dismisses the screensaver; the Escape key lands as a keydown exit
  // (the overlay traps focus so the capture-phase handler catches it).
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
})

test('higher/lower: tap the higher card; a miss resets the streak', async ({ page }) => {
  await page.goto('/#/higher-lower')
  await expect(page.locator('.ed-duel')).toBeVisible()
  // Low chrome + effects present, like the other running modes.
  await expect(page.locator('.game-motion')).toBeVisible()
  await expect(page.locator('.game-fx-layer')).toHaveCount(1)
  await expect(page.locator('.site-foot')).toHaveCount(0)

  // Wait for play to begin (the streak metric renders once the countdown ends).
  await expect(page.locator('.ed-game__metric').first()).toBeVisible({ timeout: 12_000 })

  // Index (0 = left, 1 = right) of the higher-cost card, read from the two
  // rendered card names.
  const higherIndex = async () => {
    const names = await page
      .locator('.ed-duel__card .pcard__img')
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt')))
    const costs = names.map((name) => cardsData.cards.find((card) => card.name === name)?.elixir ?? 0)
    return costs[0]! > costs[1]! ? 0 : 1
  }

  // Tap the higher card → correct, streak advances to 1.
  await page
    .locator('.ed-duel__card')
    .nth(await higherIndex())
    .click()
  await expect(page.locator('.ed-duel__card--correct')).toBeVisible()
  await expect(page.locator('.ed-game__metric').first()).toHaveText('1')

  // Next round: tap the lower card → miss, streak resets to 0.
  await page.waitForTimeout(900)
  const lower = (await higherIndex()) === 0 ? 1 : 0
  await page.locator('.ed-duel__card').nth(lower).click()
  await expect(page.locator('.ed-duel__card--wrong')).toBeVisible()
  await expect(page.locator('.ed-game__metric').first()).toHaveText('0')
})

test('higher/lower stacks both choices vertically on every shell', async ({ page }) => {
  await page.goto('/#/higher-lower')
  const choices = page.locator('.ed-duel__card')
  await expect(choices).toHaveCount(2)
  await expect(choices.first()).toBeVisible()

  const bounds = await choices.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left }
    })
  )
  expect(bounds[1]!.top).toBeGreaterThan(bounds[0]!.bottom)
  expect(Math.abs(bounds[1]!.left - bounds[0]!.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(bounds[1]!.right - bounds[0]!.right)).toBeLessThanOrEqual(1)
})

test('higher/lower: running out the clock ends the round', async ({ page }) => {
  await page.goto('/#/higher-lower')
  await expect(page.locator('.ed-duel')).toBeVisible()
  // Never tap — the opening window (after the 3-2-1) runs out and the timeout
  // reveals the round (the lower card, auto-picked on timeout, is flagged wrong).
  await expect(page.locator('.ed-duel__card--wrong')).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.ed-duel__card--correct')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()
})

test('higher/lower records once, then waits for an explicit replay while idle', async ({ page }) => {
  let startRequests = 0
  let completionRequests = 0
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === '/runs/start') startRequests += 1
    if (path === '/runs/complete') completionRequests += 1
  })

  await page.goto('/#/higher-lower')
  const cards = page.locator('.ed-duel__card')
  await expect(cards.first()).toBeEnabled({ timeout: 12_000 })

  const names = await cards.locator('.pcard__img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt')))
  const costs = names.map((name) => cardsData.cards.find((card) => card.name === name)?.elixir ?? 0)
  const lowerIndex = costs[0]! < costs[1]! ? 0 : 1
  await cards.nth(lowerIndex).click()

  const replay = page.getByRole('button', { name: 'Play again' })
  await expect(replay).toBeVisible({ timeout: 8_000 })
  await expect.poll(() => completionRequests).toBe(1)
  expect(startRequests).toBe(1)

  // The old behavior prepared and timed out another signed run every ~6s.
  // Staying idle must leave both network counts unchanged.
  await page.waitForTimeout(6_500)
  expect(completionRequests).toBe(1)
  expect(startRequests).toBe(1)

  await replay.click()
  await expect.poll(() => startRequests).toBe(2)
  await expect(replay).toHaveCount(0)
  await expect(cards.first()).toBeEnabled({ timeout: 12_000 })
})

test('home surfaces season standings and a personal Surge best', async ({ page, viewport }, testInfo) => {
  await page.goto('/')

  if (isDesktopViewport(viewport)) {
    await expect(page.locator('.ed-home-d')).toBeVisible()
    // Season standings live in the desktop right rail.
    await expect(page.locator('.ed-rail-standings')).toContainText('Royal Ghosted')
    await expect(page.locator('.ed-rail-standings')).toContainText('You')
    // Repeated activity is grouped into one recent-runs row.
    await expect(page.locator('.ed-rail-live__head')).toContainText('Recent runs')
    await expect(page.locator('.ed-rail-live')).toContainText('Trade · 8 runs · best 11.80s')
    await expect(page.locator('.ed-rail-live__dot')).toHaveCount(0)
  } else {
    await expect(page.locator('.ed-home')).toBeVisible()
    // Season standings surface as the mobile peek.
    await expect(page.locator('.ed-standpeek')).toContainText('Royal Ghosted')
    await expect(page.locator('.ed-standpeek')).toContainText('You')
  }

  // The player's Surge best (from recent runs) leads the hero.
  await expect(page.locator('.ed-hero__best-val')).toContainText('67.30s')

  await testInfo.attach('home.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
})

test('mobile install suggestion waits until the third browser session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const makeInstallable = () =>
    page.evaluate(() => {
      const event = new Event('beforeinstallprompt') as Event & {
        prompt: () => Promise<void>
        userChoice: Promise<{ outcome: 'accepted' }>
      }
      event.prompt = () => Promise.resolve()
      event.userChoice = Promise.resolve({ outcome: 'accepted' })
      window.dispatchEvent(event)
    })

  await makeInstallable()
  await expect(page.locator('.ed-installbar')).toHaveCount(0)
  await expect(page.locator('.ed-installrow')).toHaveCount(0)

  await page.evaluate(() => {
    localStorage.setItem('elixirdrop:installSessionCount', '2')
    sessionStorage.removeItem('elixirdrop:installSessionCounted')
  })
  await page.reload()
  // The app records the new session and installs the browser prompt listener
  // from the same effect. Wait for that initialization boundary before firing
  // the synthetic event; dispatching immediately after `load` can race Preact's
  // effect flush in fast Chromium runs.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('elixirdrop:installSessionCount'))).toBe('3')
  await makeInstallable()

  await expect(page.locator('.ed-installbar')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __tinylyticsEvents?: Array<{ event: string }> }).__tinylyticsEvents?.some(
          (entry) => entry.event === 'install.suggestion_shown'
        )
      )
    )
    .toBe(true)
})

test('Tinylytics stays off the token route and captures normalized game events', async ({ page }) => {
  const collectorRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://tinylytics.app/embed/')) collectorRequests.push(request.url())
  })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456')
  await expect(page.getByRole('button', { name: 'Continue to Drop' })).toBeVisible()
  expect(collectorRequests).toEqual([])

  await page.getByRole('button', { name: 'Continue to Drop' }).click()
  await expect(page).toHaveURL(/#\/profile/)
  await expect.poll(() => collectorRequests.length).toBe(1)
  expect(collectorRequests[0]).toContain('/min.js?spa&events&beacon')

  await page.goto('/#/surge')
  await waitForKeypad(page)
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __tinylyticsEvents?: Array<{ event: string; value: string }> }
        ).__tinylyticsEvents?.some((entry) => entry.event === 'game.started' && entry.value === 'surge')
      )
    )
    .toBe(true)
})

const a11yRoutes = [
  { hash: '#/', label: 'Home', ready: '.ed-home, .ed-home-d' },
  { hash: '#/about', label: 'About', ready: '.ed-page' },
  { hash: '#/faq', label: 'FAQ', ready: '.ed-page' },
  { hash: '#/practice', label: 'Practice', ready: '.ed-game' },
  { hash: '#/surge', label: 'Surge', ready: '.ed-game' },
  { hash: '#/higher-lower', label: 'Higher / Lower', ready: '.ed-game' },
  { hash: '#/trade', label: 'Trade', ready: '.ed-game' },
  { hash: '#/survival', label: 'Survival', ready: '.ed-game' },
  { hash: '#/rain', label: 'Rain', ready: '.ed-game' },
  { hash: '#/leaderboards', label: 'Leaderboards', ready: '.ed-board' },
  { hash: '#/profile', label: 'Profile', ready: '.ed-profile' },
  { hash: '#/settings', label: 'Settings', ready: '.settings__card' },
  { hash: '#/privacy', label: 'Privacy', ready: '.ed-page--privacy' }
]

test('About, FAQ, and Privacy share one stable responsive page layout', async ({ page, viewport }) => {
  const routes = [
    { hash: 'about', title: 'About Elixir Drop' },
    { hash: 'faq', title: 'Frequently asked' },
    { hash: 'privacy', title: 'What Drop keeps—and why' }
  ] as const
  let referencePage: { left: number; width: number } | null = null

  for (const meta of routes) {
    await page.goto(`/#/${meta.hash}`)
    const pageSurface = page.locator('.ed-page')
    await expect(pageSurface).toBeVisible()
    await expect(pageSurface.getByRole('heading', { name: meta.title, exact: true })).toBeVisible()
    await expect(pageSurface.locator('.ed-meta-section')).not.toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-vite-error-overlay')

    const box = await pageSurface.boundingBox()
    expect(box).not.toBeNull()
    if (referencePage) {
      expect(Math.abs(box!.x - referencePage.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(box!.width - referencePage.width)).toBeLessThanOrEqual(1)
    } else {
      referencePage = { left: box!.x, width: box!.width }
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflow).toBe(false)

    if (isDesktopViewport(viewport)) {
      await expect(page.locator('.ed-rail__foot')).toBeVisible()
      const shell = await page.locator('.ed-desktop').evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        viewportHeight: document.documentElement.clientHeight,
        documentScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight
      }))
      expect(Math.abs(shell.height - shell.viewportHeight)).toBeLessThanOrEqual(1)
      expect(shell.documentScrolls).toBe(false)

      const linkTops = await page
        .locator('.ed-railfoot__link')
        .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().top)))
      expect(Math.max(...linkTops) - Math.min(...linkTops)).toBeLessThanOrEqual(3)
    } else {
      await expect(page.locator('.ed-desktop')).toHaveCount(0)
    }
  }

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/\/#\/faq$/)
  await expect(page.getByRole('heading', { name: 'Frequently asked', exact: true })).toBeVisible()
})

for (const route of a11yRoutes) {
  test(`renders ${route.label} without serious accessibility issues`, async ({ page }, testInfo) => {
    await page.goto('/')
    await page.goto(`/${route.hash}`)
    await expect(page.locator(route.ready).first()).toBeVisible({ timeout: 12_000 })

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
  await waitForKeypad(page)

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

test('surge summary shows cost accuracy bars without a recruitment callout', async ({ page }, testInfo) => {
  await page.goto('/#/surge')
  await completeSurge(page)

  const chart = page.locator('.ed-sum-bands')
  await expect(chart).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()
  await expect(page.getByText('Join the Elixir Drop Discord')).toHaveCount(0)
  await expect(page.locator('.recruit')).toHaveCount(0)

  const barHeights = await chart
    .locator('.ed-sum-band__bar')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  expect(barHeights).toHaveLength(5)
  expect(barHeights.every((height) => height > 0)).toBe(true)

  const fillHeights = await chart
    .locator('.ed-sum-band__fill')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  expect(fillHeights.some((height) => height > 0)).toBe(true)

  await testInfo.attach('surge-summary.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
})

test('surge runtime cues drive card motion and the optional effects canvas', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium provides the stable WebGL test surface for Pixi effects.')

  await page.goto('/#/surge')
  await waitForKeypad(page)

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
  await waitForKeypad(page)

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
    { hash: '#/surge', control: '.pip-keypad' },
    { hash: '#/survival', control: '.pip-keypad' },
    { hash: '#/trade', control: '.ed-trade__pad' }
  ]

  for (const mode of activeModes) {
    await page.goto('/')
    await page.goto(`/${mode.hash}`)
    // Game routes render the play area full-bleed — the footer never mounts.
    await expect(page.locator('.site-foot')).toHaveCount(0)

    await expect(page.locator(mode.control)).toBeVisible({ timeout: 12_000 })
    await expect(page.locator('.ed-game')).toBeVisible()
    await expect(page.locator('.game-motion')).toBeVisible()
    await expect(page.locator('.game-fx-layer')).toHaveCount(1)
    if (testInfo.project.name === 'chromium') {
      await expect(page.locator('.game-fx-layer canvas')).toHaveCount(1)
    }

    if (mode.hash === '#/surge') {
      const artChrome = await page
        .locator('.cr-card-art')
        .first()
        .evaluate((element) => ({
          before: getComputedStyle(element, '::before').content,
          after: getComputedStyle(element, '::after').content
        }))
      const cardPanel = await page
        .locator('.pcard')
        .first()
        .evaluate((element) => {
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

    await expect(page.locator('.ed-game')).toBeVisible({ timeout: 12_000 })
    await expect(page.locator(mode.control)).toBeVisible()
    await expect(page.locator('.game-motion')).toBeVisible()
    await expect(page.locator('.game-fx-layer')).toHaveCount(1)
    if (testInfo.project.name === 'chromium') {
      await expect(page.locator('.game-fx-layer canvas')).toHaveCount(1)
    }
    await expect(page.locator('.site-foot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: mode.answer, exact: true })).toBeEnabled()

    await testInfo.attach(`${mode.hash.slice(2)}-running.png`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    })
    await page.getByRole('button', { name: mode.answer, exact: true }).click()
  }
})

test('practice uses Surge feedback and keeps a missed card active until solved', async ({ page }, testInfo) => {
  await page.goto('/#/practice')
  await waitForKeypad(page)

  const motion = page.locator('.game-motion')
  await expect(motion).toHaveClass(/game-motion--card/)
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  expect(card!.elixir).toBeGreaterThan(1)
  expect(card!.elixir).toBeLessThan(9)

  await page.getByRole('button', { name: `${card!.elixir - 1} elixir`, exact: true }).click()
  await expect(page.getByTestId('practice-hint')).toContainText('Higher')
  await expect(page.locator('.ed-game__progress')).toHaveText('Card 1 / 15')
  await expect(page.locator('.pcard__cost')).toHaveCount(0)
  await expect(page.locator('.pcard__img')).toHaveAttribute('alt', card!.name)

  await expect(page.getByRole('button', { name: `${card!.elixir + 1} elixir`, exact: true })).toBeEnabled()
  await page.getByRole('button', { name: `${card!.elixir + 1} elixir`, exact: true }).click()
  await expect(page.getByTestId('practice-hint')).toContainText('Lower')
  await expect(page.locator('.ed-game__progress')).toHaveText('Card 1 / 15')
  await expect(page.locator('.pcard__img')).toHaveAttribute('alt', card!.name)

  await testInfo.attach('practice-wrong-feedback.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })

  await expect(page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true })).toBeEnabled()
  await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
  const feedback = await motion.evaluate((element) => ({
    className: element.className,
    phaseClass: element.querySelector('.pcard')?.className,
    costBadges: element.querySelectorAll('.pcard__cost').length,
    purpleDrops: element.querySelectorAll('.drop-pop-wrap').length
  }))
  expect(feedback.className).toContain('game-motion--card')
  expect(feedback.phaseClass).toContain('pcard')
  expect(feedback.costBadges).toBe(0)
  expect(feedback.purpleDrops).toBe(0)

  await testInfo.attach('practice-correct-motion.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
  await expect(page.locator('.ed-game__progress')).toHaveText('Card 2 / 15')
})

test('card art fallback renders when card images cannot load', async ({ page }) => {
  allowBlockedAssets.add(page)
  // Card art is mirrored same-origin under /cards/; block that path.
  await page.route('**/cards/*.png', (route) => route.abort())
  await page.goto('/')
  await page.goto('/#/practice')
  await expect(page.locator('.pcard__fallback')).toBeVisible({ timeout: 12_000 })
})

test('five logo taps start the screensaver and any key exits it', async ({ page, isMobile }) => {
  // The redesign's logo-tap door is the mobile "More games" title (there is no
  // tapped hero logo on desktop — desktop uses the visible "Falling Cards" rail
  // launcher instead, covered above).
  test.skip(!isMobile, 'the logo-tap screensaver door exists on the mobile shell')
  await page.goto('/')
  const logo = page.locator('.ed-more__title')
  await expect(logo).toBeVisible()
  for (let tap = 0; tap < 5; tap += 1) await logo.click()

  const overlay = page.getByTestId('screensaver')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('role', 'dialog')
  const axe = await new AxeBuilder({ page }).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  // Any input dismisses the screensaver — the Escape key lands as a keydown exit
  // (the overlay traps focus, so the key is caught in the capture phase).
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
  await expect(page.locator('.ed-home')).toBeVisible()
})

test('the meta entry points link to the Elixir Drop Discord', async ({ page, viewport }) => {
  // The old global footer moved into the meta entry points: the desktop
  // left-rail cluster, and the mobile Profile → More list.
  const desktop = isDesktopViewport(viewport)
  if (desktop) {
    await page.goto('/')
  } else {
    await page.goto('/#/profile')
  }

  const scope = desktop ? '.ed-railfoot' : '.ed-morelist'
  const discord = page.locator(`${scope} a`, { hasText: 'Discord' })
  await expect(discord).toBeVisible()
  await expect(discord).toHaveAttribute('href', 'https://discord.gg/SdvKfJW5kA')
  await expect(discord).toHaveAttribute('target', '_blank')
  await expect(discord).toHaveAttribute('rel', 'noopener noreferrer')
})

test('trade runs eight exchanges with one cost hint per wrong guess', async ({ page }) => {
  await page.goto('/#/trade')
  const teams = page.locator('.ed-trade__teams')
  await expect(teams).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.ed-trade__pad')).toBeVisible()

  const readSideIds = async (selector: string) =>
    page
      .locator(`${selector} [data-card-id]`)
      .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
  const total = (ids: number[]) => ids.reduce((sum, id) => sum + (cardsById.get(id)?.elixir ?? 0), 0)
  const answers = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
  const format = (value: number) => (value === 0 ? 'Even trade' : `${value > 0 ? `+${value}` : value} trade`)
  const seenIds: number[] = []

  for (let trade = 1; trade <= 8; trade += 1) {
    await expect(teams).toHaveAttribute('data-trade-index', String(trade))
    const blueIds = await readSideIds('.ed-trade__team--blue')
    const redIds = await readSideIds('.ed-trade__team--red')
    const roundIds = [...blueIds, ...redIds]
    expect(new Set(roundIds).size).toBe(roundIds.length)
    seenIds.push(...roundIds)

    const answer = total(redIds) - total(blueIds)
    expect(answer).toBeGreaterThanOrEqual(-4)
    expect(answer).toBeLessThanOrEqual(4)

    if (trade === 1) {
      const wrong = answers.find((value) => value !== answer)
      expect(wrong).toBeDefined()
      await expect(page.locator('.ed-trade__card-cost')).toHaveCount(0)
      await page.getByRole('button', { name: format(wrong!) }).click()
      await expect(page.getByTestId('trade-hint')).toContainText('Cost revealed')
      await expect(page.locator('.ed-trade__card-cost')).toHaveCount(1)
    }

    await expect(page.getByRole('button', { name: format(answer) })).toBeEnabled()
    await page.getByRole('button', { name: format(answer) }).click()

    if (trade < 8) {
      await page.waitForFunction(
        (expected) => document.querySelector('.ed-trade__teams')?.getAttribute('data-trade-index') === String(expected),
        trade + 1
      )
    }
  }

  // The Trade summary is now the shared summary card.
  await expect(page.locator('.ed-sum')).toBeVisible()
  await expect(page.getByText('Trade complete')).toBeVisible()
  expect(new Set(seenIds).size).toBe(seenIds.length)
})

test.describe('mobile primary navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps home and game content below the installed-app status bar', async ({ page }) => {
    // Desktop browser engines report a zero safe-area inset, so override the
    // shell token with a representative modern-iPhone inset for regression QA.
    const applyTestSafeArea = () =>
      page.evaluate(() => document.documentElement.style.setProperty('--ed-safe-area-top', '47px'))
    await useSignedOutState(page)
    await applyTestSafeArea()

    await expect(page.locator('.ed-mobile')).toHaveCSS('padding-top', '47px')
    const identityTop = await page.locator('.ed-idchip').evaluate((element) => element.getBoundingClientRect().top)
    expect(identityTop).toBeGreaterThanOrEqual(53)

    await page.goto('/?signedOut=1#/surge')
    await applyTestSafeArea()
    await waitForKeypad(page)
    const gameTop = await page.locator('.ed-game').evaluate((element) => element.getBoundingClientRect().top)
    expect(gameTop).toBeGreaterThanOrEqual(47)
  })

  test('shows the bottom pill nav without a header or horizontal overflow', async ({ page }) => {
    await useSignedOutState(page)

    // The mobile shell drops the old site header entirely for a bottom pill nav.
    await expect(page.locator('.site-head')).toHaveCount(0)
    const nav = page.locator('.ed-pillnav')
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Games' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Ranks' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'You' })).toBeVisible()
    await expect(nav.locator('.ed-pillnav__ind')).toHaveCSS(
      'background-image',
      'linear-gradient(135deg, rgb(245, 200, 76), rgb(201, 140, 16))'
    )
    await expect(nav.getByRole('button', { name: 'Games' })).toHaveCSS('color', 'rgb(42, 21, 0)')

    const pageHasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    expect(pageHasHorizontalOverflow).toBe(false)
  })
})

test.describe('mobile timed-mode controls', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true })

  test('keeps every timed keypad in the first viewport', async ({ page }) => {
    for (const hash of ['#/surge', '#/survival']) {
      await page.goto(`/${hash}`)
      const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
      await expect(keypad).toBeVisible({ timeout: 12_000 })

      const controlsFit = await keypad.evaluate((element) => {
        const buttons = [...element.querySelectorAll('button')]
        return buttons.every((button) => button.getBoundingClientRect().bottom <= window.innerHeight + 1)
      })
      expect(controlsFit).toBe(true)
    }
  })

  // Practice is untimed (no countdown), but pairs a full card with the same
  // keypad — its bottom row must not fall off the first viewport either.
  test('keeps the Practice keypad in the first viewport', async ({ page }) => {
    await page.goto('/#/practice')
    const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
    await expect(keypad).toBeVisible({ timeout: 12_000 })

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

  test('keeps the entire Surge keypad in view', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the low-height desktop shell has dedicated viewport coverage')
    await page.goto('/#/surge')
    const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
    await expect(keypad).toBeVisible({ timeout: 12_000 })

    const controlsFit = await keypad.evaluate((element) =>
      [...element.querySelectorAll('button')].every((button) => {
        const bounds = button.getBoundingClientRect()
        return bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1
      })
    )
    expect(controlsFit).toBe(true)
  })

  test('keeps the Higher / Lower replay action in view', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the low-height desktop shell has dedicated viewport coverage')
    await page.goto('/#/higher-lower')
    const replay = page.getByRole('button', { name: 'Play again' })
    await expect(replay).toBeVisible({ timeout: 12_000 })
    const bounds = await replay.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(721)

    const notice = page.locator('.run-recording__card--saved')
    if (await notice.isVisible()) {
      const noticeBounds = await notice.boundingBox()
      expect(noticeBounds).not.toBeNull()
      const overlaps =
        bounds!.x < noticeBounds!.x + noticeBounds!.width &&
        bounds!.x + bounds!.width > noticeBounds!.x &&
        bounds!.y < noticeBounds!.y + noticeBounds!.height &&
        bounds!.y + bounds!.height > noticeBounds!.y
      expect(overlaps).toBe(false)
    }
  })
})

test('settings persist input and motion preferences across reload', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '4 choices' }).click()
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('button', { name: '4 choices' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)
  await expect(page.getByLabel('Build information')).toContainText('Build ID')
  await expect(page.getByLabel('Build information')).toContainText('Build date')
})

test('leaderboards are season-scoped, not week-scoped', async ({ page }) => {
  await page.goto('/#/leaderboards')

  await expect(page.getByRole('heading', { name: 'Season 134 leaderboards' })).toBeVisible()
  await expect(page.locator('.ed-board__timing')).toContainText(
    'Season ends August 3 at 10:00 UTC — new boards open then'
  )
  // The Clan-Wars weekly clock must not appear on the season board.
  await expect(page.locator('.ed-board__timing')).not.toContainText('left in week')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')
  await expect(page.locator('.ed-lbrow--you')).toContainText('You')
  await expect(page.locator('.ed-board__list')).toContainText('XP')

  // Switch the per-mode tab to Survival.
  await page.locator('.ed-board__modes').getByRole('button', { name: 'Survival' }).click()
  await expect(page.locator('.ed-modetab--active')).toContainText('Survival')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')

  // Toggling to All-time switches the board to the best-ever heading and drops
  // the season-reset line, while the ranked player rows still render.
  await page.getByRole('button', { name: 'All-time' }).click()
  await expect(page.getByRole('heading', { name: 'All-time leaderboards' })).toBeVisible()
  await expect(page.locator('.ed-board__timing')).not.toContainText('new boards open then')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')

  // And back to Season restores the season heading.
  await page.getByRole('button', { name: 'Season', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Season 134 leaderboards' })).toBeVisible()
})

test('an empty leaderboard offers a play call-to-action', async ({ page }) => {
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/refresh') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (url.pathname === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (url.pathname === '/leaderboards') {
      const mode = (url.searchParams.get('mode') ?? 'surge') as GameMode
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode, scope: 'season', seasonId: testSeason.id, currentSeason: testSeason, entries: [] })
      })
      return
    }
    if (url.pathname === '/activity') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ seasonId: '2026-07', entries: [] })
      })
      return
    }
    if (url.pathname === '/stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/leaderboards')
  await expect(page.locator('.ed-board__empty')).toContainText('No scores yet.')
  await expect(page.getByRole('button', { name: /Play Surge/ })).toBeVisible()
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
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await page.addInitScript((storedSession) => {
    localStorage.setItem('elixirdrop:session:v1', JSON.stringify(storedSession))
  }, session)

  await page.goto('/#/profile')
  // The player tag now lives in the profile editor.
  await page.locator('.ed-profile__edit').click()
  const tagInput = page.getByPlaceholder('#PLAYER_TAG')
  await expect(tagInput).toBeVisible()
  await tagInput.fill('20JJJ2CCRU')
  await page.getByRole('button', { name: 'Save tag' }).click()
  // Return to the profile view, where the resolved CR profile renders.
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByRole('heading', { name: 'King Thing' })).toBeVisible({ timeout: 8_000 })
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
