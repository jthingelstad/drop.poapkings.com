import type { Page, Route } from '@playwright/test'
import { test as base, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { playerReference, runReference, TRADE_LADDER, type GameMode, type RunChallenge } from '@elixir-drop/contracts'
import type { CardsData } from '../../src/types'

export const cardsData = JSON.parse(
  readFileSync(new URL('../../../../packages/game-data/cards.json', import.meta.url), 'utf8')
) as CardsData
export const cardsById = new Map(cardsData.cards.map((card) => [card.id, card]))
export const testSession = { token: 'session-token', expiresAt: '2099-01-01T00:00:00.000Z' }
// Keep browser tests fully local. A production-shaped cross-origin base makes
// WebKit apply CORS to fulfilled Playwright routes under parallel load even
// though no request reaches AWS.
export const testApiBaseUrl = 'http://127.0.0.1:5173'
export const testApiRoute =
  /^http:\/\/127\.0\.0\.1:5173\/(?:(?:activity|auth|leaderboards|me|players|practice|run-reports|runs|shares|stats)(?:[/?]|$)|badges\/[^/?]+\/share(?:[/?]|$))/
export const testSeason = {
  id: 134,
  startsAt: '2026-07-06T10:00:00.000Z',
  endsAt: '2026-08-03T10:00:00.000Z',
  durationWeeks: 4,
  source: 'clash-royale',
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
  playerTag: '#20JJJ2CCRU',
  clashRoyale: {
    tag: '#20JJJ2CCRU',
    status: 'ready' as const,
    name: 'King Thing',
    clan: { tag: '#J2RGCRVG', name: 'POAP KINGS', badgeId: 16000000, role: 'leader' }
  },
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
    seasonId: 134,
    completedAt: '2026-07-18T18:42:00.000Z',
    reviewStatus: 'pending',
    placement: 2
  },
  {
    runId: 'recent-trade',
    mode: 'trade',
    score: 11_800,
    seasonId: 134,
    completedAt: '2026-07-17T20:00:00.000Z',
    reviewStatus: 'excluded',
    reviewExplanation: 'This run was excluded because its recorded response timing was not consistent with human play.'
  },
  {
    runId: 'recent-practice',
    mode: 'practice',
    score: 64,
    seasonId: 134,
    completedAt: '2026-07-16T20:00:00.000Z'
  }
] as const
export const testXpTimeline = {
  totalXp: 480,
  attributedXp: 380,
  openingBalance: 100,
  timeZone: 'UTC' as const,
  days: [
    {
      date: '2026-07-18',
      xp: 140,
      events: 5,
      sources: [
        { source: 'game' as const, xp: 100, events: 2 },
        { source: 'personal-best' as const, xp: 10, events: 1 },
        { source: 'badge' as const, xp: 30, events: 2 }
      ]
    },
    {
      date: '2026-07-17',
      xp: 125,
      events: 3,
      sources: [
        { source: 'game' as const, xp: 100, events: 1 },
        { source: 'daily-featured' as const, xp: 5, events: 1 },
        { source: 'badge' as const, xp: 20, events: 1 }
      ]
    },
    {
      date: '2026-07-16',
      xp: 115,
      events: 2,
      sources: [
        { source: 'practice' as const, xp: 15, events: 1 },
        { source: 'season-circuit' as const, xp: 100, events: 1 }
      ]
    }
  ]
}
export const testBadges = [
  {
    slug: 'clockbreaker',
    value: 34.2,
    rungIndex: 3,
    earnedAt: [
      '2026-07-10T12:00:00.000Z',
      '2026-07-12T12:00:00.000Z',
      '2026-07-15T12:00:00.000Z',
      '2026-07-18T12:00:00.000Z'
    ],
    runsAtRung: [12, 9, 5, 2, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  {
    slug: 'night-shift',
    value: 1,
    rungIndex: 0,
    earnedAt: ['2026-07-18T03:00:00.000Z']
  },
  {
    slug: 'reps',
    value: 175,
    rungIndex: 0,
    earnedAt: ['2026-07-20T18:00:00.000Z']
  },
  {
    slug: 'marathon',
    value: 7,
    rungIndex: 0,
    earnedAt: ['2026-07-21T18:00:00.000Z']
  },
  {
    slug: 'first-drop',
    value: 100,
    rungIndex: 0,
    earnedAt: ['2026-08-25T12:00:00.000Z']
  }
] as const
// The You page's single Your games panel reads this, so the reviewed runs live
// here too: the three referee states have to be reachable from the history the
// panel actually renders.
const seasonRuns = [
  ...testRecentRuns,
  ...Array.from({ length: 27 }, (_, index) => ({
    runId: `season-run-${index + 1}`,
    mode: index % 2 === 0 ? ('surge' as const) : ('trade' as const),
    score: index % 2 === 0 ? 67_299 - index * 100 : 91_000 - index * 250,
    seasonId: 134,
    completedAt: `2026-07-${String(28 - index).padStart(2, '0')}T18:00:00.000Z`
  }))
]

export const testSeasonHistory = {
  seasons: [
    {
      id: 134,
      // Deliberately greater than the old 20-row profile feed cap.
      games: seasonRuns.length,
      runs: seasonRuns
    },
    {
      id: 133,
      games: 2,
      runs: [
        {
          runId: 'older-1',
          mode: 'surge' as const,
          score: 71_000,
          seasonId: 133,
          completedAt: '2026-06-20T18:00:00.000Z'
        },
        {
          runId: 'older-2',
          mode: 'trade' as const,
          score: 84_000,
          seasonId: 133,
          completedAt: '2026-06-19T18:00:00.000Z'
        }
      ]
    }
  ]
}

// GET /me/seasons is paged: the index lists every season, and `season` picks
// which one's runs come back (absent = the most recent, `all` = everything).
// The fixtures answer it the same way so the You page's paging is exercised
// rather than mocked away.
export function seasonHistoryResponse(url: string) {
  const requested = new URL(url).searchParams.get('season')
  const index = testSeasonHistory.seasons.map((season) => ({
    id: season.id,
    games: season.games
  }))
  const requestedSeason = requested && /^\d+$/.test(requested) ? Number(requested) : undefined
  const seasons =
    requested === 'all'
      ? testSeasonHistory.seasons
      : testSeasonHistory.seasons.filter((season) => season.id === (requestedSeason ?? index[0]?.id))
  return { index, seasons }
}

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
    // Rank 1 was cleared by a referee; rank 2 is still awaiting one and ranks
    // provisionally, so the board renders both seals.
    reviewStatus: index === 1 ? ('pending' as const) : ('reviewed' as const),
    ...(index === 0 ? { refereeReviewed: true } : {}),
    ...(mode === 'survival' || mode === 'higher-lower' ? { timeMs: 61_317 + index } : {}),
    player: {
      id: entry.id,
      publicName: entry.name,
      ...(entry.id === 'player-2' ? { accountTags: ['developer' as const] } : {}),
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
  seasonId: 134,
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
      ...(playerId === 'player-2'
        ? {
            playerTag: '#UL2V9QRGO',
            clashRoyale: {
              tag: '#UL2V9QRGO',
              status: 'ready' as const,
              name: 'King Thing',
              clan: { tag: '#J2RGCRVG', name: 'POAP KINGS', badgeId: 16000000 }
            }
          }
        : {}),
      levelStartGames: Math.max(0, summary.totalGames - 10),
      nextLevelGames: summary.totalGames + 15
    },
    recentRuns: testRecentRuns,
    badges: { badges: testBadges }
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
    const scope = url.searchParams.get('scope')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode,
        scope: scope === 'all-time' || scope === 'clan' ? scope : 'season',
        ...(scope === 'clan' ? { clan: { tag: '#J2RGCRVG', name: 'POAP KINGS' } } : {}),
        ...(scope === 'all-time' || scope === 'clan' ? {} : { seasonId: testSeason.id }),
        currentSeason: testSeason,
        seasons: [{ id: testSeason.id }],
        entries: leaderboardEntries(mode)
      })
    })
    return true
  }
  if (path === '/activity') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testActivity) })
    return true
  }
  if (path === '/me/seasons') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(seasonHistoryResponse(route.request().url()))
    })
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
      // The server's fixed board ladder, dealt like the server deals it: take
      // the next window of catalog cards whose swing lands inside the keypad's
      // -4..+4, and slide along until one does. Cards are consumed, so no card
      // repeats inside the run.
      const pool = [...cards]
      return {
        mode,
        rounds: TRADE_LADDER.map((board) => {
          const size = board.blue + board.red
          for (let start = 0; start + size <= pool.length; start += 1) {
            const window = pool.slice(start, start + size)
            const total = (side: typeof window) => side.reduce((sum, card) => sum + card.elixir, 0)
            const blue = window.slice(0, board.blue)
            const red = window.slice(board.blue)
            if (Math.abs(total(red) - total(blue)) > 4) continue
            pool.splice(start, size)
            return { blueIds: blue.map((card) => card.id), redIds: red.map((card) => card.id) }
          }
          throw new Error(`test challenge could not deal a ${board.blue}v${board.red} trade board`)
        })
      }
    }
  }
}

