import AxeBuilder from '@axe-core/playwright'
import { BADGE_LIST, playerReference, runReference } from '@elixir-drop/contracts'
import {
  cardsData,
  expect,
  fulfillSupportData,
  isDesktopViewport,
  test,
  testApiBaseUrl,
  testApiRoute,
  testBadges,
  testPlayer,
  testRecentRuns
} from './fixtures'

test('the You page is reachable and shows identity, the day-grouped log, and the account', async ({ page }) => {
  await page.goto('/')
  // One shell now: the bottom pill nav's "You" tab is the You entry point on
  // every width. The nav never renames itself. (A non-exact name so the tab's
  // "Unread updates" dot, when present, doesn't defeat the match.)
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'You' }).click()

  await expect(page.locator('.ed-you__name')).toHaveText('Knight Main')

  // The Log scope is the default: recorded games grouped by day, and only a run
  // a referee handled is sealed. The held and excluded runs are marked; the
  // ordinary games around them wear nothing.
  const games = page.locator('.ed-games')
  const rows = games.locator('.ed-games__row')
  await expect(rows.getByLabel('Awaiting referee')).toHaveCount(1)
  await expect(rows.getByLabel('Not ranked')).toHaveCount(1)
  await expect(rows.getByLabel('Referee cleared')).toHaveCount(0)
  await expect(games.locator('.ed-games__day-head').first()).toContainText('game')

  // The run reference and the dispute link live in the run detail; only a run a
  // referee has touched carries one at all.
  await rows
    .filter({ has: page.getByLabel('Not ranked') })
    .first()
    .click()
  const detail = page.getByRole('dialog')
  // An excluded run replaces the reference block with the referee's explanation
  // and the dispute link (whose mailto still carries the run reference).
  await expect(detail).toContainText(/recorded response timing was not consistent with human play/)
  await expect(detail.getByRole('link', { name: /Dispute/ })).toHaveAttribute(
    'href',
    `mailto:drop@poapkings.com?subject=${encodeURIComponent(`Elixir Drop run review ${runReference('recent-trade')}`)}`
  )
  await page.keyboard.press('Escape')

  // The email and player reference live in the Account scope.
  await page.getByRole('tab', { name: 'Account' }).click()
  await expect(page.locator('.ed-account')).toContainText('player@example.com')
  await expect(page.locator('.ed-account')).toContainText(playerReference('player-1'))
  await expect(page.locator('.ed-account')).toContainText('Sign out')
})

test('Updates opens unread cards and links Markdown to the public history', async ({ page }, testInfo) => {
  let currentPlayer = { ...testPlayer, lastOpenedUpdates: '2026-08-20T17:25:00-05:00' }
  let markedRead = false
  await page.route(testApiRoute, async (route) => {
    const request = route.request()
    if (new URL(request.url()).pathname !== '/me') return route.fallback()
    if (request.method() === 'PATCH') {
      markedRead = true
      currentPlayer = { ...currentPlayer, lastOpenedUpdates: '2026-08-21T12:05:00.000Z' }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: currentPlayer })
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ player: currentPlayer, recentRuns: testRecentRuns, badges: { badges: testBadges } })
    })
  })

  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Updates' }).click()

  const unread = page.getByRole('button', { name: /Drop updates can follow you out of the arena/ })
  const alreadyRead = page.getByRole('button', { name: /Shared runs show what each answer cost/ })
  await expect(unread).toHaveAttribute('aria-expanded', 'true')
  await expect(alreadyRead).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => markedRead).toBe(true)
  await expect(unread).toHaveAttribute('aria-expanded', 'true')

  const message = page.getByRole('button', { name: /Updates, one card at a time/ })
  await expect(message).toHaveAttribute('aria-expanded', 'false')
  await message.click()
  const body = message.locator('xpath=following-sibling::*[1]')
  await expect(body).toContainText('POAP KINGS')
  await expect(body.locator('strong')).toHaveText('POAP KINGS')
  await testInfo.attach('updates-feed.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
  await body.getByRole('link', { name: 'read the full history' }).click()

  await expect(page).toHaveURL(/\/updates\/$/)
  await expect(page.getByRole('heading', { name: 'Elixir Drop Updates' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your battle name found more personality' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Follow via RSS' })).toHaveAttribute('href', '/feed.xml')
  await testInfo.attach('updates-archive.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
})

