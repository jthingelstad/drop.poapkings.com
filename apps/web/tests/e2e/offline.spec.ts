import {
  allowOfflineTransportErrors,
  cardsById,
  cardsData,
  completeSurge,
  expect,
  isDesktopViewport,
  test,
  testApiRoute,
  waitForKeypad
} from './fixtures'

// The UI keys off navigator.onLine and the online/offline events, so drive
// those directly. Killing the real socket would only add browser network
// errors to the console guard without testing anything extra.
async function setOnline(page: import('@playwright/test').Page, online: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value })
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  }, online)
}

test('offline shows in the player chip and offers every game locally', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.ed-gcard').first()).toBeVisible()
  await expect(page.locator('.ed-offline-glyph')).toHaveCount(0)

  await setOnline(page, false)

  // A persistent state gets a persistent mark, not a banner that sits over the
  // game while you play.
  const glyph = page.locator('.ed-offline-glyph')
  await expect(glyph).toBeVisible()
  await expect(glyph).toHaveAttribute('aria-label', 'Offline')
  // The old banner is gone for good.
  await expect(page.locator('.ed-offline')).toHaveCount(0)

  // Every ranked game says up front that this run is local, but remains playable.
  const cards = page.locator('.ed-gcard')
  await expect(cards).toHaveCount(5)
  for (const card of await cards.all()) {
    const button = card.getByRole('button')
    await expect(button).toBeEnabled()
    await expect(button).toContainText('Play offline')
    const descriptionId = await button.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    await expect(page.locator(`#${descriptionId}`)).toContainText('will not be saved or ranked')
  }
  const hero = page.locator('.ed-hero')
  const heroButton = hero.getByRole('button', { name: /PLAY OFFLINE/ })
  await expect(heroButton).toBeEnabled()
  const heroDescriptionId = await heroButton.getAttribute('aria-describedby')
  expect(heroDescriptionId).toBeTruthy()
  await expect(page.locator(`#${heroDescriptionId}`)).toContainText('will not be saved or ranked')

  await setOnline(page, true)
  await expect(page.locator('.ed-offline-glyph')).toHaveCount(0)
})

test('a signed-out desktop visitor still gets the offline mark', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop shell only')
  await page.addInitScript(() => localStorage.removeItem('elixirdrop:session:v1'))
  await page.goto('/?signedOut=1')
  await expect(page.locator('.ed-rail-chip__name')).toHaveText('Guest')

  await setOnline(page, false)

  await expect(page.locator('.ed-rail-chip--guest .ed-offline-glyph')).toBeVisible()
})

