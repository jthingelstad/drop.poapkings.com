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

// The heavy Pixi scene is behind a dynamic import; stub it so the egg loads.
vi.mock('../../src/components/ScreensaverScene', () => ({
  createElixirRain: vi.fn(async () => ({ destroy: vi.fn() }))
}))

import { requestLogin, pollLogin, getLeaderboard, getPublicPlayer, type LeaderboardScope } from '../../src/lib/api'
import { applyPolledSession, redeemAccount, player, accountStatus, recentRuns } from '../../src/lib/account'
import { navigate, route } from '../../src/lib/router'
import { installMode, installEligible, installDismissed } from '../../src/lib/pwa-install'
import { screensaverActive } from '../../src/lib/screensaver'
import { createElixirRain } from '../../src/components/ScreensaverScene'

import Login from '../../src/screens/Login'
import Leaderboards from '../../src/screens/Leaderboards'
import AuthRedeem from '../../src/screens/AuthRedeem'
import HomeMobile from '../../src/screens/home/HomeMobile'
import Screensaver from '../../src/components/Screensaver'
import type { HomeData } from '../../src/screens/home/home-data'
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
  screensaverActive.value = null
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
    expect(requestLogin).toHaveBeenCalledWith('Player@Example.com', '/surge')
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

  const ROWS = [entry('p1', 1, 'Alice', 4_200), entry('p2', 2, 'Bob', 5_000)]

  function build(mode: GameMode, scope: LeaderboardScope) {
    return {
      mode,
      scope,
      seasonId: 'season-60',
      currentSeason: {
        id: 'season-60',
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z',
        durationWeeks: 4,
        source: 'clash-royale',
        crSeasonId: 60
      },
      entries: mode === 'survival' ? [] : ROWS
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

    expect(getLeaderboard).toHaveBeenLastCalledWith('surge', 'season', expect.any(AbortSignal))
    expect(host.textContent).toContain('Season 60 leaderboards')
    expect(host.textContent).toContain('Alice')
    expect(host.textContent).toContain('4.20s') // surge = golf seconds
    // The player's own row is flagged.
    expect(host.querySelector('.leaderboard-row--player')).not.toBeNull()
    expect(host.querySelector('.leaderboard-row--player')?.textContent).toContain('You')
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

  it('switches the scope tab to all-time and re-queries', async () => {
    const host = await mount(<Leaderboards />)
    await flush()

    await click(buttonWithText(host, '.ed-board__scopes button', 'All-time'))
    await flush()

    expect(getLeaderboard).toHaveBeenLastCalledWith('surge', 'all-time', expect.any(AbortSignal))
    expect(host.textContent).toContain('All-time leaderboards')
    expect(host.textContent).toContain('Your best-ever score')
  })

  it('switches the mode tab, re-queries, and re-renders rows for the new mode', async () => {
    const host = await mount(<Leaderboards />)
    await flush()

    await click(buttonWithText(host, '.ed-board__modes button', 'Higher / Lower'))
    await flush()

    expect(getLeaderboard).toHaveBeenLastCalledWith('higher-lower', 'season', expect.any(AbortSignal))
    // Higher/Lower scores read as a streak, not seconds.
    expect(host.textContent).toContain('streak')
    expect(host.textContent).not.toContain('4.20s')
  })

  it('renders the empty state and its Play link when a mode has no scores', async () => {
    const host = await mount(<Leaderboards />)
    await flush()

    await click(buttonWithText(host, '.ed-board__modes button', 'Survival'))
    await flush()

    expect(host.textContent).toContain('No scores yet.')
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
    expect(host.textContent).toContain('52.00s')
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
// HomeMobile
// =============================================================================
describe('HomeMobile', () => {
  function standing(id: string, rank: number, name: string, score: number): LeaderboardEntry {
    return {
      rank,
      score,
      achievedAt: '2026-07-20T00:00:00.000Z',
      player: { id, publicName: name, favoriteCardId: 26000000, totalGames: 4, xp: 300, level: 2 }
    }
  }

  function homeData(overrides: Partial<HomeData> = {}): HomeData {
    const standings = [standing('p1', 1, 'Alice', 4_200), standing('p2', 2, 'Bob', 5_000)]
    return {
      loading: false,
      stats: null,
      season: null,
      bestScores: { surge: 4_800 },
      boards: {},
      championFor: (mode) => (mode === 'higher-lower' ? standing('c1', 1, 'Champ', 9) : undefined),
      surgeStandings: standings,
      surgeRank: undefined,
      ...overrides
    }
  }

  it('renders as a guest: Guest chip, more-games row, open crowns, and no install UI', async () => {
    accountStatus.value = 'anonymous'
    player.value = null
    installMode.value = 'none'

    const html = await renderToStringAsync(<HomeMobile data={homeData()} />)

    expect(html).toContain('Guest')
    expect(html).toContain('Sign in to save your scores')
    // More-games row carries every non-Surge mode.
    expect(html).toContain('Higher / Lower')
    expect(html).toContain('Rain')
    expect(html).toContain('Trade')
    expect(html).toContain('Survival')
    // championFor supplies a named champ for higher-lower, open crowns elsewhere.
    expect(html).toContain('Champ')
    expect(html).toContain('The crown is open')
    // Standings peek shows the top row.
    expect(html).toContain('Season standings')
    expect(html).toContain('Alice')
    // installMode 'none' → neither banner nor row.
    expect(html).not.toContain('ed-installbar')
    expect(html).not.toContain('ed-installrow')
  })

  it('renders an authed identity chip with public name + level, flagging the players own standing', async () => {
    accountStatus.value = 'authenticated'
    player.value = { id: 'p2', publicName: 'Bob', level: 7 } as never

    const html = await renderToStringAsync(<HomeMobile data={homeData()} />)

    expect(html).toContain('Bob')
    expect(html).toContain('Level 7')
    expect(html).not.toContain('Sign in to save your scores')
    // Bob (rank 2, the signed-in player) is surfaced as "You" in the peek.
    expect(html).toContain('ed-standpeek__row--you')
    expect(html).toContain('>You<')
  })

  it('shows the empty standings copy when there are no runs yet', async () => {
    accountStatus.value = 'anonymous'
    const html = await renderToStringAsync(<HomeMobile data={homeData({ surgeStandings: [] })} />)
    expect(html).toContain('No runs yet — first score takes the crown.')
  })

  it('shows the prominent install banner while installable and undismissed', async () => {
    installMode.value = 'available'
    installEligible.value = true
    installDismissed.value = false
    const html = await renderToStringAsync(<HomeMobile data={homeData()} />)
    expect(html).toContain('ed-installbar')
    expect(html).toContain('Install for full-screen play')
    expect(html).not.toContain('ed-installrow')
  })

  it('collapses to the compact install row once dismissed', async () => {
    installMode.value = 'available'
    installEligible.value = true
    installDismissed.value = true
    const html = await renderToStringAsync(<HomeMobile data={homeData()} />)
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

  it('exits on a keydown, clearing the active signal', async () => {
    screensaverActive.value = 'nav'
    await mount(<Screensaver />)
    await flush()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }))
    })
    expect(screensaverActive.value).toBeNull()
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
