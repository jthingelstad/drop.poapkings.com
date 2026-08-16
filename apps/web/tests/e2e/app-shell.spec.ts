import {
  allowExpectedApiErrors,
  expect,
  isDesktopViewport,
  leaderboardEntries,
  test,
  testActivity,
  testApiBaseUrl,
  testApiRoute,
  testSeason,
  testStats,
  useSignedOutState
} from './fixtures'

test('a stale installed app checks immediately and cache-busts its reload', async ({ page }) => {
  await page.route(`${testApiBaseUrl}/stats`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...testStats, webVersion: 'newer-build' })
    })
  )

  await page.goto('/#/higher-lower')
  const reload = page.getByRole('button', { name: 'Reload' })
  await expect(reload).toBeVisible()
  // Let WebKit finish the lazy route import before replacing the document.
  // The route fallback intentionally looks identical to the game start stage,
  // so its nonvisual marker is the synchronization boundary here.
  await expect(page.locator('.ed-game')).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('[data-game-route-loading]')).toHaveCount(0, { timeout: 12_000 })
  await reload.click()

  await expect.poll(() => new URL(page.url()).searchParams.get('drop-refresh')).toMatch(/^\d+$/)
  expect(new URL(page.url()).hash).toBe('#/higher-lower')
})

test('treats an API outage as offline and recovers without a retry panel', async ({ page, viewport }) => {
  allowExpectedApiErrors.add(page)
  let available = false
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!available) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Try again.' } })
      })
      return
    }
    if (path === '/stats') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(testStats)
      })
      return
    }
    if (path === '/leaderboards') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'surge',
          seasonId: testSeason.id,
          currentSeason: testSeason,
          entries: leaderboardEntries('surge')
        })
      })
      return
    }
    if (path === '/activity') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testActivity) })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await useSignedOutState(page)
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  await expect(page.locator('.api-status')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Drop is taking a quick elixir break' })).toHaveCount(0)

  const primaryNav = page.getByRole('navigation', { name: 'Primary' })
  await expect(
    primaryNav.getByRole('button', { name: isDesktopViewport(viewport) ? 'Leaderboards' : 'Ranks', exact: true })
  ).toHaveCount(0)
  await expect(
    primaryNav.getByRole('button', { name: isDesktopViewport(viewport) ? 'Profile' : 'You', exact: true })
  ).toHaveCount(0)
  const offlineNav = primaryNav.getByRole('button', {
    name: isDesktopViewport(viewport) ? 'Offline mode' : 'Offline',
    exact: true
  })
  await expect(offlineNav).toBeVisible()
  await expect(page.locator('.ed-gcard').first().getByRole('button')).toContainText('Play offline')
  await offlineNav.click()
  await expect(page.getByRole('heading', { name: 'Offline mode is ready' })).toBeVisible()

  // Restricted airplane Wi-Fi can become generally usable without changing
  // navigator.onLine. Returning focus triggers the quiet health probe.
  available = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: 'You’re back online' })).toBeVisible()
  await expect(offlineNav).toHaveCount(0)
  await expect(
    primaryNav.getByRole('button', { name: isDesktopViewport(viewport) ? 'Leaderboards' : 'Ranks', exact: true })
  ).toBeVisible()
  await expect(
    primaryNav.getByRole('button', { name: isDesktopViewport(viewport) ? 'Profile' : 'You', exact: true })
  ).toBeVisible()
})
