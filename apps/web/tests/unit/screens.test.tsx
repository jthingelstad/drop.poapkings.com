import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { renderToStringAsync } from 'preact-render-to-string'
import type { GameMode } from '@elixir-drop/contracts'

// --- Collaborator mocks: nothing hits the network ----------------------------
vi.mock('../../src/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/api')>()
  return {
    ...actual,
    requestLogin: vi.fn(),
    pollLogin: vi.fn(),
    getLeaderboard: vi.fn(),
    getPublicPlayer: vi.fn()
  }
})

vi.mock('../../src/lib/account', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/account')>()
  return {
    ...actual,
    applyPolledSession: vi.fn(),
    redeemAccount: vi.fn()
  }
})

vi.mock('../../src/lib/router', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/router')>()
  return {
    ...actual,
    navigate: vi.fn()
  }
})

// Home is one component on both shells now, and it owns its own data hook —
// there is no props-only "HomeMobile" to render. Stub the hook so these stay
// render tests.
vi.mock('../../src/screens/home/home-data', async (importActual) => {
  const actual = await importActual<typeof import('../../src/screens/home/home-data')>()
  return { ...actual, useHomeData: vi.fn() }
})

// The heavy Pixi scene is behind a dynamic import; stub it so the egg loads.
vi.mock('../../src/components/ScreensaverScene', () => ({
  createElixirRain: vi.fn(async () => ({ destroy: vi.fn() }))
}))

import { requestLogin, pollLogin, getLeaderboard, getPublicPlayer, type LeaderboardScope } from '../../src/lib/api'
import { applyPolledSession, redeemAccount, player, accountStatus, recentRuns } from '../../src/lib/account'
import { navigate, route } from '../../src/lib/router'
import { installMode, installEligible, installDismissed } from '../../src/lib/pwa-install'
import { layout } from '../../src/lib/use-layout'
import { desktopFallingCardsMode, resetScreensaverForTests, screensaverActive } from '../../src/lib/screensaver'
import { createElixirRain } from '../../src/components/ScreensaverScene'

import Login from '../../src/screens/Login'
import Leaderboards from '../../src/screens/Leaderboards'
import AuthRedeem from '../../src/screens/AuthRedeem'
import Home from '../../src/screens/Home'
import Screensaver from '../../src/components/Screensaver'
import { useHomeData, type HomeData } from '../../src/screens/home/home-data'
import type { LeaderboardEntry } from '../../src/lib/api'
import PublicProfile from '../../src/screens/PublicProfile'
import { publicPlayerPreview } from '../../src/lib/public-player'

// --- Harness ------------------------------------------------------------------
const hosts: HTMLElement[] = []

async function mount(vnode: VNode): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  await act(async () => {
    render(vnode, host)
  })
  return host
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function buttonWithText(host: HTMLElement, selector: string, text: string): HTMLButtonElement {
  const match = [...host.querySelectorAll<HTMLButtonElement>(selector)].find((b) =>
    (b.textContent ?? '').includes(text)
  )
  if (!match) throw new Error(`No button matching "${text}" in ${selector}`)
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  resetScreensaverForTests()
  layout.value = 'mobile'
})

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host)
    host.remove()
  }
  player.value = null
  accountStatus.value = 'anonymous'
  recentRuns.value = []
  route.value = '/'
  resetScreensaverForTests()
  installMode.value = 'none'
  installEligible.value = false
  installDismissed.value = false
  publicPlayerPreview.value = null
  vi.useRealTimers()
})

