import type { Page, Route } from '@playwright/test'
import {
  expect,
  fulfillSupportData,
  fulfillTestRun,
  test,
  testApiRoute,
  testPlayer,
  testRecentRuns,
  testSession
} from './fixtures'

const missingTagPlayer = {
  ...testPlayer,
  id: 'missing-tag-player',
  playerTag: undefined,
  clashRoyale: undefined
}

async function useMissingTagAccount(page: Page) {
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route: Route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/refresh') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: testSession })
      })
      return
    }
    if (path === '/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ player: missingTagPlayer, recentRuns: testRecentRuns })
      })
      return
    }
    if (await fulfillSupportData(route)) return
    if (await fulfillTestRun(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
}

test('weekly tag reminder opens the profile tag field and stays dismissed for seven days', async ({
  page
}, testInfo) => {
  await useMissingTagAccount(page)
  await page.goto('/#/')

  const dialog = page.getByRole('dialog', { name: 'Connect Clash Royale' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('player name, clan, and clan rankings')
  await page.waitForTimeout(250)
  const nudgeScreenshot = testInfo.outputPath('player-tag-nudge.png')
  await page.screenshot({ path: nudgeScreenshot })
  await testInfo.attach('player-tag-nudge.png', { path: nudgeScreenshot, contentType: 'image/png' })

  await page.getByRole('button', { name: 'Maybe later' }).click()
  await page.reload()
  await expect(dialog).toBeHidden()

  await page.addInitScript((playerId) => {
    localStorage.setItem(
      'elixirdrop:playerTagNudge',
      JSON.stringify({ [playerId]: Date.now() - 8 * 24 * 60 * 60 * 1000 })
    )
  }, missingTagPlayer.id)
  await page.reload()
  await expect(dialog).toBeVisible()

  await page.getByRole('button', { name: 'Add player tag' }).click()
  await expect(page).toHaveURL(/#\/profile\?edit=player-tag$/)
  const tagInput = page.getByRole('textbox', { name: 'Clash Royale player tag' })
  await expect(tagInput).toBeVisible()
  await expect(tagInput).toBeFocused()
})

test('tag reminder waits until active play has been left', async ({ page }) => {
  await useMissingTagAccount(page)
  await page.goto('/#/surge')
  await expect(page.getByRole('dialog', { name: 'Connect Clash Royale' })).toHaveCount(0)

  await page.goto('/#/')
  await expect(page.getByRole('dialog', { name: 'Connect Clash Royale' })).toBeVisible()
})
