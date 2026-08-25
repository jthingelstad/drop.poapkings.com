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

test('signing in from the login screen returns the player to the requested game', async ({ page }) => {
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

  // Install the test-specific handler before the first document load. Loading
  // first leaves shell support requests racing the route replacement below.
  await useSignedOutState(page, '/login?returnTo=%2Fsurge')

  await expect(page.getByRole('heading', { name: 'Sign In', exact: true })).toBeVisible()
  const emailInput = page.getByLabel('Email address')
  await emailInput.fill('e***@p***.com')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter your complete email address, not a masked address.')
  await expect(emailInput).toHaveAttribute('aria-invalid', 'true')
  expect(loginBody).toBeUndefined()

  await emailInput.fill('player@example.com')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  // Scoped to the login card: the UpdateBanner is also role="status", and it
  // can mount mid-test whenever the built version differs from the one /stats
  // reports, which made a bare getByRole('status') a strict-mode violation.
  await expect(page.locator('.account-card > .account-message--success')).toContainText('Check your email')
  expect(loginBody).toEqual({ email: 'player@example.com', returnTo: '/surge' })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456&returnTo=%2Fsurge')
  // Redemption is click-gated so mail scanners cannot burn the single-use link.
  await page.getByRole('button', { name: 'Continue to Drop' }).click()
  await expect(page).toHaveURL(/#\/surge$/)
  // The requested game opens and auto-starts.
  await waitForKeypad(page)
})

test('the player-tag deep link survives sign-in and focuses the tag field', { tag: '@deploy' }, async ({ page }) => {
  const noTagPlayer = { ...testPlayer, playerTag: undefined, clashRoyale: undefined }
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
        body: JSON.stringify({ player: noTagPlayer, recentRuns: [] })
      })
      return
    }
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await useSignedOutState(page, '/profile?edit=player-tag')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL(/#\/login\?returnTo=%2Fprofile%3Fedit%3Dplayer-tag$/)

  await page.getByLabel('Email address').fill('player@example.com')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  // Under the full mobile matrix the tap can settle before the routed request
  // handler records its body. Assert the request outcome, not that scheduling
  // happens synchronously with Playwright's click promise.
  await expect.poll(() => loginBody).toEqual({ email: 'player@example.com', returnTo: '/profile?edit=player-tag' })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456&returnTo=%2Fprofile%3Fedit%3Dplayer-tag')
  await page.getByRole('button', { name: 'Continue to Drop' }).click()

  await expect(page).toHaveURL(/#\/profile\?edit=player-tag$/)
  const tagInput = page.getByRole('textbox', { name: 'Clash Royale player tag' })
  await expect(tagInput).toBeVisible()
  await expect(tagInput).toBeFocused()
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
  // Identity setup (redesign) is three steps; it opens at step 1 (the card).
  await expect(page.getByText('Step 1 of 3')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'You' })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 2, name: 'Choose your Player Card' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Clash Royale player tag' })).toHaveCount(0)
  const primary = page.locator('.ed-idsetup__actions .ed-btn--gold')
  // CONTINUE is disabled until a card is chosen.
  await expect(primary).toBeDisabled()

  // Step 1: narrow to the Knight (the grid caps at 60), choose it, then CONTINUE.
  await page.getByPlaceholder('Search cards').fill('Knight')
  await page.locator('.favorite-card-grid').getByRole('button', { name: 'Knight', exact: true }).click()
  await primary.click()

  // Step 2: pick the generated name, then CONTINUE saves the card + name.
  await page.locator('.name-option', { hasText: 'Knight Main' }).click()
  await primary.click()

  // Step 3: skip the tag → return to the pending game.
  await expect(page.getByText('Step 3 of 3')).toBeVisible()
  await page.getByRole('button', { name: /Skip/ }).click()

  await expect(page).toHaveURL(/#\/surge$/)
  await expect
    .poll(() => savedIdentity)
    .toEqual({ favoriteCardId: 26000000, publicName: 'Knight Main', nameToken: 'name-token' })
  // With the identity saved, the requested game opens and auto-starts.
  await waitForKeypad(page)
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
