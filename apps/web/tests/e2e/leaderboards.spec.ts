import type { GameMode } from '@elixir-drop/contracts'
import {
  expect,
  test,
  testApiRoute,
  testPlayer,
  testPublishedProfileUrl,
  testSeason,
  testSession,
  testStats
} from './fixtures'

test('leaderboards are season-scoped, not week-scoped', { tag: '@deploy' }, async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(message: string) {
          ;(window as unknown as { __clanInviteMessage?: string }).__clanInviteMessage = message
          return Promise.resolve()
        }
      }
    })
  })
  await page.goto('/#/leaderboards')

  // One fixed title on every scope — always "Ladder" — with the current
  // season's close beside it on ranked boards.
  await expect(page.locator('.ed-ladder__title')).toHaveText('Ladder')
  await expect(page.locator('.ed-ladder__clock')).toContainText('Ends')
  await expect(page.locator('.ed-ladder__clock')).toContainText('Aug 3 · 10:00 UTC')
  // The Clan-Wars weekly clock must not appear on the season board.
  await expect(page.locator('.ed-ladder__clock')).not.toContainText('left in week')
  // Past seasons live in the Boards period rail, newest first after All-time.
  await expect(page.locator('.ed-ladder__periods')).toContainText('Season 134')
  await expect(page.locator('.ed-ladder__periods')).not.toContainText('Season 133')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')
  await expect(page.locator('.ed-lbrow').first().getByLabel('Elixir Drop developer')).toHaveText('DEV')
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

  // Switch the per-mode tab to Survival. The tabs are labeled tiles now, with an
  // uppercase short name (SURVIVE) over the mode art.
  await page.locator('.ed-board__modes').getByRole('button', { name: 'SURVIVE' }).click()
  await expect(page).toHaveURL(/#\/leaderboards\?mode=survival$/)
  await expect(page.locator('.ed-modetab--active')).toContainText('SURVIVE')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')
  await expect(page.locator('.ed-lbrow__score').first()).toContainText('42')
  await expect(page.locator('.ed-lbrow__score').first()).not.toContainText('streak')
  await expect(page.locator('.ed-lbrow__time').first()).toHaveText('61.317s')

  // Toggling the period rail to All-time keeps the header fixed and only moves
  // the pressed chip, while the ranked player rows still render.
  await page.locator('.ed-ladder__periods').getByRole('button', { name: 'All-time' }).click()
  await expect(page).toHaveURL(/#\/leaderboards\?mode=survival&period=all-time$/)
  await expect(page.locator('.ed-ladder__title')).toHaveText('Ladder')
  await expect(page.locator('.ed-period--active')).toHaveText('All-time')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')

  // And back to Season 134 restores the current-season board.
  await page.locator('.ed-ladder__periods').getByRole('button', { name: 'Season 134' }).click()
  await expect(page).toHaveURL(/#\/leaderboards\?mode=survival&season=134$/)
  await expect(page).not.toHaveURL(/2026-07/)
  await expect(page.locator('.ed-period--active')).toHaveText('Season 134')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.ed-modetab--active')).toContainText('SURVIVE')
  await expect(page.locator('.ed-period--active')).toHaveText('Season 134')

  // XP is permanent player progression, so it owns the arena and the daily
  // source ledger while the seasonal controls leave the page.
  await page.getByRole('tab', { name: 'XP', exact: true }).click()
  await expect(page).toHaveURL(/#\/leaderboards\?scope=xp&mode=survival&season=134$/)
  await expect(page.locator('.ed-ladder__clock')).toHaveCount(0)
  await expect(page.locator('.ed-ladder__periods')).toHaveCount(0)
  await expect(page.locator('.ed-board__mode-strip')).toHaveCount(0)
  await expect(page.locator('.ed-xp__total')).toHaveText('480 XP')
  await expect(page.locator('.ed-xp__history-head')).toContainText('+380 across 3 days')
  await expect(page.locator('.ed-xp__day').first()).toContainText('Games +100 · Personal bests +10 · Badges +30')
  await expect(page.locator('.ed-xp__opening')).toContainText('100 XP')
  const xpScreenshot = testInfo.outputPath('xp-history.png')
  await page.screenshot({ path: xpScreenshot, fullPage: true })
  await testInfo.attach('xp-history.png', { path: xpScreenshot, contentType: 'image/png' })

  // Clan is a scope of its own; ranks are recalculated inside the signed-in
  // player's current CR clan. Its identity lives in a strip; the header never moves.
  await page.getByRole('tab', { name: 'Clan' }).click()
  await expect(page).toHaveURL(/#\/leaderboards\?scope=clan&mode=survival&season=134$/)
  await expect(page.locator('.ed-ladder__title')).toHaveText('Ladder')
  await expect(page.locator('.ed-board__clan')).toContainText('POAP KINGS')
  await expect(page.locator('.ed-board__clan')).toContainText('#J2RGCRVG')
  await expect(page.locator('.ed-board__list')).toContainText('Knight Main')
  await expect(page.locator('.ed-clan-invite')).toContainText('Bring a clanmate in')
  await expect(page.locator('.ed-clan-invite')).not.toContainText('More clanmates on Drop')

  // Invite is an in-game copy flow, not an outbound Clash Royale clan link.
  const inviteButton = page.locator('.ed-clan-invite').getByRole('button', { name: 'Invite', exact: true })
  await expect(inviteButton).toBeVisible()
  await expect(page.locator('.ed-clan-invite').getByRole('link', { name: 'Invite', exact: true })).toHaveCount(0)
  await inviteButton.click()
  const inviteDialog = page.getByRole('dialog', { name: 'Invite clanmates' })
  await expect(inviteDialog).toBeVisible()
  await expect(inviteDialog.getByRole('tab', { name: 'Clan Chat' })).toHaveAttribute('aria-selected', 'true')
  await expect(inviteDialog.getByLabel('Clan Chat message preview')).toHaveText(
    "I'm #4 in Survival (best: 24 streak). Beat me on our Drop ladder: DROP . POAPKINGS . COM"
  )
  await expect(inviteDialog).not.toContainText('Free Pass')
  await inviteDialog.getByRole('button', { name: 'Copy for Clan Chat' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __clanInviteMessage?: string }).__clanInviteMessage))
    .toBe("I'm #4 in Survival (best: 24 streak). Beat me on our Drop ladder: DROP . POAPKINGS . COM")
  await inviteDialog.getByRole('tab', { name: 'Discord' }).click()
  await expect(inviteDialog.getByLabel('Discord message preview')).toContainText(
    'Knight Main, currently #4 in Survival on POAP KINGS Clan Ladder'
  )
  await expect(inviteDialog.getByRole('button', { name: 'Copy for Discord' })).toBeVisible()
  const inviteScreenshot = testInfo.outputPath('clan-invite-modal.png')
  await page.screenshot({ path: inviteScreenshot })
  await testInfo.attach('clan-invite-modal.png', { path: inviteScreenshot, contentType: 'image/png' })
  await inviteDialog.getByRole('button', { name: 'Copy for Discord' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __clanInviteMessage?: string }).__clanInviteMessage))
    .toBe(
      `I'm **Knight Main**, currently **#4 in Survival** on the **POAP KINGS Clan Ladder** (best: **24 streak**).\n\nThink you can beat me? [Take the challenge on Elixir Drop](${testPublishedProfileUrl()})`
    )
  await page.keyboard.press('Escape')
  await expect(inviteDialog).toHaveCount(0)
  await expect(inviteButton).toBeFocused()

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
  await expect(page.getByLabel('Elixir Drop developer')).toHaveText('DEV')
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
