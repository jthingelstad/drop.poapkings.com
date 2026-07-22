import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { computeInsights, insightPhrase } from '../../src/lib/insights'
import { seasonEndsLabel } from '../../src/screens/home/home-data'
import type { Card } from '../../src/types'

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
  const seasonEndingIn = (ms: number) => ({
    id: '2026-07',
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

  it('shows only days when more than a day remains and hours are not requested', () => {
    const label = seasonEndsLabel(seasonEndingIn(6 * 86_400_000 + 4 * 3_600_000))
    expect(label).toBe('Season ends in 6d')
  })

  it('includes zero-padded hours when withHours is set', () => {
    const label = seasonEndsLabel(seasonEndingIn(6 * 86_400_000 + 4 * 3_600_000), true)
    expect(label).toBe('Season ends in 6d 04h')
  })

  it('shows hours only inside the final day', () => {
    const label = seasonEndsLabel(seasonEndingIn(5 * 3_600_000 + 60_000))
    expect(label).toBe('Season ends in 5h')
  })
})

// ===========================================================================
// home-data.ts — useHomeData derivations (standings / champion / best merge)
// ===========================================================================

describe('useHomeData derivations', () => {
  let container: HTMLElement
  let homeData: typeof import('../../src/screens/home/home-data')
  let account: typeof import('../../src/lib/account')
  let api: typeof import('../../src/lib/api')

  const season = {
    id: '2026-07',
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
    render(null, container)
    container.remove()
    account.player.value = null
    account.recentRuns.value = []
    vi.doUnmock('../../src/lib/api')
  })

  it('derives champion, surge standings, the player rank, and merges best scores', async () => {
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
    // A recent surge run that beats any stored record (lower is better).
    account.recentRuns.value = [
      { runId: 'r1', mode: 'surge', score: 8_500, seasonId: season.id, completedAt: '2026-07-11T00:00:00.000Z' }
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
    // championFor(surge) is the rank-1 entry.
    expect(captured?.championFor('surge')?.player.id).toBe('ace')
    // Non-surge board with no entries has no champion.
    expect(captured?.championFor('trade')).toBeUndefined()
    expect(captured?.surgeStandings).toHaveLength(2)
    // The signed-in player's rank is pulled from the surge board.
    expect(captured?.surgeRank).toBe(2)
    // The recent run (8_500) beats the empty stored record and merges in.
    expect(captured?.bestScores.surge).toBe(8_500)
  })

  it('leaves the surge rank undefined for an anonymous visitor', async () => {
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

    expect(captured?.surgeRank).toBeUndefined()
    expect(captured?.surgeStandings).toEqual([])
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
      getNameOptions: vi.fn(),
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
    render(null, container)
    container.remove()
    account.player.value = null
    account.accountStatus.value = 'anonymous'
    account.recentRuns.value = []
    router.route.value = '/'
    useLayout.layout.value = 'desktop'
    vi.doUnmock('../../src/lib/api')
  })

  // Establish a real session (so account.updateAccount/deleteAccount work) and
  // then overlay the desired player shape.
  async function signIn(overrides: Record<string, unknown> = {}): Promise<void> {
    vi.mocked(api.getMe).mockResolvedValue({ player: basePlayer, recentRuns: [] })
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

    expect(container.textContent).toContain('Player profile')
    const link = byText(container, 'Send magic link')
    expect(link).toBeTruthy()
    await fire(link as Element)
    expect(router.route.value).toBe('/login')
  })

  it('gates the guest More list on the mobile layout', async () => {
    account.accountStatus.value = 'anonymous'
    account.player.value = null
    useLayout.layout.value = 'desktop'
    await mount()
    expect(container.querySelector('.ed-morelist')).toBeNull()

    await act(async () => {
      useLayout.layout.value = 'mobile'
    })
    await flush()
    expect(container.querySelector('.ed-morelist')).not.toBeNull()
  })

  // --- Identity editor: name ideas -----------------------------------------

  it('generates name ideas and saves the chosen name', async () => {
    vi.mocked(api.getNameOptions).mockResolvedValue({
      favoriteCardId: 26000000,
      names: ['Knight Prime', 'Sir Tap'],
      nameToken: 'tok-1'
    })
    vi.mocked(api.patchMe).mockResolvedValue({
      player: { ...basePlayer, favoriteCardId: 26000000, publicName: 'Knight Prime' }
    })
    await signIn({ favoriteCardId: 26000000, publicName: 'Old Name' })
    await mount()

    // Enter the editor from the profile view.
    await fire(byText(container, 'Edit') as Element)
    expect(container.querySelector('input[placeholder="Search cards"]')).not.toBeNull()

    // Get name ideas → mocked options render.
    await fire(byText(container, 'Get name ideas') as Element)
    const options = [...container.querySelectorAll('.name-option')]
    expect(options.map((o) => o.textContent)).toEqual(['Knight Prime', 'Sir Tap'])

    // Pick one → patchMe called with the card + name + token; player updates.
    await fire(options[0])
    expect(vi.mocked(api.patchMe)).toHaveBeenCalledWith('live', {
      favoriteCardId: 26000000,
      publicName: 'Knight Prime',
      nameToken: 'tok-1'
    })
    expect(account.player.value?.publicName).toBe('Knight Prime')
    // Back to the profile view with a confirmation message.
    expect(container.textContent).toContain('Knight is now your favorite card.')
  })

  it('surfaces a name-generation failure message', async () => {
    vi.mocked(api.getNameOptions).mockRejectedValue(new Error('rate limited'))
    await signIn({ favoriteCardId: 26000000, publicName: 'Old Name' })
    await mount()
    await fire(byText(container, 'Edit') as Element)
    await fire(byText(container, 'Get name ideas') as Element)

    expect(container.textContent).toContain('rate limited')
    expect(container.querySelectorAll('.name-option')).toHaveLength(0)
  })

  it('surfaces a save failure when choosing a name', async () => {
    vi.mocked(api.getNameOptions).mockResolvedValue({
      favoriteCardId: 26000000,
      names: ['Knight Prime'],
      nameToken: 'tok-1'
    })
    vi.mocked(api.patchMe).mockRejectedValue(new Error('identity save failed'))
    await signIn({ favoriteCardId: 26000000, publicName: 'Old Name' })
    await mount()
    await fire(byText(container, 'Edit') as Element)
    await fire(byText(container, 'Get name ideas') as Element)
    await fire(container.querySelector('.name-option') as Element)

    expect(container.textContent).toContain('identity save failed')
    // Still in the editor (search field present).
    expect(container.querySelector('input[placeholder="Search cards"]')).not.toBeNull()
  })

  it('navigates back to the pending game after choosing a name with a returnTo', async () => {
    router.route.value = '/profile?returnTo=/surge'
    vi.mocked(api.getNameOptions).mockResolvedValue({
      favoriteCardId: 26000000,
      names: ['Knight Prime'],
      nameToken: 'tok-1'
    })
    vi.mocked(api.patchMe).mockResolvedValue({
      player: { ...basePlayer, favoriteCardId: 26000000, publicName: 'Knight Prime' }
    })
    // No favorite card yet → editor opens straight to setup, note visible.
    await signIn({})
    await mount()
    expect(container.textContent).toContain('continue to your game')

    // Select a card first (setup has no preselected favorite), then name.
    await fire(container.querySelector('.favorite-card') as Element)
    await fire(byText(container, 'Get name ideas') as Element)
    await fire(container.querySelector('.name-option') as Element)

    expect(router.route.value).toBe('/surge')
  })

  // --- Identity editor: card search + selection ----------------------------

  it('filters the card grid and reports an empty search', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element)

    const searchInput = container.querySelector('input[placeholder="Search cards"]') as HTMLInputElement
    await typeInto(searchInput, 'zzzzzzz')
    expect(container.querySelector('.favorite-card-empty')).not.toBeNull()
    expect(container.querySelectorAll('.favorite-card')).toHaveLength(0)

    await typeInto(searchInput, 'knight')
    const names = [...container.querySelectorAll('.favorite-card')].map((c) => c.getAttribute('aria-label'))
    expect(names).toContain('Knight')
    expect(container.querySelector('.favorite-card-empty')).toBeNull()
  })

  it('selects a different favorite card and reflects it as pressed', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element)

    const searchInput = container.querySelector('input[placeholder="Search cards"]') as HTMLInputElement
    await typeInto(searchInput, 'archer')
    const archers = container.querySelector('.favorite-card') as HTMLButtonElement
    const label = archers.getAttribute('aria-label')
    await fire(archers)

    const selected = container.querySelector('.favorite-card--selected')
    expect(selected?.getAttribute('aria-label')).toBe(label)
    expect(selected?.getAttribute('aria-pressed')).toBe('true')
  })

  // --- Player tag flow -----------------------------------------------------

  it('saves a player tag and shows the CR loading message', async () => {
    vi.mocked(api.patchMe).mockResolvedValue({
      player: {
        ...basePlayer,
        favoriteCardId: 26000000,
        playerTag: '#ABC',
        clashRoyale: { tag: '#ABC', status: 'pending' }
      }
    })
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element)

    const tagInput = container.querySelector('.ed-edit__tagform input') as HTMLInputElement
    await typeInto(tagInput, '#ABC')
    await fire(container.querySelector('.ed-edit__tagform') as Element, 'submit')

    expect(vi.mocked(api.patchMe)).toHaveBeenCalledWith('live', { playerTag: '#ABC' })
    expect(container.textContent).toContain('Loading its public Clash Royale profile')
  })

  it('reports tag removal when the field is cleared', async () => {
    vi.mocked(api.patchMe).mockResolvedValue({ player: { ...basePlayer, favoriteCardId: 26000000 } })
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main', playerTag: '#OLD' })
    await mount()
    await fire(byText(container, 'Edit') as Element)

    const tagInput = container.querySelector('.ed-edit__tagform input') as HTMLInputElement
    await typeInto(tagInput, '')
    await fire(container.querySelector('.ed-edit__tagform') as Element, 'submit')

    expect(vi.mocked(api.patchMe)).toHaveBeenCalledWith('live', { playerTag: null })
    expect(container.textContent).toContain('Player tag removed.')
  })

  it('surfaces a tag save failure', async () => {
    vi.mocked(api.patchMe).mockRejectedValue(new Error('tag rejected'))
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element)

    const tagInput = container.querySelector('.ed-edit__tagform input') as HTMLInputElement
    await typeInto(tagInput, '#BAD')
    await fire(container.querySelector('.ed-edit__tagform') as Element, 'submit')

    expect(container.textContent).toContain('tag rejected')
  })

  // --- Delete-account flow -------------------------------------------------

  it('deletes the account after the DELETE confirmation and signs out', async () => {
    vi.mocked(api.deleteMe).mockResolvedValue({ ok: true })
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element)

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
    expect(container.textContent).toContain('Player profile')
  })

  it('cancels the delete flow with Keep my account', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element)
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
    await fire(byText(container, 'Edit') as Element)
    await fire(container.querySelector('.ed-danger__open') as Element)
    await typeInto(container.querySelector('#delete-confirmation') as HTMLInputElement, 'DELETE')
    await fire(container.querySelector('.ed-danger__confirm') as Element, 'submit')

    expect(container.textContent).toContain('server refused')
    expect(account.accountStatus.value).toBe('authenticated')
  })

  // --- Profile view: recent games / sign out / CR status -------------------

  it('lists recent games and signs out from the profile view', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    account.recentRuns.value = [
      { runId: 'r1', mode: 'surge', score: 12_500, seasonId: '2026-07', completedAt: '2026-07-19T00:00:00.000Z' },
      { runId: 'r2', mode: 'survival', score: 8, seasonId: '2026-07', completedAt: '2026-07-18T00:00:00.000Z' }
    ]
    await mount()

    const items = container.querySelectorAll('.ed-profile__recent-list li')
    expect(items).toHaveLength(2)
    expect(container.textContent).toContain('Surge')
    expect(container.textContent).toContain('12.50s')

    await fire(byText(container, 'Sign out') as Element)
    expect(account.accountStatus.value).toBe('anonymous')
    expect(container.textContent).toContain('Player profile')
  })

  it('shows the empty recent-games hint when there are no runs', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    account.recentRuns.value = []
    await mount()

    expect(container.querySelector('.ed-profile__recent-list')).toBeNull()
    expect(container.textContent).toContain('Finish a game and your recent scores will appear here.')
  })

  it('renders each Clash Royale status branch', async () => {
    await signIn({
      favoriteCardId: 26000000,
      publicName: 'Knight Main',
      clashRoyale: { tag: '#ABC', status: 'pending' }
    })
    await mount()
    expect(container.textContent).toContain('Loading Clash Royale profile')
    expect(container.textContent).toContain('#ABC')

    await act(async () => {
      account.player.value = { ...account.player.value, clashRoyale: { tag: '#ABC', status: 'not_found' } } as never
    })
    await flush()
    expect(container.textContent).toContain('Player tag not found')

    await act(async () => {
      account.player.value = { ...account.player.value, clashRoyale: { tag: '#ABC', status: 'unavailable' } } as never
    })
    await flush()
    expect(container.textContent).toContain('Profile refresh delayed')
  })

  it('gates the More list on the mobile layout in the profile view', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    useLayout.layout.value = 'desktop'
    await mount()
    expect(container.querySelector('.ed-morelist')).toBeNull()

    await act(async () => {
      useLayout.layout.value = 'mobile'
    })
    await flush()
    expect(container.querySelector('.ed-morelist')).not.toBeNull()
  })

  // --- Polling + message transitions ---------------------------------------

  it('polls refreshAccount while the CR profile is pending', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main', clashRoyale: { tag: '#X', status: 'pending' } })
    vi.mocked(api.getMe).mockClear()
    vi.mocked(api.getMe).mockResolvedValue({ player: account.player.value as never, recentRuns: [] })

    vi.useFakeTimers()
    await act(async () => {
      render(<Profile />, container)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100)
    })
    expect(vi.mocked(api.getMe)).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('advances the loading message when the CR status resolves', async () => {
    vi.mocked(api.patchMe).mockResolvedValue({
      player: {
        ...basePlayer,
        favoriteCardId: 26000000,
        playerTag: '#X',
        clashRoyale: { tag: '#X', status: 'pending' }
      }
    })
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element)

    const tagInput = container.querySelector('.ed-edit__tagform input') as HTMLInputElement
    await typeInto(tagInput, '#X')
    await fire(container.querySelector('.ed-edit__tagform') as Element, 'submit')
    expect(container.textContent).toContain('Loading its public Clash Royale profile')

    // Status flips to ready → the effect swaps the message.
    await act(async () => {
      account.player.value = {
        ...account.player.value,
        clashRoyale: { tag: '#X', status: 'ready', name: 'CR Name' }
      } as never
    })
    await flush()
    expect(container.textContent).toContain('Clash Royale profile loaded.')
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
      .mockResolvedValueOnce(json({ seasonId: '2026-07', entries: [] }))
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
      .mockResolvedValueOnce(json({ seasonId: '2026-07', entries: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { getActivity } = await import('../../src/lib/api')

    await expect(getActivity()).rejects.toMatchObject({ code: 'network_unavailable' })
    // configPromise was cleared, so the retry re-fetches config and succeeds.
    await expect(getActivity()).resolves.toMatchObject({ seasonId: '2026-07' })
  })
})
