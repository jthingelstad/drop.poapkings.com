import { expect, isDesktopViewport, test, useSignedOutState, waitForKeypad } from './fixtures'

test('home surfaces season standings and the featured game result', async ({ page, viewport }, testInfo) => {
  await page.goto('/')

  if (isDesktopViewport(viewport)) {
    await expect(page.locator('.ed-home-d')).toBeVisible()
    // Season standings live in the desktop right rail.
    await expect(page.locator('.ed-rail-standings')).toContainText('Royal Ghosted')
    await expect(page.locator('.ed-rail-standings')).toContainText('You')
    await expect(page.locator('.ed-rail-this')).toContainText('Get 8.9s faster to take the lead')
    await expect(page.locator('.ed-rail-this')).toContainText('next season’s free pass')
    // Repeated activity is grouped into one recent-runs row.
    await expect(page.locator('.ed-rail-live__head')).toContainText('Recent runs')
    await expect(page.locator('.ed-rail-live')).toContainText('Trade · 8 runs · best 11.80s')
    await expect(page.locator('.ed-rail-live__dot')).toHaveCount(0)
  } else {
    await expect(page.locator('.ed-home')).toBeVisible()
    // Season standings surface as the mobile peek.
    await expect(page.locator('.ed-standpeek')).toContainText('Royal Ghosted')
    await expect(page.locator('.ed-standpeek')).toContainText('You')
    await expect(page.locator('.ed-standpeek')).toContainText('Get 8.9s faster to take the lead')
    await expect(page.locator('.ed-standpeek')).toContainText('next season’s free pass')
  }

  // The hero rotates by UTC day. Its result must follow the featured mode
  // instead of permanently asserting Surge's best on a non-Surge hero.
  const featured = (await page.locator('.ed-hero__wordmark').innerText()).trim()
  const expectedBest: Record<string, string> = {
    SURGE: '67.30s',
    TRADE: '11.80s'
  }
  await expect(page.locator('.ed-hero__best-val')).toHaveText(`${expectedBest[featured] ?? '—'} · #4`)

  await testInfo.attach('home.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
})

test('every game sits in the row, and one is featured for the day', async ({ page }) => {
  await page.goto('/')

  // All five ranked games are always listed, Surge included, in a fixed order.
  const row = page.locator('.ed-more-row, .ed-more-grid').first()
  await expect(row.locator('.ed-gcard')).toHaveCount(5)
  await expect(row).toContainText('Surge')
  await expect(row).toContainText('Higher / Lower')
  await expect(row).toContainText('Rain')
  await expect(row).toContainText('Trade')
  await expect(row).toContainText('Survival')
  await expect(page.locator('.ed-more__title').first()).toHaveText('All games')

  // Rain is no longer badged as new.
  await expect(row.locator('.ed-gcard__badge')).toHaveCount(0)

  // The hero promotes one of those five, and the same one is accented in the
  // row — so the promotion never points somewhere the list does not.
  const wordmark = (await page.locator('.ed-hero__wordmark').textContent())?.trim() ?? ''
  expect(['SURGE', 'HIGHER / LOWER', 'RAIN', 'TRADE', 'SURVIVAL']).toContain(wordmark)
  const accented = row.locator('.ed-gcard--accent')
  await expect(accented).toHaveCount(1)
  await expect(accented).toContainText(new RegExp(wordmark.replace(/ \/ /, ' / '), 'i'))
})

test('mobile install suggestion waits until the third browser session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const makeInstallable = () =>
    page.evaluate(() => {
      const event = new Event('beforeinstallprompt') as Event & {
        prompt: () => Promise<void>
        userChoice: Promise<{ outcome: 'accepted' }>
      }
      event.prompt = () => Promise.resolve()
      event.userChoice = Promise.resolve({ outcome: 'accepted' })
      window.dispatchEvent(event)
    })

  await makeInstallable()
  await expect(page.locator('.ed-installbar')).toHaveCount(0)
  await expect(page.locator('.ed-installrow')).toHaveCount(0)

  await page.evaluate(() => {
    localStorage.setItem('elixirdrop:installSessionCount', '2')
    sessionStorage.removeItem('elixirdrop:installSessionCounted')
  })
  await page.reload()
  // The app records the new session and installs the browser prompt listener
  // from the same effect. Wait for that initialization boundary before firing
  // the synthetic event; dispatching immediately after `load` can race Preact's
  // effect flush in fast Chromium runs.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('elixirdrop:installSessionCount'))).toBe('3')
  await makeInstallable()

  await expect(page.locator('.ed-installbar')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __tinylyticsEvents?: Array<{ event: string }> }).__tinylyticsEvents?.some(
          (entry) => entry.event === 'install.suggestion_shown'
        )
      )
    )
    .toBe(true)
})

