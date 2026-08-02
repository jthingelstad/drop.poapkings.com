import AxeBuilder from '@axe-core/playwright'
import { expect, fulfillSupportData, isDesktopViewport, test, testApiBaseUrl, testApiRoute } from './fixtures'

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

test('profile restores global game preferences between arena progress and recent games', async ({ page }) => {
  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })

  const arena = page.locator('.ed-profile__stats')
  const preferences = page.locator('.ed-profile__preferences')
  // The profile now stacks three cards that share this styling; this is the
  // recent-games one specifically.
  const recent = page.locator('.ed-profile__games')
  await expect(preferences.getByRole('heading', { name: 'Game settings' })).toBeVisible()

  const positions = await Promise.all([arena, preferences, recent].map((surface) => surface.boundingBox()))
  expect(positions.every(Boolean)).toBe(true)
  expect(positions[1]!.y).toBeGreaterThan(positions[0]!.y + positions[0]!.height)
  expect(positions[2]!.y).toBeGreaterThan(positions[1]!.y + positions[1]!.height)

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

test('opening a badge brings its detail sheet into view and accessible focus', async ({ page }) => {
  await page.goto('/#/profile', { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: 'Clockbreaker, 35s' }).click()
  const sheet = page.getByRole('group', { name: 'Clockbreaker' })
  await expect(sheet).toBeFocused()
  await expect(sheet).toContainText('Fastest Surge run')
  await expect(sheet).toContainText('Next: 30s')

  const position = await sheet.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight }
  })
  expect(position.top).toBeGreaterThanOrEqual(0)
  expect(position.top).toBeLessThan(position.viewportHeight)
  expect(position.bottom).toBeGreaterThan(0)
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
