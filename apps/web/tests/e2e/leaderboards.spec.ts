import type { GameMode } from '@elixir-drop/contracts'
import { expect, test, testApiRoute, testPlayer, testSeason, testSession, testStats } from './fixtures'

test('leaderboards are season-scoped, not week-scoped', { tag: '@deploy' }, async ({ page }, testInfo) => {
  await page.goto('/#/leaderboards')

  // One fixed title on every scope; the season labels the scope segment and
  // the clock sits beside the title as two short lines.
  await expect(page.locator('.ed-board__title')).toHaveText('Leaderboards')
  await expect(page.locator('.ed-board__clock')).toContainText('Season ends')
  await expect(page.locator('.ed-board__clock')).toContainText('Aug 3 · 10:00 UTC')
  // The Clan-Wars weekly clock must not appear on the season board.
  await expect(page.locator('.ed-board__clock')).not.toContainText('left in week')
  await expect(page.locator('.ed-board__scopes')).toContainText('Season 134')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')
  await expect(page.locator('.ed-lbrow--you')).toContainText('You')
  await expect(page.locator('.ed-board__list')).toContainText('XP')

  // The mark is a CSS seal, not a glyph, and the old review-key aside is gone.
  const seal = page.getByLabel('Referee cleared').first()
  await expect(seal).toBeVisible()
  await expect(seal).toHaveText('')
  await expect(page.locator('.ed-board__review-key')).toHaveCount(0)
  await expect(page.locator('.ed-board__key')).toContainText('ranks while it is checked')
  await expect(page.locator('.ed-board__key').getByRole('link', { name: 'Fair Play' })).toHaveAttribute(
    'href',
    '/fair-play/'
  )

  // A run awaiting the referee ranks in place and says so on its own row.
  const awaiting = page.locator('.ed-lbrow').nth(1)
  await expect(awaiting.getByLabel('Awaiting referee')).toBeVisible()
  await expect(awaiting.locator('.ed-lbrow__meta--awaiting')).toHaveText('Awaiting the referee')

  // Three bands above the first row at 390px: header, scopes, mode strip.
  const firstRow = page.locator('.ed-lbrow').first()
  const firstName = firstRow.locator('.ed-lbrow__name')
  const firstScore = firstRow.locator('.ed-lbrow__score')
  await expect(firstName).toBeVisible()
  await expect(firstScore).toContainText('58.410s')
  const [nameBounds, scoreBounds] = await Promise.all([firstName.boundingBox(), firstScore.boundingBox()])
  expect(nameBounds).not.toBeNull()
  expect(scoreBounds).not.toBeNull()
  expect(nameBounds!.width).toBeGreaterThan(40)
  expect(nameBounds!.x).toBeLessThan(scoreBounds!.x)

  // Switch the per-mode tab to Survival. The tabs are the mode art now, so
  // they are addressed by their accessible name rather than visible text.
  await page.locator('.ed-board__modes').getByRole('button', { name: 'Survival' }).click()
  await expect(page.locator('.ed-modetab--active')).toHaveAttribute('aria-label', 'Survival')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')
  await expect(page.locator('.ed-lbrow__score').first()).toContainText('42')
  await expect(page.locator('.ed-lbrow__score').first()).not.toContainText('streak')
  await expect(page.locator('.ed-lbrow__time').first()).toHaveText('61.317s')

  // Toggling to All-time keeps the header fixed and only moves the pressed
  // scope, while the ranked player rows still render.
  await page.getByRole('button', { name: 'All-time' }).click()
  await expect(page.locator('.ed-board__title')).toHaveText('Leaderboards')
  await expect(page.locator('.ed-scope--active')).toHaveText('All-time')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')

  // And back to Season restores the season-labelled segment.
  await page.getByRole('button', { name: 'Season 134' }).click()
  await expect(page.locator('.ed-scope--active')).toHaveText('Season 134')

  // Clan is an all-time board scoped to the signed-in player's current CR
  // clan, with ranks recalculated inside that clan. Its identity lives in a
  // strip under the tabs; the header and scope row never move.
  await page.getByRole('button', { name: 'Clan', exact: true }).click()
  await expect(page.locator('.ed-board__title')).toHaveText('Leaderboards')
  await expect(page.locator('.ed-board__clan')).toContainText('POAP KINGS')
  await expect(page.locator('.ed-board__clan')).toContainText('#J2RGCRVG')
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
