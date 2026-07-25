import {
  allowExpectedApiErrors,
  expect,
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
  // Let WebKit finish the lazy route import before replacing the document;
  // otherwise its discarded page reports the intentional abort as an error.
  await expect(page.locator('.ed-game')).toBeVisible({ timeout: 12_000 })
  await reload.click()

  await expect.poll(() => new URL(page.url()).searchParams.get('drop-refresh')).toMatch(/^\d+$/)
  expect(new URL(page.url()).hash).toBe('#/higher-lower')
})

test('shows a friendly API outage notice and recovers in place', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  let available = false
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/stats') {
      await route.fulfill({
        status: available ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(
          available ? testStats : { error: { code: 'temporarily_unavailable', message: 'Try again.' } }
        )
      })
      return
    }
    if (path === '/leaderboards') {
      await route.fulfill({
        status: available ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(
          available
            ? {
                mode: 'surge',
                seasonId: testSeason.id,
                currentSeason: testSeason,
                entries: leaderboardEntries('surge')
              }
            : { error: { code: 'temporarily_unavailable', message: 'Try again.' } }
        )
      })
      return
    }
    // The desktop right rail also polls /activity; keep it benign so the outage
    // banner (driven by /stats) is what the test observes.
    if (path === '/activity') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testActivity) })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await useSignedOutState(page)
  const outage = page.locator('.api-status')
  await expect(page.getByRole('heading', { name: 'Drop is taking a quick elixir break' })).toBeVisible()
  await expect(outage).toContainText('Your account and recorded games are safe.')

  available = true
  await page.getByRole('button', { name: 'Try reconnecting' }).click()
  await expect(outage).toHaveCount(0)
  // Recovers in place: the Home surface renders (the Surge hero + PLAY button).
  await expect(page.locator('.ed-hero')).toBeVisible()
})
