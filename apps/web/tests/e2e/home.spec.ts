import { expect, isDesktopViewport, test, useSignedOutState, waitForKeypad } from './fixtures'

test(
  'home surfaces season standings and the featured game result',
  { tag: '@deploy' },
  async ({ page, viewport }, testInfo) => {
    await page.goto('/')

    // One shared Home model, composed into the shell for this width.
    await expect(page.locator('.ed-home')).toBeVisible()
    // Rankings stay on the dedicated Ranks page rather than trailing Games.
    await expect(page.locator('.ed-standpeek')).toHaveCount(0)

    if (isDesktopViewport(viewport)) {
      // The aside keeps only what a phone cannot do well: the live feed, given
      // real room, and the Falling Cards launcher. Standings and the season
      // card left because the page beside them already says both.
      await expect(page.locator('.ed-rail-standings')).toHaveCount(0)
      await expect(page.locator('.ed-rail-this')).toHaveCount(0)
      await expect(page.locator('.ed-railfoot')).toHaveCount(0)
      await expect(page.locator('.ed-rail-live__head')).toContainText('Live · recent runs')
      // Repeated activity is grouped into one recent-runs row.
      await expect(page.locator('.ed-rail-live')).toContainText('Trade · 8 runs · best 11.800s')
      await expect(page.locator('.ed-desktop__rail')).toBeVisible()
      // Falling Cards remains the ambient desktop layer.
      await expect(page.locator('.ed-wallpaper')).toBeVisible()
      const viewportFit = await page.evaluate(() => ({
        viewport: window.innerHeight,
        document: document.documentElement.scrollHeight,
        mainScroll: document.querySelector('.ed-desktop__main')?.scrollHeight ?? 0,
        mainClient: document.querySelector('.ed-desktop__main')?.clientHeight ?? 0
      }))
      expect(viewportFit.document).toBeLessThanOrEqual(viewportFit.viewport + 1)
      expect(viewportFit.mainScroll).toBeLessThanOrEqual(viewportFit.mainClient + 1)
    }

    // The hero rotates by UTC day. Its result must follow the featured mode
    // instead of permanently asserting Surge's best on a non-Surge hero.
    const featured = (await page.locator('.ed-hero__wordmark').first().innerText()).trim()
    const expectedBest: Record<string, string> = {
      SURGE: '67.299s',
      TRADE: '11.800s'
    }
    await expect(page.locator('.ed-hero__best-val')).toHaveText(`${expectedBest[featured] ?? '—'} · #4`)

    await testInfo.attach('home.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    })
  }
)

test('the hero features one ranked game and the other four are full-width rows', async ({ page }) => {
  await page.goto('/')

  // The hero promotes one ranked game for the day.
  const wordmark = (await page.locator('.ed-hero__wordmark').first().textContent())?.trim() ?? ''
  expect(['SURGE', 'HIGHER / LOWER', 'RAIN', 'TRADE', 'SURVIVAL']).toContain(wordmark)

  // One full-width-row layout on every shell. Exactly the OTHER four ranked games are listed as rows —
  // the featured game is pulled out of the list so it never appears twice.
  const otherFour = page.locator('.ed-rows').first()
  await expect(otherFour.locator('.ed-grow--ranked')).toHaveCount(4)
  const rowNames = await otherFour.locator('.ed-grow__name').allTextContents()
  expect(rowNames.map((name) => name.trim().toUpperCase())).not.toContain(wordmark)
  // A row leads with its own best and never carries a gold PLAY.
  await expect(otherFour.locator('.ed-grow__meta').first()).toContainText('Best')
  await expect(otherFour.locator('.ed-btn--gold')).toHaveCount(0)
})

test('desktop keeps the mobile game order in a fixed-width center', async ({ page, viewport }) => {
  test.skip(!isDesktopViewport(viewport), 'desktop shell coverage')
  await page.goto('/')

  const center = await page.locator('.ed-desktop__main').evaluate((element) => element.getBoundingClientRect().width)
  const home = await page.locator('.ed-home').evaluate((element) => element.getBoundingClientRect().width)
  expect(center).toBeCloseTo(440, 0)
  expect(home).toBeLessThanOrEqual(404)

  const practice = page.locator('section[aria-labelledby="home-practice-title"]')
  await expect(practice.locator('.ed-more__aside--pill')).toHaveText('UNRANKED')

  const ranked = page.locator('.ed-more--ranked')
  await expect(ranked.locator('.ed-more__title')).toHaveText('The other four')
  await expect(ranked.locator('.ed-grow--ranked')).toHaveCount(4)
  await expect(page.getByRole('button', { name: /Open .* leaderboard/ })).toHaveCount(0)
  await expect(page.locator('.ed-hero').first().getByRole('button', { name: /PLAY/ })).toBeVisible()

  const order = await page.evaluate(() => ({
    ranked: document.querySelector('.ed-more--ranked')?.getBoundingClientRect().top ?? 0,
    practice: document.querySelector('.ed-more--practice')?.getBoundingClientRect().top ?? 0
  }))
  expect(order.ranked).toBeLessThan(order.practice)

  const fullStrengthGutterCards = await page.locator('.ed-wallpaper__card').evaluateAll(
    (cards) =>
      cards.filter((card) => {
        const left = Number.parseFloat((card as HTMLElement).style.left)
        const opacity = Number.parseFloat(getComputedStyle(card).opacity)
        return (left <= 15 || left >= 85) && opacity === 1
      }).length
  )
  expect(fullStrengthGutterCards).toBeGreaterThanOrEqual(6)
  await expect(page.locator('.ed-wallpaper__vignette')).toHaveCount(0)
})

test('Practice has one direct entry on desktop and mobile', async ({ page }) => {
  await page.goto('/')

  const practice = page.locator('section[aria-labelledby="home-practice-title"]')
  await expect(practice.locator('.ed-more__aside--pill')).toHaveText('UNRANKED')
  await expect(practice.locator('.ed-grow--drill')).toHaveCount(1)
  await expect(practice.getByRole('button', { name: /Practice/ })).toBeVisible()

  await page.goto('/#/practice')
  await expect(page.locator('.ed-game__mode')).toHaveText('Practice', { timeout: 12_000 })
})

test('the hero carousel promotes the pass challenge and sharing Drop', { tag: '@deploy' }, async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => Promise.resolve()
    })
  })
  await page.goto('/')

  await expect(page.locator('.ed-home')).toBeVisible()
  const track = page.locator('.ed-hero-carousel__track')
  const slides = track.locator('.ed-hero-carousel__slide')
  await expect(slides).toHaveCount(3)
  const featuredHeight = await slides
    .first()
    .locator('.ed-hero')
    .evaluate((element) => element.getBoundingClientRect().height)
  const gamesTop = await page
    .locator('.ed-more__head')
    .first()
    .evaluate((element) => element.getBoundingClientRect().top)
  await page.getByRole('button', { name: 'Free Pass challenge' }).click()
  await expect(slides.nth(1)).toHaveAttribute('aria-hidden', 'false')
  const pass = page.locator('.ed-hero--pass')
  await expect(pass.locator('.ed-hero__wordmark')).toHaveText('WIN A PASS')
  await expect(pass.locator('.ed-hero-podium')).toHaveCount(0)
  await expect(pass).not.toContainText('Provisional until Fair Play review')
  expect(await pass.evaluate((element) => element.getBoundingClientRect().height)).toBe(featuredHeight)
  expect(
    await page
      .locator('.ed-more__head')
      .first()
      .evaluate((element) => element.getBoundingClientRect().top)
  ).toBe(gamesTop)
  await expect(pass.getByRole('link', { name: 'RULES' })).toHaveAttribute(
    'href',
    'https://poapkings.com/elixir-drop/free-pass/'
  )

  await page.getByRole('button', { name: 'Share Elixir Drop' }).click()
  await expect(slides.nth(2)).toHaveAttribute('aria-hidden', 'false')
  const share = page.locator('.ed-hero--share')
  expect(await share.evaluate((element) => element.getBoundingClientRect().height)).toBe(featuredHeight)
  expect(
    await page
      .locator('.ed-more__head')
      .first()
      .evaluate((element) => element.getBoundingClientRect().top)
  ).toBe(gamesTop)
  await share.getByRole('button', { name: /SHARE ELIXIR DROP/ }).click()
  await expect(share.getByRole('button', { name: /SHARED/ })).toBeVisible()
})

