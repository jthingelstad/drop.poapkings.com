import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { computeInsights, insightPhrase } from '../../src/lib/insights'
import { seasonEndsLabel } from '../../src/screens/home/home-data'
import type { Card } from '../../src/types'
import { runReference } from '@elixir-drop/contracts'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const FUTURE = () => new Date(Date.now() + 1_000_000).toISOString()

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function fire(el: Element, type = 'click'): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
  await flush()
}

async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

function byText(root: ParentNode, text: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('button, a')].find((el) => el.textContent?.includes(text))
}

const card = (id: number, name: string, elixir: number, type: Card['type'] = 'troop'): Card =>
  ({ id, name, elixir, type, rarity: 'common', evo: false, hero: false, icon: '' }) as Card

// ===========================================================================
// insights.ts — top up the branches logic.test.ts does not reach
// ===========================================================================

describe('insights extra branches', () => {
  it('handles an empty session with zeroed stats and no timing/bias', () => {
    const ins = computeInsights([])
    expect(ins.total).toBe(0)
    expect(ins.correct).toBe(0)
    expect(ins.accuracyPct).toBe(0)
    expect(ins.weakest).toEqual([])
    expect(ins.biasLine).toBeUndefined()
    expect(ins.hasTiming).toBe(false)
    expect(ins.slowestBandLabel).toBeUndefined()
    // Every band is present but empty.
    expect(ins.bands.map((b) => b.total)).toEqual([0, 0, 0, 0, 0])
    // With no signal, the phrase falls through to the encouraging default.
    expect(insightPhrase(ins)).toBe('solid — now drill the misses')
  })

  it('reports a per-type underestimate bias when one type dominates', () => {
    const spell = (id: number) => card(id, `Spell ${id}`, 4, 'spell')
    const answers = [
      { card: spell(1), guess: 3, correct: false },
      { card: spell(2), guess: 3, correct: false },
      { card: spell(3), guess: 3, correct: false }
    ]
    const ins = computeInsights(answers)
    expect(ins.biasLine).toBe('you underestimate spells by ~1')
  })

  it('falls back to an overall directional bias when no single type qualifies', () => {
    // Three wrong answers spread across distinct types (each type appears once,
    // so no per-type mean is computed) but a consistent underestimate overall.
    const answers = [
      { card: card(1, 'A', 3, 'troop'), guess: 2, correct: false },
      { card: card(2, 'B', 3, 'building'), guess: 2, correct: false },
      { card: card(3, 'C', 3, 'spell'), guess: 2, correct: false }
    ]
    const ins = computeInsights(answers)
    expect(ins.biasLine).toBe('you underestimate by ~1 elixir')
  })

  it('names the weakest cost band in the non-timed phrase', () => {
    const answers = [
      { card: card(1, 'A', 3), guess: 2, correct: false },
      { card: card(2, 'B', 3), guess: 4, correct: false }
    ]
    const ins = computeInsights(answers)
    expect(ins.hasTiming).toBe(false)
    expect(insightPhrase(ins)).toBe('3 cost cards are your weak spot')
  })

  it('prefers the bias phrase when no band is weak enough and there is no timing', () => {
    // One wrong per band → no band reaches total >= 2, so weakBand is skipped;
    // a consistent underestimate still yields a bias phrase.
    const answers = [
      { card: card(1, 'A', 1, 'troop'), guess: 0, correct: false },
      { card: card(2, 'B', 3, 'building'), guess: 2, correct: false },
      { card: card(3, 'C', 5, 'spell'), guess: 4, correct: false }
    ]
    const ins = computeInsights(answers)
    expect(insightPhrase(ins)).toBe(ins.biasLine)
    expect(ins.biasLine).toBe('you underestimate by ~1 elixir')
  })

  it('praises a near-perfect read', () => {
    const answers = Array.from({ length: 10 }, (_, i) => ({
      card: card(i, `C${i}`, 3),
      guess: 3,
      correct: i !== 0 // 9/10 correct, one miss in the same band (0.9 accuracy)
    }))
    const ins = computeInsights(answers)
    expect(ins.accuracyPct).toBe(90)
    expect(insightPhrase(ins)).toBe('clean read across the board')
  })

  it('bleeds time on the slowest band and ranks the three slowest cards', () => {
    const answers = [
      { card: card(1, 'Fast', 3), guess: 3, correct: true, ms: 400 },
      { card: card(2, 'Mid', 3), guess: 3, correct: true, ms: 900 },
      { card: card(3, 'Slow', 3), guess: 3, correct: true, ms: 1500 },
      { card: card(4, 'Slowest', 3), guess: 3, correct: true, ms: 2200 }
    ]
    const ins = computeInsights(answers)
    expect(ins.hasTiming).toBe(true)
    expect(ins.slowestBandLabel).toBe('3')
    expect(ins.slowestCards?.map((c) => c.name)).toEqual(['Slowest', 'Slow', 'Mid'])
    // No band is weak (all correct), so the phrase is the timing coach line.
    expect(insightPhrase(ins)).toBe('you bleed time on 3 cost cards')
  })
})