test('the Settings scope persists input and motion preferences across reload', async ({ page }) => {
  // /settings folds into the You page; Settings is a scope there now.
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('button', { name: '4 choices' }).click()
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })

  // Reload lands on the default Log scope; reopen Settings to verify persistence.
  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: '4 choices' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)
  await expect(page.locator('.ed-settings__note')).toContainText('per-device and never sync')
})

test('an installed PWA replaces Install app with live App Info diagnostics', async ({ page, viewport }, testInfo) => {
  test.skip(isDesktopViewport(viewport), 'the Profile More list is a mobile-shell surface')
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      if (query === '(display-mode: standalone)') {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false
        }
      }
      return nativeMatchMedia(query)
    }
  })

  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })
  // App Info lives in the You page's Account scope now (the mobile More list retired).
  await page.getByRole('tab', { name: 'Account' }).click()
  const appInfo = page.getByRole('button', { name: 'App Info' })
  await expect(appInfo).toBeVisible()
  await expect(page.getByRole('button', { name: 'Install app' })).toHaveCount(0)

  const totalArt = new Set(cardsData.cards.map((card) => card.icon)).size
  await page.evaluate(
    async ({ cacheName, cardUrl }) => {
      const cache = await caches.open(cacheName)
      await cache.put(cardUrl, new Response(new Uint8Array([1]), { status: 200 }))
    },
    { cacheName: `elixir-drop-card-art-base-${cardsData.version}`, cardUrl: cardsData.cards[0]!.icon }
  )
  await appInfo.click()

  await expect(page).toHaveURL(/#\/app-info$/)
  await expect(page.getByRole('heading', { name: 'App Info', exact: true })).toBeVisible()
  const details = page.getByLabel('App information')
  await expect(details).toContainText('Installed app')
  await expect(details).toContainText('Build ID')
  await expect(details).toContainText('Build date')
  await expect(details).toContainText(testApiBaseUrl)
  await expect(details.locator('.settings-meta__row').filter({ hasText: 'API latency' })).toContainText(/\d+ ms/)
  await expect(details).toContainText(`${cardsData.version} · ${cardsData.cards.length} cards`)
  await expect(page.getByRole('heading', { name: 'Online' })).toBeVisible()
  await expect(page.locator('.ed-appinfo__latency')).toContainText(/\d+ms/)
  const cacheProgress = page.getByRole('progressbar', { name: 'Card art cache progress' })
  await expect(cacheProgress).toHaveAttribute('aria-valuenow', '1')
  await expect(cacheProgress).toHaveAttribute('aria-valuemax', String(totalArt))
  await expect(page.getByText(`1 of ${totalArt} card images cached`)).toHaveCount(2)

  const accessibilityScanResults = await new AxeBuilder({ page }).analyze()
  expect(accessibilityScanResults.violations.filter((violation) => violation.impact === 'serious')).toEqual([])
  await testInfo.attach('app-info.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
})