test('the hero carousel is a finger-tracking horizontal scroll surface', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const track = page.locator('.ed-hero-carousel__track')
  const slides = track.locator('.ed-hero-carousel__slide')
  const gamesTop = await page
    .locator('.ed-more__head')
    .first()
    .evaluate((element) => element.getBoundingClientRect().top)

  const geometry = await track.evaluate((element) => {
    const styles = getComputedStyle(element)
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: styles.overflowX,
      scrollSnapType: styles.scrollSnapType
    }
  })
  expect(geometry.scrollWidth).toBe(geometry.clientWidth * 3)
  expect(geometry.overflowX).toBe('auto')
  expect(geometry.scrollSnapType).toBe('x mandatory')

  // Unlike a threshold-driven content swap, a native track can occupy the
  // intermediate position under the player's finger before snapping.
  const intermediate = await track.evaluate((element) => {
    element.style.scrollSnapType = 'none'
    element.scrollLeft = element.clientWidth * 0.35
    const scrollLeft = element.scrollLeft
    element.scrollLeft = 0
    element.style.removeProperty('scroll-snap-type')
    return scrollLeft
  })
  expect(intermediate).toBeGreaterThan(0)
  expect(intermediate).toBeLessThan(geometry.clientWidth)

  await track.evaluate((element) => element.scrollTo({ left: element.clientWidth, behavior: 'auto' }))
  await expect(slides.nth(1)).toHaveAttribute('aria-hidden', 'false')
  await expect(slides.nth(1).locator('.ed-hero__wordmark')).toHaveText('WIN A PASS')
  expect(
    await page
      .locator('.ed-more__head')
      .first()
      .evaluate((element) => element.getBoundingClientRect().top)
  ).toBe(gamesTop)

  await track.evaluate((element) => element.scrollTo({ left: 0, behavior: 'auto' }))
  await expect(slides.first()).toHaveAttribute('aria-hidden', 'false')
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