// ===========================================================================
// home-data.ts — seasonEndsLabel edge cases (direct calls)
// ===========================================================================

describe('seasonEndsLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-16T10:00:00.000Z')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const seasonEndingIn = (ms: number) => ({
    id: 134,
    startsAt: '2026-07-06T10:00:00.000Z',
    endsAt: new Date(Date.now() + ms).toISOString(),
    durationWeeks: 4
  })

  it('falls back gracefully with no season', () => {
    expect(seasonEndsLabel(null)).toBe('Season in progress')
  })

  it('reports the season as ending once the clock has passed', () => {
    expect(seasonEndsLabel(seasonEndingIn(-1000))).toBe('Season ending')
  })

  it('includes zero-padded hours whenever more than a day remains', () => {
    const label = seasonEndsLabel(seasonEndingIn(6 * 86_400_000 + 4 * 3_600_000))
    expect(label).toBe('Season ends in 6d 04h')
  })

  it('shows hours only inside the final day', () => {
    const label = seasonEndsLabel(seasonEndingIn(5 * 3_600_000 + 60_000))
    expect(label).toBe('Season ends in 5h')
  })
})

// ===========================================================================
// home-data.ts — useHomeData derivations (rank / best merge)
// ===========================================================================

describe('useHomeData derivations', () => {
  let container: HTMLElement
  let homeData: typeof import('../../src/screens/home/home-data')
  let account: typeof import('../../src/lib/account')
  let api: typeof import('../../src/lib/api')

  const season = {
    id: 134,
    startsAt: '2026-07-06T10:00:00.000Z',
    endsAt: FUTURE(),
    durationWeeks: 4
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../../src/lib/api', () => ({
      getStats: vi.fn(),
      getLeaderboard: vi.fn()
    }))
    api = await import('../../src/lib/api')
    account = await import('../../src/lib/account')
    homeData = await import('../../src/screens/home/home-data')
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    void act(() => render(null, container))
    container.remove()
    account.player.value = null
    account.recentRuns.value = []
    vi.doUnmock('../../src/lib/api')
  })

  it('pairs the player season rank with its authoritative board score', async () => {
    const entry = (id: string, rank: number, score: number) => ({
      rank,
      score,
      achievedAt: '2026-07-10T00:00:00.000Z',
      player: { id, publicName: id, totalGames: 5, xp: 1, level: 1 }
    })
    vi.mocked(api.getStats).mockResolvedValue({ trophyRoadGames: 700, currentSeason: season })
    vi.mocked(api.getLeaderboard).mockImplementation((mode) => {
      if (mode === 'surge') {
        return Promise.resolve({
          mode,
          currentSeason: season,
          entries: [entry('ace', 1, 9_000), entry('me', 2, 11_000)]
        })
      }
      return Promise.resolve({ mode, currentSeason: season, entries: [] })
    })

    account.player.value = {
      id: 'me',
      email: 'me@example.com',
      publicName: 'Me',
      totalGames: 5,
      xp: 1,
      level: 1,
      levelStartGames: 0,
      nextLevelGames: 20,
      createdAt: season.startsAt,
      updatedAt: season.startsAt
    }
    // This device only knows a newer, slower run. The player's real season
    // best was set elsewhere and is already reflected by the board row.
    account.recentRuns.value = [
      {
        runId: 'r1',
        mode: 'surge',
        score: 17_020,
        seasonId: season.id,
        completedAt: '2026-07-11T00:00:00.000Z'
      }
    ]

    let captured: import('../../src/screens/home/home-data').HomeData | undefined
    function Probe() {
      captured = homeData.useHomeData()
      return null
    }

    await act(async () => {
      render(<Probe />, container)
    })
    await flush()
    await flush()

    expect(captured?.loading).toBe(false)
    expect(captured?.season?.id).toBe(season.id)
    expect(captured?.stats?.trophyRoadGames).toBe(700)
    // The signed-in player's rank is still pulled from the board for the hero.
    expect(captured?.rankFor('surge')).toBe(2)
    expect(captured?.standingsFor('surge').map((entry) => entry.player.id)).toEqual(['ace', 'me'])
    // Device/all-time fallback remains available, but the current-season Home
    // score comes from the same authoritative row as rank #2.
    expect(captured?.personalBestScores.surge).toBe(17_020)
    expect(captured?.bestScores.surge).toBe(11_000)
  })

  it('leaves every rank undefined for an anonymous visitor', async () => {
    vi.mocked(api.getStats).mockResolvedValue({ trophyRoadGames: 1, currentSeason: season })
    vi.mocked(api.getLeaderboard).mockResolvedValue({ mode: 'surge', currentSeason: season, entries: [] })

    let captured: import('../../src/screens/home/home-data').HomeData | undefined
    function Probe() {
      captured = homeData.useHomeData()
      return null
    }
    await act(async () => {
      render(<Probe />, container)
    })
    await flush()

    expect(captured?.rankFor('surge')).toBeUndefined()
    expect(captured?.standingsFor('surge')).toEqual([])
  })
})