// =============================================================================
// Login
// =============================================================================
describe('Login', () => {
  const laterExpiry = () => new Date(Date.now() + 3_600_000).toISOString()

  it('sends the login link, then shows the check-your-email + keep-page-open state', async () => {
    route.value = '/login?returnTo=%2Fsurge'
    vi.mocked(requestLogin).mockResolvedValue({ message: 'Check your email for the link.', pollId: 'poll-1' } as never)

    const host = await mount(<Login />)
    const input = host.querySelector<HTMLInputElement>('#login-email')!
    await typeInto(input, '  Player@Example.com  ')
    await act(async () => {
      host.querySelector('form.account-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    // Trimmed email + the returnTo captured from the route were forwarded.
    expect(requestLogin).toHaveBeenCalledWith('Player@Example.com', '/surge', undefined)
    expect(host.textContent).toContain('Check your email for the link.')
    expect(host.textContent).toContain('Keep this page open')
    // The email form is replaced by the success block.
    expect(host.querySelector('form.account-form')).toBeNull()
  })

  it('polls after sending and applies the session + navigates when ready', async () => {
    vi.useFakeTimers()
    route.value = '/login?returnTo=%2Fsurge'
    const session = { token: 'sess-1', expiresAt: laterExpiry() }
    vi.mocked(requestLogin).mockResolvedValue({ message: 'Sent.', pollId: 'poll-9' } as never)
    vi.mocked(pollLogin).mockResolvedValue({ ready: true, session } as never)

    const host = await mount(<Login />)
    const input = host.querySelector<HTMLInputElement>('#login-email')!
    await typeInto(input, 'me@example.com')
    await act(async () => {
      host.querySelector('form.account-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    expect(pollLogin).not.toHaveBeenCalled()

    // The poll effect scheduled a 2.5s tick; run it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600)
    })

    expect(pollLogin).toHaveBeenCalledWith('poll-9', expect.any(AbortSignal))
    expect(applyPolledSession).toHaveBeenCalledWith(session)
    expect(navigate).toHaveBeenCalledWith('/surge')
  })

  it('surfaces the error branch when the request rejects', async () => {
    route.value = '/login'
    vi.mocked(requestLogin).mockRejectedValue(new Error('The mailer is down.'))

    const host = await mount(<Login />)
    await typeInto(host.querySelector<HTMLInputElement>('#login-email')!, 'me@example.com')
    await act(async () => {
      host.querySelector('form.account-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('The mailer is down.')
    // Still on the form (not the "sent" state).
    expect(host.querySelector('form.account-form')).not.toBeNull()
  })

  it('rejects an invalid email locally without calling the API', async () => {
    route.value = '/login'
    const host = await mount(<Login />)
    await typeInto(host.querySelector<HTMLInputElement>('#login-email')!, 'not-an-email')
    await act(async () => {
      host.querySelector('form.account-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    expect(requestLogin).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Enter a valid email address.')
  })
})

// =============================================================================
// Leaderboards
// =============================================================================
describe('Leaderboards', () => {
  function entry(id: string, rank: number, name: string, score: number): LeaderboardEntry {
    return {
      rank,
      score,
      achievedAt: '2026-07-20T00:00:00.000Z',
      player: { id, publicName: name, favoriteCardId: 26000000, totalGames: 10, xp: 1_200, level: 3 }
    }
  }

  const ROWS = [
    { ...entry('p1', 1, 'Alice', 4_200), reviewStatus: 'reviewed' as const, refereeReviewed: true },
    entry('p2', 2, 'Bob', 5_000)
  ]

  function build(mode: GameMode, scope: LeaderboardScope) {
    return {
      mode,
      scope,
      ...(scope === 'clan' ? { clan: { tag: '#J2RGCRVG', name: 'POAP KINGS' } } : {}),
      seasonId: 'season-60',
      currentSeason: {
        id: 'season-60',
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z',
        durationWeeks: 4,
        source: 'clash-royale',
        crSeasonId: 60
      },
      seasons: [
        { id: 'season-60', crSeasonId: 60 },
        { id: 'season-59', crSeasonId: 59 }
      ],
      entries:
        mode === 'survival'
          ? []
          : mode === 'higher-lower'
            ? ROWS.map((row, index) => ({ ...row, timeMs: 61_317 + index }))
            : ROWS
    }
  }

  beforeEach(() => {
    vi.mocked(getLeaderboard).mockImplementation(((mode: GameMode, scope: LeaderboardScope) =>
      Promise.resolve(build(mode, scope))) as never)
  })

  it('loads the season board and marks the signed-in player as You', async () => {
    accountStatus.value = 'authenticated'
    player.value = { id: 'p1' } as never

    const host = await mount(<Leaderboards />)
    await flush()

    expect(getLeaderboard).toHaveBeenLastCalledWith('surge', 'season', expect.any(AbortSignal), undefined, undefined)
    // One fixed title on every scope; the current season labels the header clock,
    // and the period rail carries the season chips.
    expect(host.querySelector('.ed-ladder__title')?.textContent).toBe('Ladder')
    expect(host.querySelector('.ed-ladder__clock')?.textContent).toContain('Ends')
    expect(buttonWithText(host, '.ed-ladder__periods button', 'Season 60')).toBeTruthy()
    expect(host.textContent).toContain('Alice')
    expect(host.textContent).toContain('4.200s') // leaderboard preserves millisecond ordering
    // The player's own row is flagged.
    expect(host.querySelector('.ed-lbrow--you')).not.toBeNull()
    expect(host.querySelector('.ed-lbrow--you')?.textContent).toContain('You')
    // The seal is CSS, not a glyph, and rank 1 gets the watermark ring.
    expect(host.querySelector('[aria-label="Referee cleared"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Referee cleared"]')?.textContent).toBe('')
    // Bob's run was never reviewed, so it wears no seal — exactly one row does.
    expect(host.querySelectorAll('.ed-lbrow [aria-label="Referee cleared"]')).toHaveLength(1)
    expect(host.querySelectorAll('.ed-lbrow__seal-slot')).toHaveLength(1)
    expect(host.querySelector('.ed-lbrow--crown')).not.toBeNull()
    expect(host.querySelector('.ed-board__review-key')).toBeNull()
    expect(host.querySelector('.ed-board__key')?.textContent).toContain('ranks while it is checked')
  })

  it('ranks a run that is awaiting the referee and says so on its row', async () => {
    vi.mocked(getLeaderboard).mockImplementation(((mode: GameMode, scope: LeaderboardScope) => {
      const board = build(mode, scope)
      return Promise.resolve({
        ...board,
        entries: board.entries.map((row, index) =>
          index === 0 ? { ...row, reviewStatus: 'pending' as const, refereeReviewed: undefined } : row
        )
      })
    }) as never)

    const host = await mount(<Leaderboards />)
    await flush()

    const top = host.querySelector('.ed-lbrow')!
    expect(top.textContent).toContain('Alice')
    expect(top.querySelector('[aria-label="Awaiting referee"]')).not.toBeNull()
    expect(top.querySelector('.ed-lbrow__meta--awaiting')?.textContent).toBe('Awaiting the referee')
    // A held row trades its XP/games meta for the reason it is held.
    expect(top.textContent).not.toContain('1,200 XP')
  })

  it('opens the selected player and keeps the signed-in player on the private profile route', async () => {
    accountStatus.value = 'authenticated'
    player.value = { id: 'p1' } as never
    const host = await mount(<Leaderboards />)
    await flush()

    await click(host.querySelector('[aria-label="View Bob\'s profile"]')!)
    expect(navigate).toHaveBeenLastCalledWith('/players/p2')
    expect(publicPlayerPreview.value?.publicName).toBe('Bob')

    await click(host.querySelector('[aria-label="View your profile"]')!)
    expect(navigate).toHaveBeenLastCalledWith('/profile')
  })

  it('switches the board period to all-time and re-queries', async () => {
    const host = await mount(<Leaderboards />)
    await flush()

    await click(buttonWithText(host, '.ed-ladder__periods button', 'All-time'))
    await flush()

    expect(getLeaderboard).toHaveBeenLastCalledWith('surge', 'all-time', expect.any(AbortSignal), undefined, undefined)
    // The header is fixed now: only the pressed period chip changes.
    expect(host.querySelector('.ed-ladder__title')?.textContent).toBe('Ladder')
    expect(buttonWithText(host, '.ed-ladder__periods button', 'All-time').getAttribute('aria-pressed')).toBe('true')
  })

  it('switches the mode tab, re-queries, and re-renders rows for the new mode', async () => {
    const host = await mount(<Leaderboards />)
    await flush()

    await click(buttonWithText(host, '.ed-board__modes button', 'HIGHER'))
    await flush()

    expect(getLeaderboard).toHaveBeenLastCalledWith(
      'higher-lower',
      'season',
      expect.any(AbortSignal),
      undefined,
      undefined
    )
    // Higher/Lower scores read as a count of correct reads, not seconds.
    expect(host.textContent).toContain('correct')
    expect(host.textContent).toContain('61.317s')
    expect(host.textContent).not.toContain('4.200s')
  })

  it('switches to current-clan all-time rankings for a linked player', async () => {
    accountStatus.value = 'authenticated'
    player.value = {
      id: 'p1',
      playerTag: '#PLAYER',
      clashRoyale: {
        tag: '#PLAYER',
        status: 'ready',
        clan: { tag: '#J2RGCRVG', name: 'POAP KINGS', badgeId: 1 }
      }
    } as never
    const host = await mount(<Leaderboards />)
    await flush()

    await click(buttonWithText(host, '.ed-scoperow button', 'Clan'))
    await flush()

    expect(getLeaderboard).toHaveBeenLastCalledWith('surge', 'clan', expect.any(AbortSignal), undefined, undefined)
    // The clan identity has its own strip under the scope row; the header and
    // scope row are the same ones the boards rendered.
    expect(host.querySelector('.ed-ladder__title')?.textContent).toBe('Ladder')
    const strip = host.querySelector('.ed-board__clan')!
    expect(strip.textContent).toContain('POAP KINGS')
    expect(strip.textContent).toContain('#J2RGCRVG')
    expect(strip.textContent).toContain('2 clanmates on Drop')
    expect(buttonWithText(host, '.ed-board__clan button', 'Change')).toBeTruthy()
  })

  it('renders the empty state and its Play link when a mode has no scores', async () => {
    const host = await mount(<Leaderboards />)
    await flush()

    await click(buttonWithText(host, '.ed-board__modes button', 'SURVIVE'))
    await flush()

    expect(host.textContent).toContain('Nobody has posted')
    expect(host.querySelector<HTMLImageElement>('.ed-empty__art')?.getAttribute('src')).toBe(
      '/assets/empty/empty-board-512.png'
    )
    const play = buttonWithText(host, '.ed-board__empty button', 'Play')
    await click(play)
    expect(navigate).toHaveBeenCalledWith('/survival')
  })
})

// =============================================================================
// PublicProfile
// =============================================================================
describe('PublicProfile', () => {
  it('renders the selected public identity and recent games without private account fields', async () => {
    route.value = '/players/p2'
    vi.mocked(getPublicPlayer).mockResolvedValue({
      player: {
        id: 'p2',
        publicName: 'Royal Ghosted',
        favoriteCardId: 26000050,
        playerTag: '#UL2V9QRGO',
        clashRoyale: {
          tag: '#UL2V9QRGO',
          status: 'ready',
          name: 'King Thing',
          clan: { tag: '#J2RGCRVG', name: 'POAP KINGS', badgeId: 16000000 }
        },
        totalGames: 42,
        xp: 900,
        level: 4,
        levelStartGames: 25,
        nextLevelGames: 50
      },
      recentRuns: [
        {
          runId: 'run-1',
          mode: 'surge',
          score: 52_000,
          seasonId: '2026-07',
          completedAt: '2026-07-22T17:00:00.000Z'
        }
      ]
    })

    const host = await mount(<PublicProfile />)
    await flush()

    expect(getPublicPlayer).toHaveBeenCalledWith('p2', expect.any(AbortSignal))
    expect(host.querySelector('h1')?.textContent).toBe('Royal Ghosted')
    expect(host.textContent).toContain('King Thing')
    expect(host.textContent).toContain('Clan POAP KINGS · #J2RGCRVG')
    expect(host.querySelector<HTMLAnchorElement>('a[href="https://royaleapi.com/player/UL2V9QRGO"]')).not.toBeNull()
    expect(host.querySelector<HTMLAnchorElement>('a[href="https://royaleapi.com/clan/J2RGCRVG"]')).not.toBeNull()
    expect(host.textContent).toContain('52.000s')
    expect(host.textContent).not.toContain('player@example.com')
    expect(host.textContent).not.toContain('Edit')
  })

  it('keeps a clicked player preview visible if history cannot be refreshed', async () => {
    route.value = '/players/p2'
    publicPlayerPreview.value = {
      id: 'p2',
      publicName: 'Royal Ghosted',
      totalGames: 42,
      xp: 900,
      level: 4
    }
    vi.mocked(getPublicPlayer).mockRejectedValue(new Error('offline'))

    const host = await mount(<PublicProfile />)
    await flush()

    expect(host.querySelector('h1')?.textContent).toBe('Royal Ghosted')
    expect(host.textContent).toContain('Recent games are temporarily unavailable.')
  })
})

// =============================================================================
// AuthRedeem
// =============================================================================
describe('AuthRedeem', () => {
  it('reports a missing token and offers to request another link', async () => {
    route.value = '/auth'
    const html = await renderToStringAsync(<AuthRedeem />)
    expect(html).toContain('Login link failed')
    expect(html).toContain('This login link is missing its token.')
    expect(html).toContain('Request another link')
  })

  it('does not auto-redeem: it waits for a real click', async () => {
    route.value = '/auth?token=abc123'
    const host = await mount(<AuthRedeem />)
    await flush()

    expect(redeemAccount).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Almost signed in')
    expect(host.textContent).toContain('Continue to Drop')
  })

  it('redeems on click and navigates home for a complete profile', async () => {
    route.value = '/auth?token=abc123'
    vi.mocked(redeemAccount).mockResolvedValue({
      id: 'p1',
      publicName: 'Knight Main',
      favoriteCardId: 26000000
    } as never)

    const host = await mount(<AuthRedeem />)
    await click(buttonWithText(host, 'button', 'Continue to Drop'))
    await flush()

    expect(redeemAccount).toHaveBeenCalledWith('abc123')
    expect(navigate).toHaveBeenCalledWith('/profile')
  })

  it('routes an incomplete profile into game-scoped setup', async () => {
    route.value = '/auth?token=tok9&returnTo=%2Fsurge'
    vi.mocked(redeemAccount).mockResolvedValue({ id: 'p1' } as never) // no favoriteCardId/publicName

    const host = await mount(<AuthRedeem />)
    await click(buttonWithText(host, 'button', 'Continue to Drop'))
    await flush()

    expect(navigate).toHaveBeenCalledWith('/profile?returnTo=%2Fsurge')
  })

  it('shows the error state when redemption fails', async () => {
    route.value = '/auth?token=dead'
    vi.mocked(redeemAccount).mockRejectedValue(new Error('This link was already used.'))

    const host = await mount(<AuthRedeem />)
    await click(buttonWithText(host, 'button', 'Continue to Drop'))
    await flush()

    expect(host.textContent).toContain('Login link failed')
    expect(host.textContent).toContain('This link was already used.')
    expect(navigate).not.toHaveBeenCalled()
  })
})

// =============================================================================
// Home
// =============================================================================
describe('Home', () => {
  // Home is one column on both widths; only the ORDER and what a row does
  // change, so every test here says which layout it is asserting.
  afterEach(() => {
    layout.value = 'desktop'
  })

  // Primes the mocked hook and returns what Home will read.
  function homeData(overrides: Partial<HomeData> = {}): HomeData {
    const data: HomeData = {
      loading: false,
      stats: null,
      season: null,
      personalBestScores: { surge: 4_800 },
      bestScores: { surge: 4_800 },
      rankFor: () => undefined,
      standingsFor: () => [],
      ...overrides
    }
    vi.mocked(useHomeData).mockReturnValue(data)
    return data
  }

  it('leads with the hero, puts the Guest shortcut in its identity slot, and lists every mode', async () => {
    layout.value = 'mobile'
    accountStatus.value = 'anonymous'
    player.value = null
    installMode.value = 'none'

    homeData()
    const html = await renderToStringAsync(<Home />)

    // The nav never renames; the header shortcut names the state instead and
    // mirrors the signed-in avatar's route to You.
    expect(html).toContain('GUEST')
    expect(html).toContain('aria-label="Guest — open You"')
    expect(html).toContain('ed-cause--button')
    // Every mode appears — the featured one in the hero, the rest as rows.
    for (const name of ['Surge', 'Higher / Lower', 'Rain', 'Trade', 'Survival']) {
      expect(html).toContain(name)
    }
    // Practice appears once as the unranked learning mode.
    expect(html).toContain('ed-grow__name">Practice</strong>')
    expect(html).toContain('UNRANKED')
    // A readiness indicator, not a warning.
    expect(html).toContain('Games are available to play offline')
    expect(html).not.toContain('Season standings')
    // The intro header and identity chip band are gone.
    expect(html).not.toContain('ed-idchip')
    expect(html).not.toContain('ed-home-intro')
    // installMode 'none' → neither banner nor row.
    expect(html).not.toContain('ed-installbar')
    expect(html).not.toContain('ed-installrow')
  })

  it('keeps the mobile game order and rows on desktop', async () => {
    layout.value = 'desktop'
    accountStatus.value = 'anonymous'
    player.value = null
    installMode.value = 'none'

    homeData()
    const html = await renderToStringAsync(<Home />)

    expect(html).toContain('UNRANKED')
    // "Games", not a count that goes stale when the list changes.
    expect(html).toContain('Games</span>')
    expect(html).not.toContain('The other four')
    expect(html.indexOf('>Games</span>')).toBeLessThan(html.indexOf('ed-grow__name">Practice</strong>'))
    expect(html.match(/ed-grow ed-grow--ranked/g)).toHaveLength(4)
    expect(html).not.toContain('Board →')
    // Full-width, and the word alone — `9a` draws no glyph on the hero button.
    expect(html).toContain('<span class="tap-face">PLAY</span>')
    expect(html).toContain('ed-hero__play')
    expect(html).not.toContain('Ranked runs are played on your phone')
  })

  it('draws the Practice row in the same medium as every other row', async () => {
    homeData()
    const html = await renderToStringAsync(<Home />)

    // Its own mode art, not a lucide glyph in a tinted tile — one row drawn
    // differently read as unfinished.
    expect(html).not.toContain('ed-grow__glyph')
    expect(html).toContain('/assets/modes/practice-192.png')
  })

  it('puts the screensaver tap door on the logo, not on a section heading', async () => {
    homeData()
    const html = await renderToStringAsync(<Home />)

    // A tap target that does something unrelated to its own label is the bug;
    // `registerLogoTap` names where it belongs.
    expect(html).toContain('ed-wordmark--tap')
    // The clan link survives as the "Run by POAP KINGS" line beneath it.
    expect(html).toContain('Run by POAP KINGS')
  })

  it('shows no cause chip and no identity band when authed and online', async () => {
    accountStatus.value = 'authenticated'
    player.value = { id: 'p2', publicName: 'Bob', level: 7 } as never

    homeData()
    const html = await renderToStringAsync(<Home />)

    // Identity lives on the You page now; Home leads with the hero.
    expect(html).not.toContain('GUEST')
    expect(html).not.toContain('ed-cause')
    expect(html).not.toContain('ed-idchip')
  })

  it('shows the prominent install banner while installable and undismissed', async () => {
    installMode.value = 'available'
    installEligible.value = true
    installDismissed.value = false
    homeData()
    const html = await renderToStringAsync(<Home />)
    expect(html).toContain('ed-installbar')
    expect(html).toContain('Install for full-screen play')
    expect(html).not.toContain('ed-installrow')
  })

  it('collapses to the compact install row once dismissed', async () => {
    installMode.value = 'available'
    installEligible.value = true
    installDismissed.value = true
    homeData()
    const html = await renderToStringAsync(<Home />)
    expect(html).toContain('ed-installrow')
    expect(html).not.toContain('ed-installbar')
  })
})

// =============================================================================
// Screensaver
// =============================================================================
describe('Screensaver', () => {
  it('renders the modal shell and loads the lazy scene', async () => {
    screensaverActive.value = 'nav'
    const host = await mount(<Screensaver />)
    await flush()

    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.body.classList.contains('modal-open')).toBe(true)

    // The scene arrives via a dynamic import() — let its promise chain settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(createElixirRain).toHaveBeenCalledTimes(1)
  })

  it('uses only the persistent background scene on desktop', async () => {
    layout.value = 'desktop'
    screensaverActive.value = 'nav'
    const host = await mount(<Screensaver />)
    await flush()

    expect(host.querySelector('.screensaver--desktop-background')).not.toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(createElixirRain).not.toHaveBeenCalled()
  })

  it('exits on a keydown, clearing the active signal', async () => {
    screensaverActive.value = 'nav'
    await mount(<Screensaver />)
    await flush()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }))
    })
    expect(screensaverActive.value).toBeNull()
    expect(desktopFallingCardsMode.value).toBe('off')
  })

  it('exits on a pointerdown, clearing the active signal', async () => {
    screensaverActive.value = 'nav'
    await mount(<Screensaver />)
    await flush()

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    })
    expect(screensaverActive.value).toBeNull()
  })
})