test('the Settings scope has three toggles that persist per device', async ({ page }) => {
  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Settings' }).click()
  const settings = page.locator('.ed-settings')

  const sound = settings.getByRole('switch', { name: 'Sound effects' })
  const motion = settings.getByRole('switch', { name: 'Reduce motion' })
  const effects = settings.getByRole('switch', { name: 'Enhance effects' })
  await expect(sound).toHaveAttribute('aria-checked', 'false')
  await expect(motion).toHaveAttribute('aria-checked', 'false')
  await expect(effects).toHaveAttribute('aria-checked', 'true')

  await sound.click()
  await motion.click()
  await effects.click()
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(settings.getByRole('switch', { name: 'Sound effects' })).toHaveAttribute('aria-checked', 'true')
  await expect(settings.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute('aria-checked', 'true')
  await expect(settings.getByRole('switch', { name: 'Enhance effects' })).toHaveAttribute('aria-checked', 'false')
})

test('the Ladder Badges scope shows every badge on one screen', async ({ page }) => {
  await page.goto('/#/leaderboards')
  await page.getByRole('tab', { name: 'Badges' }).click()

  // Every badge, one screen — no featured strip, no "+N more", no expand toggle.
  // (The two Reach badges are specced but not built yet, so BADGE_LIST is 29.)
  await expect(page.locator('.ed-ladder__badges-head')).toContainText(`of ${BADGE_LIST.length} earned`)
  await expect(page.locator('.ed-ladder__badges-head')).toContainText('Every badge, one screen')
  await expect(page.locator('.ed-badges__grid--featured')).toHaveCount(0)
  await expect(page.locator('.ed-profile__badges-toggle')).toHaveCount(0)
  await expect(page.locator('.ed-badges__cell')).toHaveCount(BADGE_LIST.length)
})

test('opening a badge on the Ladder uses a focused modal with the rung ladder', async ({ page }, testInfo) => {
  await page.goto('/#/leaderboards')
  await page.getByRole('tab', { name: 'Badges' }).click()

  await page.getByRole('button', { name: 'Clockbreaker, 35s' }).click()
  const sheet = page.getByRole('dialog', { name: 'Clockbreaker' })
  await expect(sheet).toBeFocused()
  await expect(sheet).toContainText('Fastest Surge run')
  await expect(sheet).toContainText('Next milestone')
  await expect(sheet).toContainText('Best: 34.2s · 4.2s faster to go')
  // The redesign ADDS a full rung-ladder strip below the progress bar.
  await expect(sheet.locator('.ed-badges__rungs')).toBeVisible()
  await testInfo.attach('badge-modal.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })

  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clockbreaker, 35s' })).toBeFocused()

  await page.getByRole('button', { name: 'Reps, 100' }).click()
  const reps = page.getByRole('dialog', { name: 'Reps' })
  await expect(reps).toBeVisible()
  await expect(reps).toContainText('Current: 175 · 75 to go')
  await expect(reps.getByRole('progressbar', { name: 'Reps progress' })).toHaveAttribute('aria-valuenow', '70')

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Marathon, 5' }).click()
  const marathon = page.getByRole('dialog', { name: 'Marathon' })
  await expect(marathon).toContainText('Next milestone')
  await expect(marathon).toContainText('10')
  await expect(marathon).toContainText('Best: 7 · 3 to go')
  const marathonProgress = marathon.getByRole('progressbar', { name: 'Marathon progress' })
  await expect(marathonProgress).toHaveAttribute('aria-valuenow', '70')
  await expect(marathonProgress).toHaveAttribute('aria-valuetext', 'Best: 7 · 3 to go')
  // The rung ladder renders one segment per rung.
  await expect(marathon.locator('.ed-badges__rung').first()).toBeVisible()
  await marathon.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished))
  })
  await testInfo.attach('badge-marathon-modal.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Night Shift, 1' }).click()
  const earnedSecret = page.getByRole('dialog', { name: 'Night Shift' })
  await expect(earnedSecret).toContainText('Earned by completing a game between midnight and 5:00 a.m. local time.')

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Cold Open' }).click()
  const lockedSecret = page.getByRole('dialog', { name: 'Cold Open' })
  await expect(lockedSecret).toContainText('Secret badge — earn it to reveal how.')
  await expect(lockedSecret).not.toContainText('new all-time best')
})