// ===========================================================================
// Profile.tsx — the authed interactive flows
// ===========================================================================

describe('Profile interactive flows', () => {
  let container: HTMLElement
  let Profile: () => preact.ComponentChild
  let account: typeof import('../../src/lib/account')
  let api: typeof import('../../src/lib/api')
  let router: typeof import('../../src/lib/router')
  let useLayout: typeof import('../../src/lib/use-layout')

  const basePlayer = {
    id: 'me',
    email: 'me@example.com',
    totalGames: 12,
    xp: 480,
    level: 2,
    levelStartGames: 10,
    nextLevelGames: 25,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z'
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('../../src/lib/api', () => ({
      ApiError: class ApiError extends Error {
        status: number
        code: string
        constructor(status: number, code: string, message: string) {
          super(message)
          this.status = status
          this.code = code
          this.name = 'ApiError'
        }
      },
      getSeasonHistory: vi.fn(),
      patchMe: vi.fn(),
      deleteMe: vi.fn(),
      getMe: vi.fn(),
      redeemLogin: vi.fn(),
      refreshLogin: vi.fn()
    }))
    api = await import('../../src/lib/api')
    account = await import('../../src/lib/account')
    router = await import('../../src/lib/router')
    useLayout = await import('../../src/lib/use-layout')
    Profile = (await import('../../src/screens/Profile')).default
    container = document.createElement('div')
    document.body.appendChild(container)
    useLayout.layout.value = 'desktop'
    router.route.value = '/profile'
  })

  afterEach(() => {
    void act(() => render(null, container))
    container.remove()
    account.player.value = null
    account.accountStatus.value = 'anonymous'
    account.recentRuns.value = []
    router.route.value = '/'
    useLayout.layout.value = 'desktop'
    document.documentElement.classList.remove('reduce-motion')
    vi.doUnmock('../../src/lib/api')
  })

  // Establish a real session (so account.updateAccount/deleteAccount work) and
  // then overlay the desired player shape.
  async function signIn(overrides: Record<string, unknown> = {}): Promise<void> {
    vi.mocked(api.getMe).mockResolvedValue({ player: basePlayer, recentRuns: [] })
    vi.mocked(api.getSeasonHistory).mockResolvedValue({ index: [], seasons: [] })
    await act(async () => {
      await account.applyPolledSession({ token: 'live', expiresAt: FUTURE() })
    })
    account.player.value = { ...basePlayer, ...overrides } as never
  }

  async function mount(): Promise<void> {
    await act(async () => {
      render(<Profile />, container)
    })
    await flush()
  }

  // --- Guest view ----------------------------------------------------------

  it('renders the guest view and routes to login / home', async () => {
    account.accountStatus.value = 'anonymous'
    account.player.value = null
    await mount()

    expect(container.textContent).toContain('You')
    const link = byText(container, 'Sign In')
    expect(link).toBeTruthy()
    await fire(link as Element)
    expect(router.route.value).toBe('/login')
  })

  it('sends a guest following the old player link to sign in for Account', async () => {
    router.route.value = '/profile?edit=player-tag'
    account.accountStatus.value = 'anonymous'
    account.player.value = null
    await mount()

    await fire(byText(container, 'Sign In') as Element)
    expect(router.route.value).toBe('/login?returnTo=%2Fprofile%3Fscope%3Daccount')
  })

  // --- Identity from Elixir (2026-11-14) ------------------------------------
  // The name is the primary player's game name and the picture the one set in
  // Elixir; Drop has no setup steps, name ideas or player picker.

  const elixirLink = (candidates: unknown[]) => ({
    linkedAt: '2026-09-12T18:00:00.000Z',
    checkedAt: '2026-09-12T18:00:00.000Z',
    verified: false,
    candidates
  })
  const KING = { playerTag: '#20JJJ2CCRU', name: 'King Thing', relationship: 'primary', verified: true }

  it('shows the Elixir name and picture with no setup and an Edit on Elixir link', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'King Thing' })
    await mount()

    expect(container.querySelector('.ed-you__name')?.textContent).toContain('King Thing')
    expect(container.querySelector('.player-avatar img')?.getAttribute('alt')).toBe('Knight profile picture')
    expect(container.textContent).not.toContain('Player Card')
    expect(container.querySelector('.ed-idsetup')).toBeNull()
    const edit = byText(container, 'Edit on Elixir')?.closest('a')
    expect(edit?.getAttribute('href')).toBe('https://elixir.poapkings.com/')
  })

  it('shows the stand-in name and the Drop mark for an account Elixir names no one on', async () => {
    await signIn({})
    await mount()

    expect(container.querySelector('.ed-you__name')?.textContent).toContain('Elixir Player')
    expect(container.querySelector('.player-avatar--fallback')).not.toBeNull()
    expect(container.querySelector('.ed-idsetup')).toBeNull()
  })

  it('renders a hostile game name as text', async () => {
    const hostile = '<img src=x onerror=alert(1)>"&'
    await signIn({ favoriteCardId: 26000000, publicName: hostile })
    await mount()

    expect(container.querySelector('.ed-you__name span')?.textContent).toBe(hostile)
    expect(container.querySelector('.ed-you__name img')).toBeNull()
  })

  it('sends the old choose-a-player link to Account, with no picker', async () => {
    router.route.value = '/profile?edit=player-tag'
    await signIn({
      favoriteCardId: 26000000,
      publicName: 'King Thing',
      playerTag: KING.playerTag,
      elixir: elixirLink([KING])
    })
    await mount()

    expect(router.route.value).toBe('/profile?scope=account')
    expect(container.querySelector('.ed-elixir__candidate')).toBeNull()
    expect(vi.mocked(api.patchMe)).not.toHaveBeenCalled()
  })

  it('points a signed-in player with no Elixir player to Elixir, and keeps a typed tag as not verified', async () => {
    router.route.value = '/profile?scope=account'
    await signIn({ playerTag: '#OLD', elixir: elixirLink([]) })
    await mount()

    expect(container.textContent).toContain('Your Elixir account has no Clash Royale player yet.')
    expect(container.querySelector('a[href="https://elixir.poapkings.com"]')).not.toBeNull()
    expect(container.textContent).toContain('#OLD')
    expect(container.textContent).toContain('as not verified')
    expect(container.querySelector('.ed-elixir__candidate')).toBeNull()
  })

  // --- Delete-account flow -------------------------------------------------

  it('deletes the account after the DELETE confirmation and signs out', async () => {
    vi.mocked(api.deleteMe).mockResolvedValue({ ok: true })
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()

    await fire(byText(container, 'Account') as Element)
    await fire(container.querySelector('.ed-danger__open') as Element)
    const confirm = container.querySelector('#delete-confirmation') as HTMLInputElement
    const deleteBtn = () => container.querySelector('.ed-danger__delete') as HTMLButtonElement

    // Disabled until the exact word is typed.
    expect(deleteBtn().disabled).toBe(true)
    await typeInto(confirm, 'DELETE')
    expect(deleteBtn().disabled).toBe(false)

    await fire(container.querySelector('.ed-danger__confirm') as Element, 'submit')
    expect(vi.mocked(api.deleteMe)).toHaveBeenCalledWith('live', 'DELETE')
    // Signed out → guest view (navigate('/') is a no-op when already at root hash).
    expect(account.accountStatus.value).toBe('anonymous')
    expect(container.textContent).toContain('You')
  })

  it('cancels the delete flow with Keep my account', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Account') as Element)
    await fire(container.querySelector('.ed-danger__open') as Element)
    expect(container.querySelector('#delete-confirmation')).not.toBeNull()

    await fire(byText(container, 'Keep my account') as Element)
    expect(container.querySelector('#delete-confirmation')).toBeNull()
    expect(container.querySelector('.ed-danger__open')).not.toBeNull()
  })

  it('shows an error and stays signed in when deletion fails', async () => {
    vi.mocked(api.deleteMe).mockRejectedValue(new Error('server refused'))
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Account') as Element)
    await fire(container.querySelector('.ed-danger__open') as Element)
    await typeInto(container.querySelector('#delete-confirmation') as HTMLInputElement, 'DELETE')
    await fire(container.querySelector('.ed-danger__confirm') as Element, 'submit')

    expect(container.textContent).toContain('server refused')
    expect(account.accountStatus.value).toBe('authenticated')
  })

  // --- Profile view: recent games / sign out / CR status -------------------

  it('shows the settings toggles in the Settings scope and persists each toggle', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()

    await fire(byText(container, 'Settings') as Element)
    const settings = container.querySelector('.ed-settings') as HTMLElement
    expect(settings).not.toBeNull()
    expect(settings.textContent).toContain('Preferences are per-device and never sync.')

    const sound = settings.querySelector('[aria-label="Sound effects"]') as HTMLButtonElement
    const motion = settings.querySelector('[aria-label="Reduce motion"]') as HTMLButtonElement
    const effects = settings.querySelector('[aria-label="Enhance effects"]') as HTMLButtonElement
    expect(sound.getAttribute('aria-checked')).toBe('false')
    expect(motion.getAttribute('aria-checked')).toBe('false')
    expect(effects.getAttribute('aria-checked')).toBe('true')

    await fire(sound)
    await fire(motion)
    await fire(effects)

    const { getSettings } = await import('../../src/lib/storage')
    expect(getSettings()).toMatchObject({ sound: true, reducedMotion: true, enhancedEffects: false })
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
  })

  const historyRuns = [
    {
      runId: 'r1',
      mode: 'surge' as const,
      score: 12_500,
      seasonId: 134,
      completedAt: '2026-07-19T00:00:00.000Z'
    },
    {
      runId: 'r2',
      mode: 'survival' as const,
      score: 8,
      seasonId: 134,
      completedAt: '2026-07-18T00:00:00.000Z',
      reviewStatus: 'excluded' as const
    },
    {
      runId: 'r3',
      mode: 'surge' as const,
      score: 9_900,
      seasonId: 134,
      completedAt: '2026-07-17T00:00:00.000Z'
    }
  ]

  it('groups your games by day, marks only a removed run, and signs out from the Account scope', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: 134, games: historyRuns.length }],
      seasons: [{ id: 134, games: historyRuns.length, runs: historyRuns }]
    })
    await mount()

    const rows = container.querySelectorAll('.ed-games__row')
    expect(rows).toHaveLength(3)
    // Three runs on three different days → three day groups, each with one game.
    expect(container.querySelectorAll('.ed-games__day-group')).toHaveLength(3)
    expect(container.querySelector('.ed-games__day-head')?.textContent).toContain('1 game')
    expect(container.textContent).toContain('12.500s')
    // No run wears a seal. The one a person removed from the boards says so in
    // words; nothing says Awaiting or Cleared.
    expect(container.querySelectorAll('.ed-games__row .ed-seal')).toHaveLength(0)
    expect(container.querySelectorAll('.ed-games__row [aria-label]')).toHaveLength(0)
    expect(container.textContent).toContain('EXCLUDED')
    expect(container.textContent).not.toContain('AWAITING')
    expect(container.textContent).not.toContain('Awaiting')
    expect(container.textContent).not.toContain('Cleared')

    await fire(byText(container, 'Account') as Element)
    await fire(byText(container, 'Sign out') as Element)
    expect(account.accountStatus.value).toBe('anonymous')
    expect(container.textContent).toContain('You')
  })

  it('counts removed games in the chip and toggles the filter', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: 134, games: historyRuns.length }],
      seasons: [{ id: 134, games: historyRuns.length, runs: historyRuns }]
    })
    await mount()

    // Only the run a person removed from the boards is counted.
    const flagged = container.querySelector('.ed-filterchip--flagged') as HTMLButtonElement
    expect(flagged.textContent).toContain('Excluded 1')

    await fire(flagged)
    expect(flagged.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('.ed-games__row')).toHaveLength(1)

    await fire(flagged)
    expect(container.querySelectorAll('.ed-games__row')).toHaveLength(3)
  })

  it('opens a run detail with its reference and the dispute link for an excluded run', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: 134, games: historyRuns.length }],
      seasons: [{ id: 134, games: historyRuns.length, runs: historyRuns }]
    })
    await mount()

    const excludedRow = [...container.querySelectorAll('.ed-games__row')].find((row) =>
      row.textContent?.includes('EXCLUDED')
    ) as HTMLButtonElement
    await fire(excludedRow)

    // An excluded run swaps the reference block for the referee explanation and
    // a dispute link (the reference rides in the mailto subject).
    const dispute = byText(container, 'Dispute this result') as HTMLAnchorElement
    expect(dispute.getAttribute('href')).toBe(
      `mailto:drop@poapkings.com?subject=${encodeURIComponent(`Elixir Drop run review ${runReference('r2')}`)}`
    )
    expect(container.querySelector('.ed-run-modal__ref')).toBeNull()
  })

  it('shows the run reference with Share in place of Copy in the run sheet', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: 134, games: 1 }],
      seasons: [{ id: 134, games: 1, runs: [historyRuns[2]] }]
    })
    await mount()

    await fire(container.querySelector('.ed-games__row') as HTMLButtonElement)
    // The D-tag stays visible for support, while its action slot publishes the
    // permanent run link instead of copying an internal reference.
    expect(container.querySelector('.ed-run-modal__ref code')?.textContent).toBe(runReference('r3'))
    expect(byText(container, 'SHARE')).toBeTruthy()
    expect(byText(container, 'Copy')).toBeUndefined()
  })

  it('shows the rungs a run moved and opens the badge sheet from one', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    account.badges.value = [{ slug: 'clockbreaker', value: 15, rungIndex: 5 }] as never
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: 134, games: 1 }],
      seasons: [{ id: 134, games: 1, runs: [{ ...historyRuns[2], rungs: ['clockbreaker'] }] }]
    } as never)
    await mount()

    await fire(container.querySelector('.ed-games__row') as HTMLButtonElement)
    expect(container.querySelector('.ed-run-modal__rungs-label')?.textContent).toContain('Rungs moved')
    const rung = container.querySelector('.ed-run-modal__rung') as HTMLButtonElement
    expect(rung).toBeTruthy()

    await fire(rung)
    // Tapping the medallion opens the same badge sheet the wall uses.
    expect(container.querySelector('.ed-badges__sheet')).toBeTruthy()
  })

  it('shows the empty games hint when there are no runs', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()

    expect(container.querySelector('.ed-games__row')).toBeNull()
    // Art, a heading, a line, and a button that actually goes somewhere.
    expect(container.textContent).toContain('Nothing played yet')
    expect(container.textContent).toContain('Your finished games land here, newest first.')
    const art = container.querySelector<HTMLImageElement>('.ed-games .ed-empty__art')
    expect(art?.getAttribute('src')).toBe('/assets/empty/empty-runs-512.png')
    expect(byText(container, 'Play Surge')).toBeTruthy()
  })

  it('renders each Clash Royale status branch', async () => {
    await signIn({
      favoriteCardId: 26000000,
      publicName: 'Knight Main',
      clashRoyale: { tag: '#ABC', status: 'pending' }
    })
    await mount()
    await fire(byText(container, 'Account') as Element)
    // Drop reads name and clan only at Sign in with Elixir (2026-11-13): every
    // status but ready says so, and none promises a background retry.
    const notRead = '#ABC: sign in with Elixir again to show its name and clan.'
    expect(container.textContent).toContain(notRead)
    for (const status of ['not_found', 'unavailable'] as const) {
      await act(async () => {
        account.player.value = { ...account.player.value, clashRoyale: { tag: '#ABC', status } } as never
      })
      await flush()
      expect(container.textContent).toContain(notRead)
      expect(container.textContent).not.toContain('retry automatically')
    }
  })

  // --- Polling + message transitions ---------------------------------------

  it('never polls for a CR profile, even one an older API calls pending', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main', clashRoyale: { tag: '#X', status: 'pending' } })
    vi.mocked(api.getMe).mockClear()
    vi.mocked(api.getMe).mockResolvedValue({ player: account.player.value as never, recentRuns: [] })

    vi.useFakeTimers()
    await act(async () => {
      render(<Profile />, container)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(vi.mocked(api.getMe)).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// ===========================================================================
// api.ts — a few remaining branches (real module, stubbed fetch)
// ===========================================================================

describe('api.ts remaining branches', () => {
  const API_BASE = 'https://api.example'

  function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('getActivity defaults to a limit of 8', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ apiBaseUrl: API_BASE }))
      .mockResolvedValueOnce(json({ seasonId: 134, entries: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { getActivity } = await import('../../src/lib/api')

    await getActivity()
    const endpoint = fetchMock.mock.calls.find(([url]) => !String(url).endsWith('/api-config.json'))
    expect(String(endpoint?.[0])).toBe(`${API_BASE}/activity?limit=8`)
  })

  it('maps a network failure to a network_unavailable ApiError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ apiBaseUrl: API_BASE }))
      .mockRejectedValueOnce(new Error('socket hang up'))
    vi.stubGlobal('fetch', fetchMock)
    const { redeemLogin } = await import('../../src/lib/api')

    await expect(redeemLogin('t')).rejects.toMatchObject({ status: 0, code: 'network_unavailable' })
  })

  it('maps an externally aborted request to request_cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ apiBaseUrl: API_BASE }))
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)
    const { getActivity } = await import('../../src/lib/api')

    await expect(getActivity(8, controller.signal)).rejects.toMatchObject({ status: 0, code: 'request_cancelled' })
  })

  it('resets the cached config after a failure so a later call can recover', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(json({ apiBaseUrl: API_BASE }))
      .mockResolvedValueOnce(json({ seasonId: 134, entries: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { getActivity } = await import('../../src/lib/api')

    await expect(getActivity()).rejects.toMatchObject({ code: 'network_unavailable' })
    // configPromise was cleared, so the retry re-fetches config and succeeds.
    await expect(getActivity()).resolves.toMatchObject({ seasonId: 134 })
  })
})
