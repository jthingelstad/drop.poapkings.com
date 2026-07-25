import type { Page, Route } from '@playwright/test'
import { test as base, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { GameMode, RunChallenge } from '@elixir-drop/contracts'
import type { CardsData } from '../../src/types'

export const cardsData = JSON.parse(
  readFileSync(new URL('../../../../packages/game-data/cards.json', import.meta.url), 'utf8')
) as CardsData
export const cardsById = new Map(cardsData.cards.map((card) => [card.id, card]))
export const testSession = { token: 'session-token', expiresAt: '2099-01-01T00:00:00.000Z' }
export const testApiBaseUrl = 'https://fhmql8x10m.execute-api.us-east-1.amazonaws.com'
export const testApiRoute = `${testApiBaseUrl}/**`
export const testSeason = {
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
export const testStats = { trophyRoadGames: 592, currentSeason: testSeason }
export const testPlayer = {
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
export const testRecentRuns = [
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

export function leaderboardEntries(mode: GameMode) {
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
export const testActivity = {
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

function publicPlayerResponse(playerId: string) {
  const summaries = [...leaderboardEntries('surge').map((entry) => entry.player), testActivity.entries[0]!.player]
  const summary = summaries.find((candidate) => candidate.id === playerId)
  if (!summary) return null
  return {
    player: {
      ...summary,
      levelStartGames: Math.max(0, summary.totalGames - 10),
      nextLevelGames: summary.totalGames + 15
    },
    recentRuns: testRecentRuns
  }
}

// The two shells both mount read-only surfaces that hit the API on every route:
// the desktop right rail (GET /leaderboards + GET /activity) and Home
// (GET /stats + per-mode /leaderboards). Any override test that navigates on the
// desktop viewport must answer these or the browser logs a failed-fetch console
// error that the afterEach guard treats as a failure. Tests that handle a path
// with their own behavior match it first; this only backstops the rest.
export async function fulfillSupportData(route: Route): Promise<boolean> {
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
  if (path.startsWith('/players/')) {
    const profile = publicPlayerResponse(decodeURIComponent(path.slice('/players/'.length)))
    await route.fulfill({
      status: profile ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(profile ?? { error: { code: 'player_not_found', message: 'Player profile was not found.' } })
    })
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
      return { mode, cardIds: sequence(15) }
    case 'practice':
      // Practice is endless: the signed deck is the whole catalog used as a
      // pool, which the client draws from weighted by the player's weak cards.
      return { mode, cardIds: [...ids] }
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

export async function fulfillTestRun(route: Route): Promise<boolean> {
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

export const allowBlockedAssets = new WeakSet<Page>()
export const allowExpectedApiErrors = new WeakSet<Page>()

// Every spec imports this `test`: the overridden `page` fixture installs the
// shared analytics/API mocks before the test navigates, and the teardown half
// replaces the old global afterEach console-error guard. Keeping it on the
// fixture (instead of module-level hooks) is what lets the suite live in many
// files — hooks declared in an imported module would only attach to whichever
// file happened to load it first.
export const test = base.extend({
  // `provide` is Playwright's `use` callback, renamed so the lint rule that
  // guards React hook naming does not read it as a misplaced hook call.
  page: async ({ page }, provide) => {
    const errors: string[] = []
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
    await page.route('https://tinylytics.app/collector/**', (route) => route.fulfill({ status: 204 }))
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
      if (path.startsWith('/players/')) {
        const profile = publicPlayerResponse(decodeURIComponent(path.slice('/players/'.length)))
        await route.fulfill({
          status: profile ? 200 : 404,
          contentType: 'application/json',
          body: JSON.stringify(
            profile ?? { error: { code: 'player_not_found', message: 'Player profile was not found.' } }
          )
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

    await provide(page)

    await page.close()
    expect(errors).toEqual([])
  }
})

export { expect }

export async function useSignedOutState(page: Page, hash = '/'): Promise<void> {
  await page.goto(`/?signedOut=1#${hash}`)
}

// Redesign: games auto-start (no "Start" button) — the keypad appears once the
// signed run is prepared and the 3-2-1 countdown finishes. This waits for that
// playing state on a keypad mode.
export async function waitForKeypad(page: Page) {
  const keypad = page.locator('.pip-keypad')
  await expect(keypad).toBeVisible({ timeout: 12_000 })
  return keypad
}

export async function completeSurge(page: Page) {
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

export function isDesktopViewport(viewport: { width: number; height: number } | null): boolean {
  return (viewport?.width ?? 0) >= 1024
}