test('earned badge sharing includes its artwork, rung, player, and public profile link', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (payload: ShareData) => Boolean(payload.files?.length)
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload: ShareData) => {
        ;(window as unknown as { __badgeSharePayload?: ShareData }).__badgeSharePayload = payload
      }
    })
  })
  await page.goto('/#/leaderboards')
  await page.getByRole('tab', { name: 'Badges' }).click()
  await page.getByRole('button', { name: 'Clockbreaker, 35s' }).click()

  const dialog = page.getByRole('dialog', { name: 'Clockbreaker' })
  const axe = await new AxeBuilder({ page }).analyze()
  expect(
    axe.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  ).toEqual([])
  await dialog.getByRole('button', { name: 'Share badge' }).click()
  await expect(dialog.getByRole('button', { name: 'Shared' })).toBeVisible({ timeout: 10_000 })

  const payload = await page.evaluate(async () => {
    const shared = (window as unknown as { __badgeSharePayload?: ShareData }).__badgeSharePayload
    const file = shared?.files?.[0]
    let dimensions: { width: number; height: number } | undefined
    let imageBase64: string | undefined
    if (file) {
      const header = new DataView(await file.slice(0, 24).arrayBuffer())
      dimensions = { width: header.getUint32(16), height: header.getUint32(20) }
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 16_384) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
      }
      imageBase64 = btoa(binary)
    }
    return {
      title: shared?.title,
      text: shared?.text,
      url: shared?.url,
      file: file ? { name: file.name, type: file.type, size: file.size, ...dimensions } : undefined,
      imageBase64
    }
  })
  expect(payload).toMatchObject({
    title: 'Knight Main earned Clockbreaker | Elixir Drop',
    text: 'Knight Main earned the Clockbreaker badge on Elixir Drop — 35s.',
    url: expect.stringMatching(/#\/players\/player-1$/),
    file: {
      name: 'elixir-drop-clockbreaker.png',
      type: 'image/png',
      size: expect.any(Number),
      width: 1080,
      height: 1350
    }
  })
  expect(payload.file!.size).toBeGreaterThan(50_000)
  await testInfo.attach('badge-share-card.png', {
    body: Buffer.from(payload.imageBase64!, 'base64'),
    contentType: 'image/png'
  })

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'All Six' }).click()
  await expect(page.getByRole('dialog', { name: 'All Six' }).getByRole('button', { name: 'Share badge' })).toHaveCount(
    0
  )
})

test('the Log groups games by day, filters flagged, and pages older games in', async ({ page }, testInfo) => {
  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })

  const games = page.locator('.ed-games')
  // The current season's games default in, grouped by local day.
  await expect(games.locator('.ed-games__row')).toHaveCount(30)
  await expect(games.locator('.ed-games__day-head').first()).toContainText('game')

  // One filter chip pair — Flagged narrows to the referee-touched runs.
  await games.getByRole('button', { name: /Flagged/ }).click()
  await expect(games.locator('.ed-games__row')).toHaveCount(2)
  await games.getByRole('button', { name: 'All', exact: true }).click()
  await expect(games.locator('.ed-games__row')).toHaveCount(30)

  // "Older games" pages the tail: the older season's runs are fetched on demand
  // and appended, never in the first payload.
  const seasonRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/me/seasons') seasonRequests.push(url.searchParams.get('season') ?? '')
  })
  await games.getByRole('button', { name: 'Older games' }).click()
  await expect.poll(() => seasonRequests).toContain('2026-06')
  await expect(games.locator('.ed-games__row')).toHaveCount(32)
  await expect(games.getByRole('button', { name: 'Older games' })).toHaveCount(0)

  await testInfo.attach('your-games.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
})

