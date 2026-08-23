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
    // The signed-in player's rank is still pulled from the board for the hero.
    expect(captured?.rankFor('surge')).toBe(2)
    expect(captured?.standingsFor('surge').map((entry) => entry.player.id)).toEqual(['ace', 'me'])
    // The recent run (8_500) beats the empty stored record and merges in.
    expect(captured?.personalBestScores.surge).toBe(8_500)
    expect(captured?.bestScores.surge).toBe(8_500)
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
      getNameOptions: vi.fn(),
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
    render(null, container)
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

  // Identity setup is three steps (card → name → tag). These helpers reach into
  // the step chrome.
  const primary = () => container.querySelector('.ed-idsetup__actions .ed-btn--gold') as HTMLButtonElement
  const backBtn = () => container.querySelector('.ed-idsetup__top .ed-iconbtn') as HTMLButtonElement

  // --- Identity setup: name step (Edit opens step 2) -----------------------

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

    // Edit opens step 2 with names generated from the current card.
    await fire(byText(container, 'Edit') as Element)
    const options = [...container.querySelectorAll('.name-option')]
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Knight Prime', 'Sir Tap'])

    // Select a name → highlighted; CONTINUE saves the card + name + token.
    await fire(options[0])
    await fire(primary())
    expect(vi.mocked(api.patchMe)).toHaveBeenCalledWith('live', {
      favoriteCardId: 26000000,
      publicName: 'Knight Prime',
      nameToken: 'tok-1'
    })
    expect(account.player.value?.publicName).toBe('Knight Prime')
    // An edit (card already existed) closes back to the You view.
    expect(container.querySelector('.ed-idsetup')).toBeNull()
  })

  it('surfaces a name-generation failure message', async () => {
    vi.mocked(api.getNameOptions).mockRejectedValue(new Error('rate limited'))
    await signIn({ favoriteCardId: 26000000, publicName: 'Old Name' })
    await mount()
    await fire(byText(container, 'Edit') as Element)

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
    await fire(container.querySelector('.name-option') as Element)
    await fire(primary())

    expect(container.textContent).toContain('identity save failed')
    // Still in the setup flow (the step chrome is present).
    expect(container.querySelector('.ed-idsetup')).not.toBeNull()
  })

  // --- First-time setup: the whole flow (card → name → tag) ----------------

  it('runs setup card → name → tag and returns to the pending game', async () => {
    router.route.value = '/profile?returnTo=/surge'
    vi.mocked(api.getNameOptions).mockResolvedValue({
      favoriteCardId: 26000000,
      names: ['Knight Prime'],
      nameToken: 'tok-1'
    })
    vi.mocked(api.patchMe).mockResolvedValue({
      player: { ...basePlayer, favoriteCardId: 26000000, publicName: 'Knight Prime' }
    })
    // No favorite card yet → setup opens at step 1 (card), with the step counter.
    await signIn({})
    await mount()
    expect(container.textContent).toContain('Step 1 of 3')
    // CONTINUE is disabled until a card is chosen.
    expect(primary().disabled).toBe(true)

    // Step 1: choose a card, then CONTINUE to the name step.
    await fire(container.querySelector('.favorite-card') as Element)
    expect(primary().disabled).toBe(false)
    await fire(primary())

    // Step 2: choose a name, then CONTINUE saves and advances to the tag step.
    await fire(container.querySelector('.name-option') as Element)
    await fire(primary())
    expect(vi.mocked(api.patchMe)).toHaveBeenCalledWith(
      'live',
      expect.objectContaining({ favoriteCardId: expect.any(Number), publicName: 'Knight Prime', nameToken: 'tok-1' })
    )
    expect(container.textContent).toContain('Step 3 of 3')

    // Step 3: Skip → returns to the pending game.
    await fire(byText(container, 'Skip') as Element)
    expect(router.route.value).toBe('/surge')
  })

  it('finishes first-time setup on Home when no game is pending', async () => {
    window.location.hash = '/profile'
    await flush()
    router.route.value = '/profile'
    vi.mocked(api.getNameOptions).mockResolvedValue({
      favoriteCardId: 26000000,
      names: ['Knight Prime'],
      nameToken: 'tok-1'
    })
    vi.mocked(api.patchMe).mockResolvedValue({
      player: { ...basePlayer, favoriteCardId: 26000000, publicName: 'Knight Prime' }
    })
    await signIn({})
    await mount()

    await fire(container.querySelector('.favorite-card') as Element)
    await fire(primary()) // card → name
    await fire(container.querySelector('.name-option') as Element)
    await fire(primary()) // name saved → tag step
    await fire(byText(container, 'Skip') as Element)

    expect(router.parseHash()).toBe('/')
  })

  // --- Identity setup: card step (reached by stepping back) ----------------

  it('filters the card grid and reports an empty search', async () => {
    vi.mocked(api.getNameOptions).mockResolvedValue({ favoriteCardId: 26000000, names: [], nameToken: 't' })
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element) // step 2 (name)
    await fire(backBtn()) // back → step 1 (card grid)

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
    vi.mocked(api.getNameOptions).mockResolvedValue({ favoriteCardId: 26000000, names: [], nameToken: 't' })
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()
    await fire(byText(container, 'Edit') as Element)
    await fire(backBtn()) // back → card grid

    const searchInput = container.querySelector('input[placeholder="Search cards"]') as HTMLInputElement
    await typeInto(searchInput, 'archer')
    const archers = container.querySelector('.favorite-card') as HTMLButtonElement
    const label = archers.getAttribute('aria-label')
    await fire(archers)

    const selected = container.querySelector('.favorite-card--selected')
    expect(selected?.getAttribute('aria-label')).toBe(label)
    expect(selected?.getAttribute('aria-pressed')).toBe('true')
  })

  // --- Player tag step (reached from Account via ?edit=player-tag) ---------

  it('saves a player tag and closes back to You', async () => {
    router.route.value = '/profile?edit=player-tag'
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

    const tagInput = container.querySelector('.ed-idsetup__tagform input') as HTMLInputElement
    await typeInto(tagInput, '#ABC')
    await fire(container.querySelector('.ed-idsetup__tagform') as Element, 'submit')

    expect(vi.mocked(api.patchMe)).toHaveBeenCalledWith('live', { playerTag: '#ABC' })
    expect(container.querySelector('.ed-idsetup')).toBeNull()
  })

  it('removes a player tag when the field is cleared', async () => {
    router.route.value = '/profile?edit=player-tag'
    vi.mocked(api.patchMe).mockResolvedValue({ player: { ...basePlayer, favoriteCardId: 26000000 } })
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main', playerTag: '#OLD' })
    await mount()

    const tagInput = container.querySelector('.ed-idsetup__tagform input') as HTMLInputElement
    await typeInto(tagInput, '')
    await fire(container.querySelector('.ed-idsetup__tagform') as Element, 'submit')

    expect(vi.mocked(api.patchMe)).toHaveBeenCalledWith('live', { playerTag: null })
  })

  it('surfaces a tag save failure and stays on the tag step', async () => {
    router.route.value = '/profile?edit=player-tag'
    vi.mocked(api.patchMe).mockRejectedValue(new Error('tag rejected'))
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    await mount()

    const tagInput = container.querySelector('.ed-idsetup__tagform input') as HTMLInputElement
    await typeInto(tagInput, '#BAD')
    await fire(container.querySelector('.ed-idsetup__tagform') as Element, 'submit')

    expect(container.textContent).toContain('tag rejected')
    expect(container.querySelector('.ed-idsetup__tagform')).not.toBeNull()
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
      seasonId: '2026-07',
      completedAt: '2026-07-19T00:00:00.000Z',
      reviewStatus: 'pending' as const
    },
    {
      runId: 'r2',
      mode: 'survival' as const,
      score: 8,
      seasonId: '2026-07',
      completedAt: '2026-07-18T00:00:00.000Z',
      reviewStatus: 'excluded' as const
    },
    {
      runId: 'r3',
      mode: 'surge' as const,
      score: 9_900,
      seasonId: '2026-07',
      completedAt: '2026-07-17T00:00:00.000Z'
    }
  ]

  it('groups your games by day, seals each row, and signs out from the Account scope', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: '2026-07', games: historyRuns.length, crSeasonId: 134 }],
      seasons: [{ id: '2026-07', games: historyRuns.length, runs: historyRuns }]
    })
    await mount()

    const rows = container.querySelectorAll('.ed-games__row')
    expect(rows).toHaveLength(3)
    // Three runs on three different days → three day groups, each with one game.
    expect(container.querySelectorAll('.ed-games__day-group')).toHaveLength(3)
    expect(container.querySelector('.ed-games__day-head')?.textContent).toContain('1 game')
    expect(container.textContent).toContain('12.500s')
    // A run no referee touched wears no seal at all; only the held and the
    // excluded run are marked.
    const rowSeals = (label: string) =>
      [...container.querySelectorAll('.ed-games__row')].filter((row) => row.querySelector(`[aria-label="${label}"]`))
    expect(rowSeals('Referee cleared')).toHaveLength(0)
    expect(rowSeals('Awaiting referee')).toHaveLength(1)
    expect(rowSeals('Not ranked')).toHaveLength(1)
    expect(container.textContent).toContain('AWAITING')
    expect(container.textContent).toContain('EXCLUDED')

    await fire(byText(container, 'Account') as Element)
    await fire(byText(container, 'Sign out') as Element)
    expect(account.accountStatus.value).toBe('anonymous')
    expect(container.textContent).toContain('You')
  })

  it('counts flagged games in the chip and toggles the filter', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: '2026-07', games: historyRuns.length, crSeasonId: 134 }],
      seasons: [{ id: '2026-07', games: historyRuns.length, runs: historyRuns }]
    })
    await mount()

    // Two of the three runs carry a referee status (pending + excluded); the
    // unreviewed one is not flagged.
    const flagged = container.querySelector('.ed-filterchip--flagged') as HTMLButtonElement
    expect(flagged.textContent).toContain('Flagged 2')

    await fire(flagged)
    expect(flagged.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('.ed-games__row')).toHaveLength(2)

    await fire(flagged)
    expect(container.querySelectorAll('.ed-games__row')).toHaveLength(3)
  })

  it('opens a run detail with its reference and the dispute link for an excluded run', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: '2026-07', games: historyRuns.length, crSeasonId: 134 }],
      seasons: [{ id: '2026-07', games: historyRuns.length, runs: historyRuns }]
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
      index: [{ id: '2026-07', games: 1, crSeasonId: 134 }],
      seasons: [{ id: '2026-07', games: 1, runs: [historyRuns[2]] }]
    })
    await mount()

    await fire(container.querySelector('.ed-games__row') as HTMLButtonElement)
    // The D-tag stays visible for support, while its action slot publishes the
    // permanent run link instead of copying an internal reference.
    expect(container.querySelector('.ed-run-modal__ref code')?.textContent).toBe(runReference('r3'))
    expect(byText(container, 'Share this run')).toBeTruthy()
    expect(byText(container, 'Copy')).toBeUndefined()
  })

  it('shows the rungs a run moved and opens the badge sheet from one', async () => {
    await signIn({ favoriteCardId: 26000000, publicName: 'Knight Main' })
    account.badges.value = [{ slug: 'clockbreaker', value: 15, rungIndex: 5 }] as never
    vi.mocked(api.getSeasonHistory).mockResolvedValue({
      index: [{ id: '2026-07', games: 1, crSeasonId: 134 }],
      seasons: [{ id: '2026-07', games: 1, runs: [{ ...historyRuns[2], rungs: ['clockbreaker'] }] }]
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
    expect(container.textContent).toContain('Loading #ABC')

    await act(async () => {
      account.player.value = { ...account.player.value, clashRoyale: { tag: '#ABC', status: 'not_found' } } as never
    })
    await flush()
    expect(container.textContent).toContain('could not find #ABC')

    await act(async () => {
      account.player.value = { ...account.player.value, clashRoyale: { tag: '#ABC', status: 'unavailable' } } as never
    })
    await flush()
    expect(container.textContent).toContain('Profile refresh delayed')
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
