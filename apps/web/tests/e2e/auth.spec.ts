import type { Page } from '@playwright/test'
import {
  allowExpectedApiErrors,
  cardsData,
  expect,
  fulfillSupportData,
  fulfillTestRun,
  test,
  testApiBaseUrl,
  testApiRoute,
  testPlayer,
  testSession,
  useSignedOutState,
  waitForKeypad
} from './fixtures'

test(
  'a signed-out visitor plays a game as a guest and is nudged to save future scores',
  { tag: '@deploy' },
  async ({ page }) => {
    // Hold the response until the in-flight guest state has actually been
    // inspected. A fixed delay races slower CI devices and can let the final
    // notice replace this deliberately transient one before the assertion runs.
    let releaseCompletion: (() => void) | undefined
    const completionHeld = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })
    await page.route(`${testApiBaseUrl}/runs/complete`, async (route) => {
      await completionHeld
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

    try {
      const scoringNotice = page.locator('.run-recording')
      await expect(scoringNotice).toContainText('Scoring your game…')
      await expect(scoringNotice).not.toHaveClass(/run-recording--blocking/)
      await expect(page.getByText('Recording your game…')).toHaveCount(0)
    } finally {
      releaseCompletion?.()
    }

    // The shared summary appears with the guest sign-in-to-save nudge.
    const summary = page.locator('.ed-sum')
    await expect(summary).toBeVisible()
    await expect(summary.getByRole('button', { name: 'Play again' })).toBeVisible()
    await expect(
      page.getByText('Sign in before your next game to save future scores and compete on the leaderboard.')
    ).toBeVisible()
    await summary.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/#\/login\?returnTo=%2Fsurvival$/)
  }
)

// Elixir's consent page is out of reach here, so the start answer sends the
// browser straight to where Elixir's callback would: the redemption route
// with a proven token and the original return path.
function elixirReturn(page: Page, returnTo: string): string {
  const origin = new URL(page.url()).origin
  return `${origin}/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456&returnTo=${encodeURIComponent(returnTo)}&via=elixir`
}

test('signing in with Elixir from the login screen returns the player to the requested game', async ({ page }) => {
  let startBody: Record<string, unknown> | undefined
  let redeemBody: Record<string, unknown> | undefined
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/elixir/start') {
      startBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: elixirReturn(page, '/surge'), pollId: 'poll-123456789012345678', mode: 'sign-in' })
      })
      return
    }
    if (path === '/auth/redeem') {
      redeemBody = route.request().postDataJSON() as Record<string, unknown>
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

  // Install the test-specific handler before the first document load. Loading
  // first leaves shell support requests racing the route replacement below.
  await useSignedOutState(page, '/login?returnTo=%2Fsurge')

  await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible()
  // One way in: no email field, no code field.
  await expect(page.locator('.account-card input')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign in with Elixir', exact: true }).click()
  await expect.poll(() => startBody).toEqual({ returnTo: '/surge' })
  await expect.poll(() => redeemBody).toEqual({ token: 'abcdefghijklmnopqrstuvwxyz123456' })
  await expect(page).toHaveURL(/#\/surge$/)
  // The requested game opens and auto-starts.
  await waitForKeypad(page)
})

test('the old player deep link survives sign-in and lands on Account', { tag: '@deploy' }, async ({ page }) => {
  const noTagPlayer = { ...testPlayer, playerTag: undefined, clashRoyale: undefined }
  let startBody: Record<string, unknown> | undefined
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/elixir/start') {
      startBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: elixirReturn(page, '/profile?edit=player-tag'),
          pollId: 'poll-123456789012345678',
          mode: 'sign-in'
        })
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
        body: JSON.stringify({ player: noTagPlayer, recentRuns: [] })
      })
      return
    }
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await useSignedOutState(page, '/profile?edit=player-tag')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL(/#\/login\?returnTo=%2Fprofile%3Fscope%3Daccount$/)

  await page.getByRole('button', { name: 'Sign in with Elixir', exact: true }).click()
  // Under the full mobile matrix the tap can settle before the routed request
  // handler records its body. Assert the request outcome, not that scheduling
  // happens synchronously with Playwright's click promise.
  await expect.poll(() => startBody).toEqual({ returnTo: '/profile?scope=account' })

  // There is no player to choose any more (2026-11-14): the old link opens
  // Account, where the Elixir block says where the name and picture come from.
  await expect(page).toHaveURL(/#\/profile\?scope=account$/)
  await expect(page.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.ed-elixir')).toBeVisible()
  await expect(page.locator('.ed-elixir__candidate')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Clash Royale player tag' })).toHaveCount(0)
})

test('a new player goes straight back to the game with the name and picture Elixir gave', async ({ page }) => {
  // The name and picture arrive with the sign-in (2026-11-14): no card step,
  // no name ideas, no player picker, and nothing for Drop to save.
  const newPlayer = { ...testPlayer, publicName: 'Sample Primary', favoriteCardId: 26000000, totalGames: 0 }
  let patched = false

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
        body: JSON.stringify({ player: newPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/me' && request.method() === 'PATCH') patched = true
    if (await fulfillTestRun(route)) return
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456&returnTo=%2Fsurge')
  await page.getByRole('button', { name: 'Continue to Drop' }).click()
  await expect(page).toHaveURL(/#\/surge$/)
  await waitForKeypad(page)
  expect(patched).toBe(false)
})

test('a temporary authentication outage keeps the saved login', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  let runStarts = 0
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/runs/start') runStarts += 1
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Player services are restarting.' } })
    })
  })

  await page.goto('/#/surge')
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  await expect(page.getByRole('heading', { name: 'Player services are reconnecting' })).toHaveCount(0)
  await expect(page.locator('.ed-game__offline')).toContainText('Offline · not saved', { timeout: 12_000 })
  await waitForKeypad(page)
  expect(runStarts).toBe(0)
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('elixirdrop:session:v1') || 'null')?.token))
    .toBe(testSession.token)
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
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/profile')
  // Delete-account lives in the Account scope of the You page.
  await page.getByRole('tab', { name: 'Account' }).click()
  await page.locator('.ed-account').getByRole('button', { name: 'Delete account' }).click()
  const confirmDelete = page.getByRole('button', { name: 'Permanently delete account' })
  await expect(confirmDelete).toBeDisabled()
  await page.getByLabel('Type DELETE to confirm').fill('delete')
  await expect(confirmDelete).toBeDisabled()
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  await confirmDelete.click()

  // One home for every width now — one Home component, both shells.
  await expect(page.locator('.ed-home')).toBeVisible()
  expect(deletionBody).toEqual({ confirmation: 'DELETE' })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('elixirdrop:session:v1'))).toBeNull()
})