test('Leaderboards and You explain their offline boundary and lead back to games', async ({ page, viewport }) => {
  await page.goto('/')
  await expect(page.locator('.ed-gcard').first()).toBeVisible()

  // The shell is warm; now remove the API entirely. This proves the treatments
  // do not depend on a mocked error payload. Both screens lead back to the
  // complete offline catalog; the direct Practice shortcut is playable too.
  allowOfflineTransportErrors.add(page)
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, (route) => route.abort('internetdisconnected'))
  await setOnline(page, false)

  const primaryNav = page.getByRole('navigation', { name: 'Primary' })
  await primaryNav
    .getByRole('button', { name: isDesktopViewport(viewport) ? 'Leaderboards' : 'Ranks', exact: true })
    .click()
  await expect(page).toHaveURL(/#\/leaderboards$/)
  await expect(page.getByRole('heading', { name: 'Leaderboards need a connection' })).toBeVisible()
  await expect(page.locator('.ed-offline-page')).toContainText('never presents a saved board as current')
  await expect(page.locator('.ed-board')).toHaveCount(0)

  if (isDesktopViewport(viewport)) {
    await expect(page.locator('.ed-rail-standings')).toHaveText('Offline — reconnect for standings.')
    await expect(page.locator('.ed-rail-live')).toHaveText('Offline — reconnect for recent runs.')
    await expect(page.locator('.ed-desktop__right')).not.toContainText('Loading…')
  }

  await page.getByRole('button', { name: 'Choose a game' }).click()
  await expect(page).toHaveURL(/#?\/?$/)
  await primaryNav.getByRole('button', { name: isDesktopViewport(viewport) ? 'Profile' : 'You', exact: true }).click()
  await expect(page).toHaveURL(/#\/profile$/)
  await expect(page.getByRole('heading', { name: 'Your player data is safe' })).toBeVisible()
  await expect(page.locator('.ed-offline-page')).toContainText('does not keep an offline copy')
  await expect(page.locator('.account-screen')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send magic link' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Open Practice' }).click()
  await expect(page).toHaveURL(/#\/practice$/)
  await expect(page.locator('.ed-game')).toBeVisible({ timeout: 12_000 })
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

const offlineModes = ['surge', 'practice', 'higher-lower', 'trade', 'survival', 'rain'] as const

for (const mode of offlineModes) {
  test(`${mode} starts and responds with player services disconnected`, async ({ page }) => {
    allowOfflineTransportErrors.add(page)
    await page.unroute(testApiRoute)
    await page.route(testApiRoute, (route) => route.abort('internetdisconnected'))
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    })
    let runRequests = 0
    page.on('request', (request) => {
      if (/\/runs\/(?:start|complete)$/.test(new URL(request.url()).pathname)) runRequests += 1
    })

    await page.goto(`/#/${mode}`)
    await expect(page.locator('.ed-game__offline')).toContainText('Offline · not saved', { timeout: 12_000 })

    if (mode === 'higher-lower') {
      const choices = page.locator('.ed-duel__card')
      await expect(choices.first()).toBeEnabled({ timeout: 12_000 })
      const names = await choices
        .locator('.pcard__img')
        .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).alt))
      const costs = names.map((name) => cardsData.cards.find((card) => card.name === name)!.elixir)
      await choices.nth(costs[0]! > costs[1]! ? 0 : 1).click()
      await expect(page.locator('.ed-game__metric')).toHaveText('1')
    } else if (mode === 'trade') {
      const teams = page.locator('.ed-trade__teams')
      await expect(teams).toBeVisible({ timeout: 12_000 })
      const ids = async (side: string) =>
        page
          .locator(`.ed-trade__team--${side} [data-card-id]`)
          .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
      const total = (values: number[]) => values.reduce((sum, id) => sum + cardsById.get(id)!.elixir, 0)
      const answer = total(await ids('red')) - total(await ids('blue'))
      const label = answer === 0 ? 'Even trade' : `${answer > 0 ? `+${answer}` : answer} trade`
      await page.getByRole('button', { name: label }).click()
      await expect(teams).toHaveAttribute('data-trade-index', '2')
    } else if (mode === 'rain') {
      await waitForKeypad(page)
      const tile = page.locator('.ed-rain__tile--lit').first()
      await expect(tile).toBeVisible({ timeout: 12_000 })
      const name = await tile.locator('.ed-rain__tile-name').textContent()
      const card = cardsData.cards.find((candidate) => candidate.name === name)!
      await page.getByRole('button', { name: `${card.elixir} elixir`, exact: true }).click()
      await expect(page.locator('.ed-game__metric')).toHaveText('1')
    } else {
      await waitForKeypad(page)
      const image = page.locator('.pcard__img')
      const name = await image.getAttribute('alt')
      const card = cardsData.cards.find((candidate) => candidate.name === name)!
      const answer = mode === 'survival' ? (card.elixir === 1 ? 2 : 1) : card.elixir
      await page.getByRole('button', { name: `${answer} elixir`, exact: true }).click()
      if (mode === 'practice') await expect(page.locator('.ed-game__progress')).toHaveText('1 answered')
      else if (mode === 'surge') await expect(page.locator('.ed-game__progress')).toHaveText('Card 2 / 15')
      else await expect(page.locator('[data-summary]')).toBeVisible({ timeout: 5_000 })
    }

    expect(runRequests).toBe(0)
  })
}

test('an offline ranked completion stays out of records and progression', async ({ page }) => {
  allowOfflineTransportErrors.add(page)
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, (route) => route.abort('internetdisconnected'))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    localStorage.setItem('elixirdrop:records', JSON.stringify({ surgeBest: 99_999 }))
    localStorage.setItem(
      'elixirdrop:seasonRecords',
      JSON.stringify({ seasonId: 'season-1', records: { surgeBest: 88_888 } })
    )
  })
  let runRequests = 0
  page.on('request', (request) => {
    if (/\/runs\/(?:start|complete)$/.test(new URL(request.url()).pathname)) runRequests += 1
  })

  await page.goto('/#/surge')
  await completeSurge(page)

  await expect(page.locator('.ed-sum__offline')).toContainText('Offline run — not saved')
  await expect(page.locator('.ed-sum__offline')).toContainText('score, badges, XP, history, and leaderboard position')
  await expect(page.locator('.ed-sum__pb')).toHaveCount(0)
  await expect(page.locator('.signin-save')).toHaveCount(0)
  expect(runRequests).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem('elixirdrop:records'))).toBe('{"surgeBest":99999}')
  expect(await page.evaluate(() => localStorage.getItem('elixirdrop:seasonRecords'))).toBe(
    '{"seasonId":"season-1","records":{"surgeBest":88888}}'
  )
})

test('all six game chunks are fetched while online, before they are needed', async ({ page }) => {
  // Lazy route chunks must be in the atomically committed shell before a cold
  // offline launch; visiting Home is enough to warm every mode.
  const requested = new Set<string>()
  page.on('request', (request) => {
    const match = request.url().match(/modes[/\\]([^/\\]+)[/\\]/)
    if (match?.[1]) requested.add(match[1])
  })

  await page.goto('/')
  await expect(page.locator('.ed-gcard').first()).toBeVisible()

  // Without ever navigating to a game.
  await expect.poll(() => offlineModes.every((mode) => requested.has(mode)), { timeout: 10_000 }).toBe(true)
  await expect(page).toHaveURL(/#?\/?$/)
})