test('Tinylytics tracks hash pages, stays off the token route, and captures game events', async ({
  page,
  viewport
}) => {
  const embedRequests: string[] = []
  const pageRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://tinylytics.app/embed/')) embedRequests.push(request.url())
    if (request.url().startsWith('https://tinylytics.app/collector/')) pageRequests.push(request.url())
  })

  await page.goto('/?signedOut=1#/auth?token=abcdefghijklmnopqrstuvwxyz123456')
  await expect(page.getByRole('button', { name: 'Continue to Drop' })).toBeVisible()
  expect(embedRequests).toEqual([])
  expect(pageRequests).toEqual([])

  await page.getByRole('button', { name: 'Continue to Drop' }).click()
  await expect(page).toHaveURL(/#\/profile/)
  await expect.poll(() => embedRequests.length).toBe(1)
  await expect.poll(() => pageRequests.length).toBe(1)
  expect(embedRequests[0]).toContain('/min.js?events&beacon')
  expect(new URL(pageRequests[0]).searchParams.get('path')).toBe('/profile')
  expect(pageRequests[0]).not.toContain('abcdefghijklmnopqrstuvwxyz123456')

  // Scoped to the primary nav: the profile surface also links "Leaderboards"
  // (both shells label their nav "Primary", so this works on either).
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: isDesktopViewport(viewport) ? 'Leaderboards' : 'Ranks', exact: true })
    .click()
  await expect(page).toHaveURL(/#\/leaderboards/)
  await expect.poll(() => pageRequests.length).toBe(2)
  expect(new URL(pageRequests[1]).searchParams.get('path')).toBe('/leaderboards')

  // Let the leaderboard screen's mocked support requests finish before the
  // deliberate document navigation below. WebKit reports an interrupted
  // fulfilled fetch as an access-control console error under parallel load.
  await page.waitForLoadState('networkidle')

  await page.goto('/#/surge')
  await waitForKeypad(page)
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __tinylyticsEvents?: Array<{ event: string; value: string }> }
        ).__tinylyticsEvents?.some((entry) => entry.event === 'game.started' && entry.value === 'surge')
      )
    )
    .toBe(true)
})

test.describe('mobile primary navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps home and game content below the installed-app status bar', async ({ page }) => {
    // Desktop browser engines report a zero safe-area inset, so override the
    // shell token with a representative modern-iPhone inset for regression QA.
    const applyTestSafeArea = () =>
      page.evaluate(() => document.documentElement.style.setProperty('--ed-safe-area-top', '47px'))
    await useSignedOutState(page)
    await applyTestSafeArea()

    await expect(page.locator('.ed-mobile')).toHaveCSS('padding-top', '47px')
    const identityTop = await page.locator('.ed-idchip').evaluate((element) => element.getBoundingClientRect().top)
    expect(identityTop).toBeGreaterThanOrEqual(53)

    await page.goto('/?signedOut=1#/surge')
    await applyTestSafeArea()
    await waitForKeypad(page)
    const gameTop = await page.locator('.ed-game').evaluate((element) => element.getBoundingClientRect().top)
    expect(gameTop).toBeGreaterThanOrEqual(47)
  })

  test('shows the bottom pill nav without a header or horizontal overflow', async ({ page }) => {
    await useSignedOutState(page)

    // The mobile shell drops the old site header entirely for a bottom pill nav.
    await expect(page.locator('.site-head')).toHaveCount(0)
    const nav = page.locator('.ed-pillnav')
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Games' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Ranks' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'You' })).toBeVisible()
    await expect(nav.locator('.ed-pillnav__ind')).toHaveCSS(
      'background-image',
      'linear-gradient(135deg, rgb(245, 200, 76), rgb(201, 140, 16))'
    )
    await expect(nav.getByRole('button', { name: 'Games' })).toHaveCSS('color', 'rgb(42, 21, 0)')

    const pageHasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    expect(pageHasHorizontalOverflow).toBe(false)
  })
})
