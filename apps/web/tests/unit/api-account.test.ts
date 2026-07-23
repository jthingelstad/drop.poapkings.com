import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Shared fixtures -------------------------------------------------------

const API_BASE = 'https://api.example'
const ISO = '2026-07-10T00:00:00.000Z'
const FUTURE = () => new Date(Date.now() + 1_000_000).toISOString()

const season = {
  id: '2026-07',
  startsAt: '2026-07-06T10:00:00.000Z',
  endsAt: '2026-08-03T10:00:00.000Z',
  durationWeeks: 4
}

const playerFixture = {
  id: 'p1',
  email: 'ace@example.com',
  publicName: 'Ace',
  totalGames: 10,
  xp: 5,
  level: 2,
  levelStartGames: 0,
  nextLevelGames: 20,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: ISO
}

const publicPlayer = {
  id: 'p1',
  publicName: 'Ace',
  totalGames: 10,
  xp: 5,
  level: 2
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

// ===========================================================================
// api.ts — fetch is mocked; the real module is exercised.
// ===========================================================================

describe('api.ts request helpers', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Build a fetch mock whose first call answers /api-config.json and whose
  // second answers the endpoint under test.
  function stubFetch(endpointResponse: Response, baseUrl = API_BASE) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ apiBaseUrl: baseUrl }))
      .mockResolvedValueOnce(endpointResponse)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  // The request that is not the /api-config.json bootstrap.
  function endpointCall(fetchMock: ReturnType<typeof vi.fn>) {
    const call = fetchMock.mock.calls.find(([url]) => !String(url).endsWith('/api-config.json'))
    if (!call) throw new Error('endpoint fetch was never issued')
    const [url, init] = call as [string, RequestInit & { headers: Headers }]
    return { url, init, headers: init.headers }
  }

  it('requestLogin POSTs the email to /auth/request and returns the parsed body', async () => {
    const fetchMock = stubFetch(json({ ok: true, message: 'Check your email.', pollId: 'poll-1' }))
    const { requestLogin } = await import('../../src/lib/api')

    const result = await requestLogin('ace@example.com', '/surge')

    expect(result).toEqual({ ok: true, message: 'Check your email.', pollId: 'poll-1' })
    const { url, init } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/auth/request`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'ace@example.com', returnTo: '/surge' })
  })

  it('sets accept and content-type headers on a body request', async () => {
    const fetchMock = stubFetch(json({ ok: true, message: 'ok' }))
    const { requestLogin } = await import('../../src/lib/api')

    await requestLogin('ace@example.com')
    const { headers } = endpointCall(fetchMock)
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('redeemLogin POSTs the token to /auth/redeem', async () => {
    const fetchMock = stubFetch(json({ session: { token: 's1', expiresAt: FUTURE() } }))
    const { redeemLogin } = await import('../../src/lib/api')

    const result = await redeemLogin('magic-token')
    expect(result.session.token).toBe('s1')
    const { url, init } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/auth/redeem`)
    expect(JSON.parse(init.body as string)).toEqual({ token: 'magic-token' })
  })

  it('pollLogin returns the not-ready and ready shapes', async () => {
    stubFetch(json({ ready: false }))
    const { pollLogin } = await import('../../src/lib/api')
    await expect(pollLogin('poll-1')).resolves.toEqual({ ready: false })

    vi.resetModules()
    const session = { token: 's2', expiresAt: FUTURE() }
    stubFetch(json({ ready: true, session }))
    const { pollLogin: pollAgain } = await import('../../src/lib/api')
    await expect(pollAgain('poll-1')).resolves.toEqual({ ready: true, session })
  })

  it('refreshLogin sends the bearer token to /auth/refresh', async () => {
    const fetchMock = stubFetch(json({ session: { token: 's3', expiresAt: FUTURE() } }))
    const { refreshLogin } = await import('../../src/lib/api')

    await refreshLogin('session-token')
    const { url, init, headers } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/auth/refresh`)
    expect(init.method).toBe('POST')
    expect(headers.get('authorization')).toBe('Bearer session-token')
  })

  it('getMe GETs /me with the bearer token and returns player + runs', async () => {
    const fetchMock = stubFetch(json({ player: playerFixture, recentRuns: [] }))
    const { getMe } = await import('../../src/lib/api')

    const result = await getMe('tok')
    expect(result.player.id).toBe('p1')
    expect(result.recentRuns).toEqual([])
    const { url, init, headers } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/me`)
    expect(init.method ?? 'GET').toBe('GET')
    expect(headers.get('authorization')).toBe('Bearer tok')
  })

  it('getNameOptions POSTs the favorite card to /me/name-options', async () => {
    const fetchMock = stubFetch(json({ favoriteCardId: 26000000, names: ['Ace'], nameToken: 'nt' }))
    const { getNameOptions } = await import('../../src/lib/api')

    const result = await getNameOptions('tok', 26000000)
    expect(result.nameToken).toBe('nt')
    const { url, init } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/me/name-options`)
    expect(JSON.parse(init.body as string)).toEqual({ favoriteCardId: 26000000 })
  })

  it('patchMe PATCHes /me and returns the updated player', async () => {
    const fetchMock = stubFetch(json({ player: { ...playerFixture, publicName: 'NewName' } }))
    const { patchMe } = await import('../../src/lib/api')

    const result = await patchMe('tok', { publicName: 'NewName' })
    expect(result.player.publicName).toBe('NewName')
    const { url, init } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/me`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ publicName: 'NewName' })
  })

  it('deleteMe DELETEs /me with the confirmation', async () => {
    const fetchMock = stubFetch(json({ ok: true }))
    const { deleteMe } = await import('../../src/lib/api')

    const result = await deleteMe('tok', 'DELETE')
    expect(result).toEqual({ ok: true })
    const { url, init } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/me`)
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body as string)).toEqual({ confirmation: 'DELETE' })
  })

  it('startRun POSTs the mode and validates the signed challenge', async () => {
    const started = {
      runId: 'r1',
      runToken: 'rt1',
      mode: 'surge',
      challenge: { mode: 'surge', cardIds: [26000000, 26000001] },
      guest: true,
      expiresAt: FUTURE()
    }
    const fetchMock = stubFetch(json(started))
    const { startRun } = await import('../../src/lib/api')

    const result = await startRun('surge')
    expect(result.runToken).toBe('rt1')
    expect(result.guest).toBe(true)
    const { url, init, headers } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/runs/start`)
    expect(init.method).toBe('POST')
    // Guest run: no session token was supplied, so no authorization header.
    expect(headers.get('authorization')).toBeNull()
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'surge' })
  })

  it('completeRun POSTs the run token + transcript and parses a guest completion', async () => {
    const completion = { accepted: true, guest: true, mode: 'surge', score: 12.5, season }
    const fetchMock = stubFetch(json(completion))
    const { completeRun } = await import('../../src/lib/api')

    const result = await completeRun('rt1', { taps: 3 }, 'tok')
    expect(result).toMatchObject({ accepted: true, guest: true, score: 12.5 })
    const { url, init, headers } = endpointCall(fetchMock)
    expect(url).toBe(`${API_BASE}/runs/complete`)
    expect(headers.get('authorization')).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toEqual({ runToken: 'rt1', transcript: { taps: 3 } })
  })

  it('getStats GETs /stats and returns the parsed stats', async () => {
    const fetchMock = stubFetch(json({ trophyRoadGames: 601, currentSeason: season }))
    const { getStats } = await import('../../src/lib/api')

    const result = await getStats()
    expect(result.trophyRoadGames).toBe(601)
    expect(endpointCall(fetchMock).url).toBe(`${API_BASE}/stats`)
  })

  it('getLeaderboard builds the season query by default', async () => {
    const fetchMock = stubFetch(
      json({
        mode: 'surge',
        currentSeason: season,
        entries: [{ rank: 1, score: 9, achievedAt: ISO, player: publicPlayer }]
      })
    )
    const { getLeaderboard } = await import('../../src/lib/api')

    const result = await getLeaderboard('surge')
    expect(result.entries[0]?.rank).toBe(1)
    expect(endpointCall(fetchMock).url).toBe(`${API_BASE}/leaderboards?mode=surge`)
  })

  it('getLeaderboard appends the all-time scope', async () => {
    const fetchMock = stubFetch(json({ mode: 'surge', scope: 'all-time', currentSeason: season, entries: [] }))
    const { getLeaderboard } = await import('../../src/lib/api')

    await getLeaderboard('surge', 'all-time')
    expect(endpointCall(fetchMock).url).toBe(`${API_BASE}/leaderboards?mode=surge&scope=all-time`)
  })

  it('getActivity requests the given limit', async () => {
    const fetchMock = stubFetch(
      json({ seasonId: '2026-07', entries: [{ mode: 'surge', score: 9, achievedAt: ISO, player: publicPlayer }] })
    )
    const { getActivity } = await import('../../src/lib/api')

    const result = await getActivity(5)
    expect(result.seasonId).toBe('2026-07')
    expect(result.windowHours).toBe(24)
    expect(result.entries[0]?.runCount).toBe(1)
    expect(endpointCall(fetchMock).url).toBe(`${API_BASE}/activity?limit=5`)
  })

  it('getPublicPlayer encodes the selected id and validates its public profile', async () => {
    const fetchMock = stubFetch(
      json({
        player: {
          ...publicPlayer,
          levelStartGames: 0,
          nextLevelGames: 20
        },
        recentRuns: []
      })
    )
    const { getPublicPlayer } = await import('../../src/lib/api')

    const result = await getPublicPlayer('player/id')
    expect(result.player.publicName).toBe('Ace')
    expect(endpointCall(fetchMock).url).toBe(`${API_BASE}/players/player%2Fid`)
  })

  it('throws ApiError with the server status + code on a non-2xx response', async () => {
    stubFetch(json({ error: { code: 'authentication_required', message: 'Sign in to play.' } }, 401))
    const { getMe, ApiError } = await import('../../src/lib/api')

    const error = await getMe('tok').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, code: 'authentication_required', message: 'Sign in to play.' })
  })

  it('falls back to request_failed when the error body has no code', async () => {
    stubFetch(json({}, 403))
    const { patchMe } = await import('../../src/lib/api')

    await expect(patchMe('tok', {})).rejects.toMatchObject({ status: 403, code: 'request_failed' })
  })

  it('throws a 502 invalid_response ApiError when the payload fails the contract', async () => {
    stubFetch(json({ player: { id: 'p1' } })) // missing required player fields
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { getMe } = await import('../../src/lib/api')

    await expect(getMe('tok')).rejects.toMatchObject({ status: 502, code: 'invalid_response' })
  })

  it('throws 503 api_unavailable when the resolved base URL is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ apiBaseUrl: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { getStats } = await import('../../src/lib/api')

    await expect(getStats()).rejects.toMatchObject({ status: 503, code: 'api_unavailable' })
    // Only the config bootstrap was fetched; the endpoint call was skipped.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api-config.json')
  })

  it('resolves the base URL once and reuses it across calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ apiBaseUrl: API_BASE }))
      .mockResolvedValueOnce(json({ trophyRoadGames: 1, currentSeason: season }))
      .mockResolvedValueOnce(json({ trophyRoadGames: 2, currentSeason: season }))
    vi.stubGlobal('fetch', fetchMock)
    const { getStats } = await import('../../src/lib/api')

    await getStats()
    await getStats()
    // config bootstrap fetched exactly once (memoized), plus two endpoint calls.
    const configCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api-config.json'))
    expect(configCalls).toHaveLength(1)
  })
})

