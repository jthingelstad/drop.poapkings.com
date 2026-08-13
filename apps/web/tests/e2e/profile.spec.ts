import AxeBuilder from '@axe-core/playwright'
import { runReference } from '@elixir-drop/contracts'
import {
  cardsData,
  expect,
  fulfillSupportData,
  isDesktopViewport,
  test,
  testApiBaseUrl,
  testApiRoute
} from './fixtures'

test('the profile is reachable from the shell and shows Player XP', async ({ page, viewport }) => {
  await page.goto('/')
  // Both shells expose a profile entry point; the XP itself now lives on the
  // profile (the old nav player-block XP chrome is gone).
  if (isDesktopViewport(viewport)) {
    await page.locator('.ed-rail-chip').first().click()
  } else {
    await page.locator('.ed-idchip').click()
  }

  await expect(page.locator('.profile-xp')).toContainText('Player XP')
  await expect(page.locator('.profile-xp')).toContainText('480')
  await expect(page.getByLabel('Review pending').first()).toBeVisible()
  await expect(page.getByLabel('Review pending').first()).toContainText('Pending')
  await expect(page.getByText(`Reference: ${runReference('recent-surge')}`).first()).toBeVisible()
  await expect(page.getByLabel('Not included in rankings').first()).toBeVisible()
  await expect(page.getByLabel('Not included in rankings').first()).toContainText('Excluded')
  await expect(page.getByText(`Reference: ${runReference('recent-trade')}`).first()).toBeVisible()
  await expect(page.getByText(/recorded response timing was not consistent with human play/).first()).toBeVisible()
})

test('settings persist input and motion preferences across reload', async ({ page }) => {
  await page.goto('/#/settings', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '4 choices' }).click()
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('button', { name: '4 choices' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)
  await expect(page.getByLabel('Build information')).toContainText('Build ID')
  await expect(page.getByLabel('Build information')).toContainText('Build date')
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
  const speedrun = page.getByRole('switch', { name: 'Speedrun keyboard' })
  await expect(speedrun).toHaveAttribute('aria-checked', 'false')
  await speedrun.click()
  await expect(speedrun).toHaveAttribute('aria-checked', 'true')
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

  await page.goBack()
  await expect(page).toHaveURL(/#\/profile$/)
  await expect(
    page.locator('.ed-profile__preferences').getByRole('switch', { name: 'Speedrun keyboard' })
  ).toHaveAttribute('aria-checked', 'true')
})

test('profile leads with badges and keeps settings near the bottom', async ({ page }, testInfo) => {
  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })

  const arena = page.locator('.ed-profile__stats')
  const badgeWall = page.locator('.ed-profile__badges')
  const preferences = page.locator('.ed-profile__preferences')
  // The profile now stacks three cards that share this styling; this is the
  // recent-games one specifically.
  const recent = page.locator('.ed-profile__games')
  await expect(preferences.getByRole('heading', { name: 'Game settings' })).toBeVisible()

  const seasons = page.locator('.ed-profile__seasons')
  const positions = await Promise.all(
    [badgeWall, arena, recent, seasons, preferences].map((surface) => surface.boundingBox())
  )
  expect(positions.every(Boolean)).toBe(true)
  expect(positions[1]!.y).toBeGreaterThan(positions[0]!.y + positions[0]!.height)
  expect(positions[2]!.y).toBeGreaterThan(positions[1]!.y + positions[1]!.height)
  expect(positions[3]!.y).toBeGreaterThan(positions[2]!.y + positions[2]!.height)
  expect(positions[4]!.y).toBeGreaterThan(positions[3]!.y + positions[3]!.height)
  await testInfo.attach('profile-hierarchy.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })

  const sound = preferences.getByRole('switch', { name: 'Sound effects' })
  const motion = preferences.getByRole('switch', { name: 'Reduce motion' })
  const effects = preferences.getByRole('switch', { name: 'Enhance effects' })
  await expect(sound).toHaveAttribute('aria-checked', 'false')
  await expect(motion).toHaveAttribute('aria-checked', 'false')
  await expect(effects).toHaveAttribute('aria-checked', 'true')

  await sound.click()
  await motion.click()
  await effects.click()
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.ed-profile__preferences').getByRole('switch', { name: 'Sound effects' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect(page.locator('.ed-profile__preferences').getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect(
    page.locator('.ed-profile__preferences').getByRole('switch', { name: 'Enhance effects' })
  ).toHaveAttribute('aria-checked', 'false')
})

test('opening a badge uses a focused modal instead of changing the badge wall', async ({ page }, testInfo) => {
  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: 'Clockbreaker, 35s' }).click()
  const sheet = page.getByRole('dialog', { name: 'Clockbreaker' })
  await expect(sheet).toBeFocused()
  await expect(sheet).toContainText('Fastest Surge run')
  await expect(sheet).toContainText('Next milestone')
  await expect(sheet).toContainText('Best: 34.2s · 4.2s faster to go')
  await expect(sheet.locator('.ed-badges__ladder')).toHaveCount(0)
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
  await expect(marathon.locator('.ed-badges__rung')).toHaveCount(0)
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
  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })
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

test('season totals use full history and open every game in a modal', async ({ page }, testInfo) => {
  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })

  const seasons = page.locator('.ed-profile__seasons')
  await expect(seasons).toContainText('27 games')
  await page.getByRole('button', { name: 'View 2026-07 games' }).click()
  const modal = page.getByRole('dialog', { name: '2026-07 games' })
  await expect(modal).toContainText('27 games played')
  await expect(modal.locator('li')).toHaveCount(27)
  await testInfo.attach('season-games-modal.png', {
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

  await page.goto('/#/profile')
  // The player tag now lives in the profile editor.
  await page.locator('.ed-profile__edit').click()
  const tagInput = page.getByPlaceholder('#PLAYER_TAG')
  await expect(tagInput).toBeVisible()
  await tagInput.fill('20JJJ2CCRU')
  await page.getByRole('button', { name: 'Save tag' }).click()
  // Return to the profile view, where the resolved CR profile renders.
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByRole('heading', { name: 'King Thing' })).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('.cr-profile')).toContainText('POAP KINGS')
  await expect(page.locator('.cr-profile')).toContainText('Account age unavailable')
  await expect(page.locator('.cr-profile')).toContainText('Years Played badge not returned by Clash Royale')
  // The collection COUNT stays; the card grid was removed (no use in Drop).
  await expect(page.locator('.cr-profile')).toContainText('Collection')
  await expect(page.locator('.cr-profile')).toContainText('Not used in Drop')
  await expect(page.getByLabel('Clash Royale card collection')).toHaveCount(0)
  await expect(page.locator('.cr-profile')).not.toContainText(/troph|arena|card level/i)

  const screenshot = await page.screenshot({ fullPage: true })
  await testInfo.attach('resolved-cr-profile.png', { body: screenshot, contentType: 'image/png' })
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
  expect(serious).toEqual([])
})
