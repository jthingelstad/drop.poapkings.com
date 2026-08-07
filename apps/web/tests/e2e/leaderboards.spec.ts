import type { GameMode } from '@elixir-drop/contracts'
import { expect, test, testApiRoute, testPlayer, testSeason, testSession, testStats } from './fixtures'

test('leaderboards are season-scoped, not week-scoped', async ({ page }, testInfo) => {
  await page.goto('/#/leaderboards')

  await expect(page.getByRole('heading', { name: 'Season 134 leaderboards' })).toBeVisible()
  await expect(page.locator('.ed-board__timing')).toContainText(
    'Season ends August 3 at 10:00 UTC — new boards open then'
  )
  // The Clan-Wars weekly clock must not appear on the season board.
  await expect(page.locator('.ed-board__timing')).not.toContainText('left in week')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')
  await expect(page.locator('.ed-lbrow--you')).toContainText('You')
  await expect(page.locator('.ed-board__list')).toContainText('XP')

  const firstRow = page.locator('.ed-lbrow').first()
  const firstName = firstRow.locator('.ed-lbrow__name')
  const firstScore = firstRow.locator('.ed-lbrow__score')
  await expect(firstName).toBeVisible()
  const [nameBounds, scoreBounds] = await Promise.all([firstName.boundingBox(), firstScore.boundingBox()])
  expect(nameBounds).not.toBeNull()
  expect(scoreBounds).not.toBeNull()
  expect(nameBounds!.width).toBeGreaterThan(40)
  expect(nameBounds!.x).toBeLessThan(scoreBounds!.x)

  // Switch the per-mode tab to Survival.
  await page.locator('.ed-board__modes').getByRole('button', { name: 'Survival' }).click()
  await expect(page.locator('.ed-modetab--active')).toContainText('Survival')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')

  // Toggling to All-time switches the board to the best-ever heading and drops
  // the season-reset line, while the ranked player rows still render.
  await page.getByRole('button', { name: 'All-time' }).click()
  await expect(page.getByRole('heading', { name: 'All-time leaderboards' })).toBeVisible()
  await expect(page.locator('.ed-board__timing')).not.toContainText('new boards open then')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')

  // And back to Season restores the season heading.
  await page.getByRole('button', { name: 'Season', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Season 134 leaderboards' })).toBeVisible()

  // Clan is an all-time board scoped to the signed-in player's current CR
  // clan, with ranks recalculated inside that clan.
  await page.getByRole('button', { name: 'Clan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'POAP KINGS rankings' })).toBeVisible()
  await expect(page.locator('.ed-board__timing')).toContainText('All-time bests among current clanmates · #J2RGCRVG')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')
  await page.waitForTimeout(250)
  const clanScreenshot = testInfo.outputPath('clan-rankings.png')
  await page.screenshot({ path: clanScreenshot })
  await testInfo.attach('clan-rankings.png', { path: clanScreenshot, contentType: 'image/png' })
})

test('leaderboard and recent-run entries open the selected public player', async ({ page }) => {
  await page.goto('/#/leaderboards')

  await page.getByRole('button', { name: "View Royal Ghosted's profile" }).click()
  await expect(page).toHaveURL(/#\/players\/player-2$/)
  await expect(page.getByRole('heading', { name: 'Royal Ghosted' })).toBeVisible()
  await expect(page.locator('.ed-public-profile')).not.toContainText(testPlayer.email)
  await expect(page.locator('.ed-public-profile')).not.toContainText('Edit')

  if ((page.viewportSize()?.width ?? 0) >= 1000) {
    await page.locator('.ed-rail-live').getByRole('button').first().click()
    await expect(page).toHaveURL(/#\/players\/player-9$/)
    await expect(page.getByRole('heading', { name: 'Skarmy Party' })).toBeVisible()
  }
})

test('an empty leaderboard offers a play call-to-action', async ({ page }) => {
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/auth/refresh') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (url.pathname === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (url.pathname === '/leaderboards') {
      const mode = (url.searchParams.get('mode') ?? 'surge') as GameMode
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode, scope: 'season', seasonId: testSeason.id, currentSeason: testSeason, entries: [] })
      })
      return
    }
    if (url.pathname === '/activity') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ seasonId: '2026-07', entries: [] })
      })
      return
    }
    if (url.pathname === '/stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testStats) })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/leaderboards')
  await expect(page.locator('.ed-board__empty')).toContainText('Nobody has posted')
  await expect(page.getByRole('button', { name: /Play Surge/ })).toBeVisible()
})