// Invitation shares retain their compact token contract. Recorded-run shares
// below are deterministic and return one clean player/run URL.
let shareTokenCounter = 0
const inviteShares = new Map<string, { destination: 'home' | 'player'; playerId?: string }>()

export function testPublishedRunUrl(runId: string): string {
  return `http://127.0.0.1:5173/share/${playerReference(testPlayer.id).slice(1)}/${runReference(runId).slice(1)}`
}

export function testPublishedBadgeUrl(slug: string, rungIndex: number): string {
  return `http://127.0.0.1:5173/share/${playerReference(testPlayer.id).slice(1)}/badge/${slug}/${rungIndex + 1}`
}

export function testPublishedProfileUrl(): string {
  return `http://127.0.0.1:5173/share/${playerReference(testPlayer.id).slice(1)}`
}

function testPublishedRunPreview(runId: string) {
  const score = runId === 'run-surge' ? '17.412s' : '67.299s'
  return {
    mode: 'surge' as const,
    score,
    playerName: testPlayer.publicName,
    favoriteCardId: testPlayer.favoriteCardId,
    visual: {
      mode: 'surge' as const,
      unit: 'SECONDS PER CARD',
      values: [920, 1040, 870, 1310, 980, 1100, 840, 1240, 1010, 940, 1180, 890, 970, 1080, 1028],
      refs: [1100, 1160, 1050, 1400, 1080, 1210, 990, 1380, 1140, 1080, 1270, 1010, 1090, 1190, 1150],
      bad: [false, false, false, true, false, false, false, true, false, false, false, false, false, false, false]
    }
  }
}

