import {
  allowExpectedApiErrors,
  expect,
  leaderboardEntries,
  test,
  testActivity,
  testApiRoute,
  testSeason,
  testStats,
  useSignedOutState
} from './fixtures'

test('a stale installed app checks immediately and cache-busts its reload', { tag: '@deploy' }, async ({ page }) => {
  await page.route('**/version.json*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ webVersion: 'newer-build' })
    })
  )

  // The update strip is a tier-4 interrupt: it shows on idle screens only, never
  // over a run or a summary. Sit on the Ladder (idle) rather than a game route.
  await page.goto('/#/leaderboards')
  const reload = page.getByRole('button', { name: 'Reload' })
  await expect(reload).toBeVisible()
  await reload.click()

  await expect.poll(() => new URL(page.url()).searchParams.get('drop-refresh')).toMatch(/^\d+$/)
  expect(new URL(page.url()).hash).toBe('#/leaderboards')
})

test('treats an API outage as offline and recovers without a retry panel', { tag: '@deploy' }, async ({ page }) => {
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

  // The nav never renames itself: Play · Ladder · You stay put, and there is no
  // "Offline" destination or route takeover — an API outage is just offline.
  const primaryNav = page.getByRole('navigation', { name: 'Primary' })
  await expect(primaryNav).toContainText('Ladder')
  await expect(primaryNav).toContainText('You')
  await expect(primaryNav).not.toContainText('Offline mode')
  await expect(page.getByRole('heading', { name: 'Offline mode is ready' })).toHaveCount(0)

  // Restricted airplane Wi-Fi can become generally usable without changing
  // navigator.onLine. Returning focus triggers the quiet health probe.
  available = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  // The nav was never swapped, so it is still there after recovery.
  await expect(primaryNav).toContainText('Ladder')
  await expect(primaryNav).toContainText('You')
})