test('Tinylytics tracks hash pages, stays off the token route, and captures game events', async ({ page }) => {
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
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Ladder', exact: true }).click()
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
    // The intro header and identity chip are gone; the hero leads the page and
    // must clear the status-bar inset.
    const heroTop = await page
      .locator('.ed-hero')
      .first()
      .evaluate((element) => element.getBoundingClientRect().top)
    expect(heroTop).toBeGreaterThanOrEqual(47)

    await page.goto('/?signedOut=1#/surge')
    await applyTestSafeArea()
    await waitForKeypad(page)
    const gameTop = await page.locator('.ed-game').evaluate((element) => element.getBoundingClientRect().top)
    expect(gameTop).toBeGreaterThanOrEqual(47)
  })

  test('shows the bottom pill nav without a header or horizontal overflow', { tag: '@deploy' }, async ({ page }) => {
    await useSignedOutState(page)

    // The mobile shell drops the old site header entirely for a bottom pill nav.
    await expect(page.locator('.site-head')).toHaveCount(0)
    const nav = page.locator('.ed-pillnav')
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Play' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Ladder' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'You' })).toBeVisible()
    await expect(nav.locator('.ed-pillnav__ind')).toHaveCSS(
      'background-image',
      'linear-gradient(135deg, rgb(245, 200, 76), rgb(201, 140, 16))'
    )
    await expect(nav.getByRole('button', { name: 'Play' })).toHaveCSS('color', 'rgb(42, 21, 0)')

    const pageHasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    expect(pageHasHorizontalOverflow).toBe(false)
  })
})