export async function fulfillTestRun(route: Route): Promise<boolean> {
  const path = new URL(route.request().url()).pathname
  if (path === '/practice/resume' && route.request().method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft: null }) })
    return true
  }
  if (path === '/practice/checkpoint' && route.request().method() === 'POST') {
    const checkpoint = route.request().postDataJSON() as { startIndex: number; answers: unknown[] }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: true,
        runId: 'run-practice',
        answerCount: checkpoint.startIndex + checkpoint.answers.length,
        updatedAt: '2026-08-25T19:00:00.000Z'
      })
    })
    return true
  }
  if (path === '/me/share' && route.request().method() === 'PUT') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    return true
  }
  if (path === '/me/share' && route.request().method() === 'POST') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        playerId: testPlayer.id,
        url: testPublishedProfileUrl(),
        preview: {
          playerName: testPlayer.publicName,
          favoriteCardId: testPlayer.favoriteCardId,
          xp: testPlayer.xp,
          arena: 5,
          badgeCount: testBadges.length,
          badges: [
            { slug: 'clockbreaker', name: 'Clockbreaker', tier: 'silver', chip: '30s' },
            { slug: 'night-shift', name: 'Night Shift', tier: 'copper', chip: '1' },
            { slug: 'reps', name: 'Reps', tier: 'copper', chip: '175' }
          ]
        }
      })
    })
    return true
  }
  if (route.request().method() === 'POST' && path === '/shares') {
    shareTokenCounter += 1
    const token = `NVT${'ABCDEFGHJKMNPQRSTVWXYZ'[shareTokenCounter % 22]!.repeat(3)}`
    inviteShares.set(token, route.request().postDataJSON() as { destination: 'home' | 'player'; playerId?: string })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ token }) })
    return true
  }
  const shareMint = /^\/runs\/[^/]+\/share$/.exec(path)
  if (shareMint && route.request().method() === 'PUT') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    return true
  }
  if (shareMint && route.request().method() === 'POST') {
    const runId = decodeURIComponent(path.split('/')[2] ?? '')
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        playerId: testPlayer.id,
        runId,
        url: testPublishedRunUrl(runId),
        preview: testPublishedRunPreview(runId)
      })
    })
    return true
  }
  const badgeShare = /^\/badges\/([^/]+)\/share$/.exec(path)
  if (badgeShare && route.request().method() === 'PUT') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    return true
  }
  if (badgeShare && route.request().method() === 'POST') {
    const slug = decodeURIComponent(badgeShare[1] ?? '')
    const { rungIndex } = route.request().postDataJSON() as { rungIndex: number }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        playerId: testPlayer.id,
        slug,
        rungIndex,
        url: testPublishedBadgeUrl(slug, rungIndex),
        preview: {
          playerName: testPlayer.publicName,
          favoriteCardId: testPlayer.favoriteCardId,
          slug,
          name: 'Clockbreaker',
          tier: 'copper',
          chip: '35s',
          rungIndex,
          rungCount: 12,
          hidden: false,
          requirement: 'Fastest Surge run'
        }
      })
    })
    return true
  }
  const sharedRun = /^\/shares\/([^/]+)$/.exec(path)
  if (sharedRun) {
    const invite = inviteShares.get(sharedRun[1]!)
    if (invite) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: sharedRun[1], kind: 'invite', ...invite })
      })
      return true
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: sharedRun[1],
        mode: 'surge',
        score: 17_412,
        seasonId: 134,
        completedAt: '2026-07-18T00:00:00.000Z',
        series: [1200, 900, 1500],
        player: {
          id: 'shared-player',
          publicName: 'Knight Main',
          favoriteCardId: 26000000,
          totalGames: 40,
          xp: 900,
          level: 4
        }
      })
    })
    return true
  }
  if (path === '/runs/start') {
    const { mode } = route.request().postDataJSON() as { mode: GameMode }
    const challenge = testChallenge(mode)
    const runToken = `run-${mode}`
    const guest = !route.request().headers()['authorization']
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        runId: runToken,
        runToken,
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
      id: 134,
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
// A test that deliberately severs the network: the browser logs a transport
// error for every aborted request, which is the condition under test rather
// than a fault. Narrow to that exact class so a genuine app error still fails.
export const allowOfflineTransportErrors = new WeakSet<Page>()

// Every spec imports this `test`: the overridden `page` fixture installs the
// shared analytics/API mocks before the test navigates, and the teardown half
// replaces the old global afterEach console-error guard. Keeping it on the
// fixture (instead of module-level hooks) is what lets the suite live in many
// files — hooks declared in an imported module would only attach to whichever
// file happened to load it first.
export const test = base.extend({
  // `provide` is Playwright's `use` callback, renamed so the lint rule that
  // guards React hook naming does not read it as a misplaced hook call.
  page: async ({ page, browserName }, provide) => {
    const errors: string[] = []
    const isWebkitMockNavigationCancellation = (text: string) =>
      browserName === 'webkit' &&
      text.endsWith(' due to access control checks.') &&
      /127\.0\.0\.1:5173\/(?:activity|auth|leaderboards|me|players|runs|stats)(?:[/?]|\s)/.test(text)
    page.on('console', (msg) => {
      const text = msg.text()
      // Firefox 153 reports its own in-flight document cancellation as a
      // console error when a test intentionally reloads. It has no page URL or
      // application stack and is safe to exclude from the app-error guard.
      const firefoxNavigationCancellation =
        browserName === 'firefox' && text === '[JavaScript Error: "InvalidStateError: Navigated away from page"]'
      // WebKit reports an interrupted fulfilled fetch as an access-control
      // error during deliberate reloads and page.goto() calls. These mocks are
      // same-origin, so restrict the exclusion to that exact engine, host,
      // local API path, and message suffix; genuine HTTP/CORS errors still fail.
      if (
        msg.type() === 'error' &&
        !firefoxNavigationCancellation &&
        !isWebkitMockNavigationCancellation(text) &&
        !(allowBlockedAssets.has(page) && text.includes('net::ERR_FAILED')) &&
        !(allowExpectedApiErrors.has(page) && (text.includes('status of 400') || text.includes('status of 503'))) &&
        !(
          allowOfflineTransportErrors.has(page) &&
          (text.includes('net::ERR_INTERNET_DISCONNECTED') ||
            text.includes('Failed to load resource') ||
            text.includes('NetworkError') ||
            text.includes('Load failed'))
        )
      ) {
        const sourceUrl = msg.location().url
        errors.push(sourceUrl ? `${text} (${sourceUrl})` : text)
      }
    })
    page.on('pageerror', (err) => {
      if (!isWebkitMockNavigationCancellation(err.message)) errors.push(err.message)
    })
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
          body: JSON.stringify({ player: testPlayer, recentRuns: testRecentRuns, badges: { badges: testBadges } })
        })
        return
      }
      if (path === '/me/seasons') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(seasonHistoryResponse(route.request().url()))
        })
        return
      }
      if (path === '/me/xp') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(testXpTimeline)
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
        const scope = params.get('scope')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            scope === 'all-time'
              ? {
                  mode,
                  scope: 'all-time',
                  currentSeason: testSeason,
                  seasons: [{ id: testSeason.id }],
                  entries: leaderboardEntries(mode)
                }
              : scope === 'clan'
                ? {
                    mode,
                    scope: 'clan',
                    clan: { tag: '#J2RGCRVG', name: 'POAP KINGS' },
                    currentSeason: testSeason,
                    entries: leaderboardEntries(mode)
                  }
                : {
                    mode,
                    scope: 'season',
                    seasonId: 134,
                    currentSeason: testSeason,
                    seasons: [{ id: testSeason.id }],
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