// ===========================================================================
// account.ts — the api module is mocked at the boundary.
// ===========================================================================

describe('account.ts state machine', () => {
  function apiFactory() {
    class ApiError extends Error {
      constructor(
        readonly status: number,
        readonly code: string,
        message: string
      ) {
        super(message)
        this.name = 'ApiError'
      }
    }
    return {
      ApiError,
      deleteMe: vi.fn(),
      getMe: vi.fn(),
      patchMe: vi.fn(),
      redeemLogin: vi.fn(),
      refreshLogin: vi.fn()
    }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('../../src/lib/api', apiFactory)
  })

  afterEach(() => {
    vi.doUnmock('../../src/lib/api')
  })

  const SESSION_KEY = 'elixirdrop:session:v1'
  const meResponse = {
    player: playerFixture,
    recentRuns: [{ runId: 'run1', mode: 'surge' as const, score: 5, seasonId: '2026-07', completedAt: ISO }]
  }

  async function load() {
    const account = await import('../../src/lib/account')
    const api = await import('../../src/lib/api')
    return { account, api }
  }

  it('initializeAccount with no stored session becomes anonymous', async () => {
    const { account, api } = await load()

    await account.initializeAccount()

    expect(account.accountStatus.value).toBe('anonymous')
    expect(account.player.value).toBeNull()
    expect(account.recentRuns.value).toEqual([])
    expect(vi.mocked(api.refreshLogin)).not.toHaveBeenCalled()
  })

  it('initializeAccount with a valid stored session authenticates and persists the refreshed session', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 't1', expiresAt: FUTURE() }))
    const { account, api } = await load()
    const refreshed = { session: { token: 't2', expiresAt: FUTURE() } }
    vi.mocked(api.refreshLogin).mockResolvedValue(refreshed)
    vi.mocked(api.getMe).mockResolvedValue(meResponse)

    await account.initializeAccount()

    expect(account.accountStatus.value).toBe('authenticated')
    expect(account.player.value?.id).toBe('p1')
    expect(account.recentRuns.value).toHaveLength(1)
    expect(vi.mocked(api.getMe)).toHaveBeenCalledWith('t2')
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    expect(stored.token).toBe('t2')
    expect(account.sessionToken()).toBe('t2')
  })

  it('initializeAccount clears the session and goes anonymous on a 401', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 't1', expiresAt: FUTURE() }))
    const { account, api } = await load()
    vi.mocked(api.refreshLogin).mockRejectedValue(new api.ApiError(401, 'authentication_required', 'Sign in.'))

    await account.initializeAccount()

    expect(account.accountStatus.value).toBe('anonymous')
    expect(account.player.value).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(account.sessionToken()).toBeUndefined()
  })

  it('initializeAccount reports unavailable on a non-401 error and keeps the message', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 't1', expiresAt: FUTURE() }))
    const { account, api } = await load()
    vi.mocked(api.refreshLogin).mockRejectedValue(new api.ApiError(503, 'service_unavailable', 'Services are down.'))

    await account.initializeAccount()

    expect(account.accountStatus.value).toBe('unavailable')
    expect(account.accountError.value).toBe('Services are down.')
  })

  it('initializeAccount treats an expired stored session as anonymous without refreshing', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 't1', expiresAt: '2000-01-01T00:00:00.000Z' }))
    const { account, api } = await load()

    await account.initializeAccount()

    expect(account.accountStatus.value).toBe('anonymous')
    expect(vi.mocked(api.refreshLogin)).not.toHaveBeenCalled()
  })

  it('initializeAccount de-duplicates concurrent callers', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 't1', expiresAt: FUTURE() }))
    const { account, api } = await load()
    vi.mocked(api.refreshLogin).mockResolvedValue({ session: { token: 't2', expiresAt: FUTURE() } })
    vi.mocked(api.getMe).mockResolvedValue(meResponse)

    await Promise.all([account.initializeAccount(), account.initializeAccount()])

    expect(vi.mocked(api.refreshLogin)).toHaveBeenCalledTimes(1)
  })

  it('redeemAccount hydrates the session and authenticates', async () => {
    const { account, api } = await load()
    vi.mocked(api.redeemLogin).mockResolvedValue({ session: { token: 'redeemed', expiresAt: FUTURE() } })
    vi.mocked(api.getMe).mockResolvedValue(meResponse)

    const player = await account.redeemAccount('magic')

    expect(player.id).toBe('p1')
    expect(account.accountStatus.value).toBe('authenticated')
    expect(account.sessionToken()).toBe('redeemed')
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) || 'null').token).toBe('redeemed')
  })

  it('applyPolledSession hydrates a handed-off session', async () => {
    const { account, api } = await load()
    vi.mocked(api.getMe).mockResolvedValue(meResponse)

    await account.applyPolledSession({ token: 'polled', expiresAt: FUTURE() })

    expect(account.accountStatus.value).toBe('authenticated')
    expect(account.sessionToken()).toBe('polled')
  })

  it('requiredSessionToken throws a 401 ApiError without a session and returns the token with one', async () => {
    const { account, api } = await load()
    expect(() => account.requiredSessionToken()).toThrowError(api.ApiError)

    vi.mocked(api.getMe).mockResolvedValue(meResponse)
    await account.applyPolledSession({ token: 'live', expiresAt: FUTURE() })
    expect(account.requiredSessionToken()).toBe('live')
  })

  it('updateAccount rejects without a session and patches the player with one', async () => {
    const { account, api } = await load()
    await expect(account.updateAccount({ publicName: 'X' })).rejects.toThrow('Sign in')

    vi.mocked(api.getMe).mockResolvedValue(meResponse)
    await account.applyPolledSession({ token: 'live', expiresAt: FUTURE() })
    vi.mocked(api.patchMe).mockResolvedValue({ player: { ...playerFixture, publicName: 'Renamed' } })

    await account.updateAccount({ publicName: 'Renamed' })
    expect(account.player.value?.publicName).toBe('Renamed')
    expect(vi.mocked(api.patchMe)).toHaveBeenCalledWith('live', { publicName: 'Renamed' })
  })

  it('refreshAccount signs out and rethrows on a 401', async () => {
    const { account, api } = await load()
    vi.mocked(api.getMe).mockResolvedValueOnce(meResponse)
    await account.applyPolledSession({ token: 'live', expiresAt: FUTURE() })

    vi.mocked(api.getMe).mockRejectedValueOnce(new api.ApiError(401, 'authentication_required', 'Expired.'))
    await expect(account.refreshAccount()).rejects.toMatchObject({ status: 401 })
    expect(account.accountStatus.value).toBe('anonymous')
    expect(account.sessionToken()).toBeUndefined()
  })

  it('deleteAccount deletes then signs out', async () => {
    const { account, api } = await load()
    vi.mocked(api.getMe).mockResolvedValue(meResponse)
    await account.applyPolledSession({ token: 'live', expiresAt: FUTURE() })
    vi.mocked(api.deleteMe).mockResolvedValue({ ok: true })

    await account.deleteAccount('DELETE')

    expect(vi.mocked(api.deleteMe)).toHaveBeenCalledWith('live', 'DELETE')
    expect(account.accountStatus.value).toBe('anonymous')
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('signOut clears every signal and storage', async () => {
    const { account, api } = await load()
    vi.mocked(api.getMe).mockResolvedValue(meResponse)
    await account.applyPolledSession({ token: 'live', expiresAt: FUTURE() })

    account.signOut()

    expect(account.player.value).toBeNull()
    expect(account.recentRuns.value).toEqual([])
    expect(account.accountStatus.value).toBe('anonymous')
    expect(account.sessionToken()).toBeUndefined()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('applyRunProgress merges progress only when a player and totalGames exist', async () => {
    const { account } = await load()

    // No player yet: no-op.
    account.applyRunProgress({ totalGames: 99 })
    expect(account.player.value).toBeNull()

    account.player.value = { ...playerFixture }
    // Missing totalGames: no-op.
    account.applyRunProgress({ xp: 500 })
    expect(account.player.value.xp).toBe(playerFixture.xp)

    account.applyRunProgress({ totalGames: 11, xp: 9, level: 3 })
    expect(account.player.value.totalGames).toBe(11)
    expect(account.player.value.xp).toBe(9)
    expect(account.player.value.level).toBe(3)
    // Unspecified fields fall back to the prior value.
    expect(account.player.value.nextLevelGames).toBe(playerFixture.nextLevelGames)
  })

  it('recordRecentRun prepends, de-duplicates by runId, and caps at 20', async () => {
    const { account } = await load()
    const run = (id: string) => ({ runId: id, mode: 'surge' as const, score: 1, seasonId: '2026-07', completedAt: ISO })

    account.recentRuns.value = Array.from({ length: 20 }, (_, i) => run(`old-${i}`))
    account.recordRecentRun(run('new'))
    expect(account.recentRuns.value).toHaveLength(20)
    expect(account.recentRuns.value[0]?.runId).toBe('new')

    account.recordRecentRun(run('new'))
    expect(account.recentRuns.value.filter((r) => r.runId === 'new')).toHaveLength(1)
  })
})
