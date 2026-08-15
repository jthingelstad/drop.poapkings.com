import { expect, test } from './fixtures'

// The UI keys off navigator.onLine and the online/offline events, so drive
// those directly. Killing the real socket would only add browser network
// errors to the console guard without testing anything extra.
async function setOnline(page: import('@playwright/test').Page, online: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value })
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  }, online)
}

test('offline dims ranked play and points at Practice', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.ed-gcard').first()).toBeVisible()
  await expect(page.locator('.ed-offline')).toHaveCount(0)

  await setOnline(page, false)

  // The notice leads with what still works, not just what broke.
  const notice = page.locator('.ed-offline')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Practice works right now')

  // Every ranked game says so up front instead of failing after the tap.
  const cards = page.locator('.ed-gcard')
  await expect(cards).toHaveCount(5)
  for (const card of await cards.all()) {
    await expect(card).toHaveClass(/ed-gcard--offline/)
    await expect(card.getByRole('button')).toBeDisabled()
  }
  await expect(page.locator('.ed-hero').getByRole('button', { name: 'PLAY' })).toBeDisabled()

  // Practice is reachable from the notice itself.
  await notice.getByRole('button', { name: 'Practice' }).click()
  await expect(page).toHaveURL(/#\/practice/)

  await setOnline(page, true)
  await expect(page.locator('.ed-offline')).toHaveCount(0)
})