test('public profiles display earned badges prominently', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload: ShareData) => {
        ;(window as unknown as { __badgeSharePayload?: ShareData }).__badgeSharePayload = payload
      }
    })
  })
  await page.goto('/#/players/player-2', { waitUntil: 'domcontentloaded' })

  const badgeWall = page.locator('.ed-profile__badges')
  const stats = page.locator('.ed-profile__stats')
  await expect(page.locator('.ed-profile__clash')).toContainText('King Thing')
  await expect(page.getByRole('link', { name: 'View King Thing on RoyaleAPI' })).toHaveAttribute(
    'href',
    'https://royaleapi.com/player/UL2V9QRGO'
  )
  await expect(page.getByRole('link', { name: 'View clan POAP KINGS on RoyaleAPI' })).toHaveAttribute(
    'href',
    'https://royaleapi.com/clan/J2RGCRVG'
  )
  await expect(badgeWall).toContainText('4 earned')
  await expect(badgeWall.getByRole('button', { name: 'Clockbreaker, 35s' })).toBeVisible()
  await expect(badgeWall.getByRole('button', { name: 'Night Shift, 1' })).toBeVisible()
  expect((await badgeWall.boundingBox())!.y).toBeLessThan((await stats.boundingBox())!.y)
  await badgeWall.getByRole('button', { name: 'Clockbreaker, 35s' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Clockbreaker' }).getByRole('button', { name: 'Share badge' })
  ).toBeVisible()
  await page.getByRole('dialog', { name: 'Clockbreaker' }).getByRole('button', { name: 'Share badge' }).click()
  await expect(page.getByRole('dialog', { name: 'Clockbreaker' }).getByRole('button', { name: 'Shared' })).toBeVisible()
  expect(
    await page.evaluate(() => (window as unknown as { __badgeSharePayload?: ShareData }).__badgeSharePayload)
  ).toMatchObject({
    title: 'Royal Ghosted earned Clockbreaker | Elixir Drop',
    url: expect.stringMatching(/#\/players\/player-2$/)
  })
  await testInfo.attach('public-profile-badges.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
})

test('saved player tag resolves through the bridge profile states', async ({ page }, testInfo) => {
  // The mocked CR profile carries CDN-shaped iconUrls (as the bridge relays);
  // serve them a pixel so no browser logs a 404.
  await page.route('https://api-assets.clashroyale.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      )
    })
  )
  await page.unroute(testApiRoute)
  await page.unroute('**/api-config.json')
  await page.route('**/api-config.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apiBaseUrl: testApiBaseUrl })
    })
  )

  const basePlayer = {
    id: 'player-1',
    email: 'player@example.com',
    publicName: 'Knight Main',
    favoriteCardId: 26000000,
    totalGames: 12,
    level: 2,
    levelStartGames: 10,
    nextLevelGames: 25,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z'
  }
  const session = { token: 'session-token', expiresAt: '2099-01-01T00:00:00.000Z' }
  let saved = false
  await page.route(testApiRoute, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/refresh') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session }) })
      return
    }
    if (url.pathname === '/me' && route.request().method() === 'PATCH') {
      saved = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          player: {
            ...basePlayer,
            playerTag: '#20JJJ2CCRU',
            clashRoyale: { tag: '#20JJJ2CCRU', status: 'pending' }
          }
        })
      })
      return
    }
    if (url.pathname === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          player: saved
            ? {
                ...basePlayer,
                playerTag: '#20JJJ2CCRU',
                clashRoyale: {
                  tag: '#20JJJ2CCRU',
                  status: 'ready',
                  name: 'King Thing',
                  clan: { tag: '#J2RGCRVG', name: 'POAP KINGS', badgeId: 16000000, role: 'leader' },
                  cards: [
                    {
                      id: 26000000,
                      name: 'Knight',
                      iconUrl: 'https://api-assets.clashroyale.com/cards/300/knight.png'
                    },
                    {
                      id: 26000001,
                      name: 'Archers',
                      iconUrl: 'https://api-assets.clashroyale.com/cards/300/archers.png'
                    }
                  ],
                  fetchedAt: '2026-07-18T13:27:25.039Z'
                }
              }
            : basePlayer,
          recentRuns: []
        })
      })
      return
    }
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  await page.addInitScript((storedSession) => {
    localStorage.setItem('elixirdrop:session:v1', JSON.stringify(storedSession))
  }, session)

  // Adding a player tag opens step 3 of the identity flow (Account routes here).
  await page.goto('/#/profile?edit=player-tag')
  const tagInput = page.getByPlaceholder('#PLAYER_TAG')
  await expect(tagInput).toBeVisible()
  await tagInput.fill('20JJJ2CCRU')
  await page.getByRole('button', { name: /PLAY AS/ }).click()
  // Back on the You view, the resolved CR profile renders in Account.
  await page.getByRole('tab', { name: 'Account' }).click()

  // The Clash Royale block is clan name + tag only — no role, no collection.
  const account = page.locator('.ed-account')
  await expect(account).toContainText('POAP KINGS', { timeout: 8_000 })
  await expect(account).toContainText('#20JJJ2CCRU')
  await expect(account).not.toContainText('Leader')
  await expect(page.locator('.cr-profile')).toHaveCount(0)
  await expect(account).not.toContainText('Collection')
  await expect(page.getByLabel('Clash Royale card collection')).toHaveCount(0)
  await expect(account).not.toContainText(/troph|arena|card level/i)

  const screenshot = await page.screenshot({ fullPage: true })
  await testInfo.attach('resolved-cr-profile.png', { body: screenshot, contentType: 'image/png' })
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
  expect(serious).toEqual([])
})
