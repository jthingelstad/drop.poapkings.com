import { allowOfflineTransportErrors, expect, test, testApiRoute } from './fixtures'

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
  // The hero says the same thing its cards do, rather than still reading PLAY.
  const hero = page.locator('.ed-hero')
  await expect(hero).toHaveClass(/ed-hero--offline/)
  await expect(hero.getByRole('button', { name: 'OFFLINE' })).toBeDisabled()

  // Practice is reachable from the notice itself.
  await notice.getByRole('button', { name: 'Practice' }).click()
  await expect(page).toHaveURL(/#\/practice/)

  await setOnline(page, true)
  await expect(page.locator('.ed-offline')).toHaveCount(0)
})

test('Practice is actually playable with player services unreachable', async ({ page }) => {
  // The real cold-boot shape: the app opens from cache, every API call fails,
  // and the account never resolves. Practice must still deal and play — the
  // first version of this shipped with an account gate in front of it, so the
  // local deal was never reached.
  allowOfflineTransportErrors.add(page)
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, (route) => route.abort('internetdisconnected'))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  })

  await page.goto('/#/practice')

  // Not the reconnect gate.
  await expect(page.locator('.account-screen')).toHaveCount(0)
  // A real dealt hand, from the bundled catalog.
  await expect(page.locator('.ed-game')).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.pip-keypad')).toBeVisible()
  await expect(page.locator('.ed-game__progress')).toHaveText('0 answered')

  // And it plays: answering advances the drill with no server involved.
  await page.locator('.pip-keypad button').first().click()
  await expect(page.locator('.ed-game__progress')).toHaveText('1 answered')
})

test('the Practice chunk is fetched while online, before it is needed', async ({ page }) => {
  // The bug this guards: Practice is a lazily-loaded route, so its chunk is
  // absent from the document's script list and the shell cache never saw it.
  // Offline, the dynamic import failed and the error boundary took the screen.
  // Warming it on Home is what puts it in the cache while a network exists.
  const requested: string[] = []
  page.on('request', (request) => {
    if (/modes[/\\]practice/.test(request.url())) requested.push(request.url())
  })

  await page.goto('/')
  await expect(page.locator('.ed-gcard').first()).toBeVisible()

  // Without ever navigating to Practice.
  await expect.poll(() => requested.length, { timeout: 10_000 }).toBeGreaterThan(0)
  await expect(page).toHaveURL(/#?\/?$/)
})
