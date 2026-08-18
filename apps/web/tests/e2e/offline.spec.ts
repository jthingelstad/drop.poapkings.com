import {
  allowOfflineTransportErrors,
  cardsById,
  cardsData,
  completeSurge,
  expect,
  test,
  testApiRoute,
  waitForKeypad
} from './fixtures'

// Transport events remain one input to offline mode. Other tests below sever
// only the API while navigator.onLine stays true, matching restricted airplane
// Wi-Fi and captive portals that still claim to have connectivity.
async function setOnline(page: import('@playwright/test').Page, online: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value })
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  }, online)
}

test('offline shows a persistent mark and keeps games playable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
  await expect(page.locator('.ed-cause')).toHaveCount(0)

  await setOnline(page, false)

  // A persistent state gets a persistent mark, never a standing banner. On the
  // single-column home (letterboxed on desktop) that mark is the OFFLINE cause
  // chip plus the readiness line; every game stays playable offline.
  await expect(page.locator('.ed-cause')).toContainText('OFFLINE')
  await expect(page.locator('.ed-home__ready')).toContainText('You are offline but ready to play')
  const rows = page.locator('.ed-grow--ranked')
  await expect(rows).toHaveCount(4)
  for (const row of await rows.all()) await expect(row).toBeEnabled()
  await expect(page.locator('.ed-offline')).toHaveCount(0)

  await setOnline(page, true)
  await expect(page.locator('.ed-cause')).toHaveCount(0)
})

test('a signed-out desktop visitor still gets the offline mark', async ({ page, isMobile }) => {
  test.skip(isMobile, 'this exercises the desktop letterbox')
  await page.addInitScript(() => localStorage.removeItem('elixirdrop:session:v1'))
  await page.goto('/?signedOut=1')
  // The player/guest chip moved off the shell to the You page; the desktop
  // letterbox home carries the same OFFLINE cause chip as mobile.
  await expect(page.locator('.ed-hero').first()).toBeVisible()

  await setOnline(page, false)

  await expect(page.locator('.ed-cause')).toContainText('OFFLINE')
})

test('offline keeps the same nav and names the cause on the page it stays on', async ({ page, isMobile }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()

  // The shell is warm; now remove the API entirely. The nav must NOT rename
  // itself, and the live pages must stay put rather than a route takeover.
  allowOfflineTransportErrors.add(page)
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, (route) => route.abort('internetdisconnected'))
  await setOnline(page, false)

  const primaryNav = page.getByRole('navigation', { name: 'Primary' })
  // Play · Ladder · You, offline or online — the tabs never swap to "Offline".
  await expect(primaryNav).toContainText('Ladder')
  await expect(primaryNav).toContainText('You')
  await expect(primaryNav).not.toContainText('Offline mode')

  // The Ladder stays live and names its cause; there is no OfflinePage takeover.
  await page.goto('/#/leaderboards')
  await expect(page.locator('.ed-ladder')).toBeVisible()
  await expect(page.locator('.ed-cause')).toContainText('OFFLINE')
  await expect(page.getByRole('heading', { name: 'Offline mode is ready' })).toHaveCount(0)
  // Absent server data goes quiet rather than erroring: the Boards scope explains
  // it needs a connection, and the arena bar reads "Last known".
  await expect(page.getByText('Boards need a connection')).toBeVisible()
  await expect(page.locator('.ed-ladder__arena--stale')).toContainText('Last known')

  if (!isMobile) {
    await expect(page.locator('.ed-rail-standings')).toHaveText('Offline — reconnect for standings.')
  }

  // Reconnecting clears the cause chip; the same nav was there throughout.
  await setOnline(page, true)
  await expect(page.locator('.ed-cause')).toHaveCount(0)
  await expect(primaryNav).toContainText('Ladder')
})

test('an API-only outage allows local play while navigator remains online', { tag: '@deploy' }, async ({ page }) => {
  const accountReady = page.waitForResponse(
    (response) => response.request().method() === 'GET' && new URL(response.url()).pathname === '/me'
  )
  await page.goto('/')
  await expect(page.locator('.ed-hero').first()).toBeVisible()
  await accountReady

  allowOfflineTransportErrors.add(page)
  await page.unroute(testApiRoute)
  let apiRequests = 0
  let startRequests = 0
  await page.route(testApiRoute, (route) => {
    apiRequests += 1
    if (new URL(route.request().url()).pathname === '/runs/start') startRequests += 1
    return route.abort('internetdisconnected')
  })

  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  await page.evaluate(() => {
    window.location.hash = '#/surge'
  })

  await expect(page.locator('.ed-game__offline')).toContainText('Offline · not saved', { timeout: 12_000 })
  await expect(page.locator('.pip-keypad')).toBeVisible()
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  expect(apiRequests).toBeGreaterThan(0)
  // A still-pending Home read may establish the outage before navigation;
  // otherwise /runs/start establishes it. Either way no second start is sent.
  expect(startRequests).toBeLessThanOrEqual(1)
})

test('Practice is actually playable with player services unreachable', { tag: '@deploy' }, async ({ page }) => {
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

  await page.goto('/#/practice/costs')

  // Not the reconnect gate.
  await expect(page.locator('.account-screen')).toHaveCount(0)
  // A real dealt hand, from the bundled catalog.
  await expect(page.locator('.ed-game')).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.pip-keypad')).toBeVisible()
  await expect(page.locator('.ed-game__progress')).toHaveText('0 practiced')

  // And the complete learning beat plays with no server involved: answer from
  // the bundled card data, hold the solved value, then advance locally.
  const name = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === name)
  expect(card).toBeTruthy()
  await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
  await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')
  await expect(page.locator('.pcard__answer-cost')).toHaveText(String(card!.elixir))
  await page.waitForTimeout(250)
  await expect(page.locator('.pcard__answer-cost')).toBeVisible()
  await expect(page.locator('.pcard__img')).not.toHaveAttribute('alt', card!.name)
})

test(
  'Ledger remains local, playable, and unsaved with player services unreachable',
  { tag: '@deploy' },
  async ({ page }) => {
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

    await page.goto('/#/practice/ledger')
    await expect(page.locator('.ed-game__offline')).toContainText('Offline · not saved', { timeout: 12_000 })
    await expect(page.locator('.ed-xpad__key:not(:disabled)').first()).toBeVisible({ timeout: 12_000 })

    const balance = await page.locator('.ed-xboard').evaluate(
      (board, catalog) => {
        const costs = new Map(
          (catalog as Array<{ id: number; elixir: number }>).map((card) => [String(card.id), card.elixir])
        )
        const total = (selector: string) =>
          [...board.querySelectorAll<HTMLElement>(selector)].reduce(
            (sum, card) => sum + (costs.get(card.dataset.cardId ?? '') ?? 0),
            0
          )
        return total('.ed-xlane--red .ed-xcard') - total('.ed-xlane--blue .ed-xcard')
      },
      [...cardsById.values()].map(({ id, elixir }) => ({ id, elixir }))
    )
    const answer = balance > 0 ? `Blue ahead by ${balance}` : balance < 0 ? `Red ahead by ${Math.abs(balance)}` : 'Even'
    await page.getByRole('button', { name: answer, exact: true }).click()
    await expect(page.locator('.ed-game__progress')).toContainText('1 checked')
    await page.getByRole('button', { name: 'End session' }).click()

    await expect(page.locator('.ed-sum__state')).toContainText('board never saw it')
    expect(runRequests).toBe(0)
  }
)

const offlineModes = ['surge', 'practice', 'higher-lower', 'trade', 'survival', 'rain'] as const

for (const mode of offlineModes) {
  test(`${mode} starts and responds with player services disconnected`, { tag: '@deploy' }, async ({ page }) => {
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

    await page.goto(mode === 'practice' ? '/#/practice/costs' : `/#/${mode}`)
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
      const teams = page.locator('.ed-xboard')
      await expect(teams).toBeVisible({ timeout: 12_000 })
      const ids = async (side: string) =>
        page
          .locator(`.ed-xlane--${side} [data-card-id]`)
          .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
      const total = (values: number[]) => values.reduce((sum, id) => sum + cardsById.get(id)!.elixir, 0)
      const answer = total(await ids('red')) - total(await ids('blue'))
      const label = answer > 0 ? `Blue ahead by ${answer}` : answer < 0 ? `Red ahead by ${Math.abs(answer)}` : 'Even'
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect(page.locator('.ed-trade__board')).toHaveAttribute('data-trade-index', '2')
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
      if (mode === 'practice') await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')
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

  await expect(page.locator('.ed-sum__state')).toContainText('The board never saw it, so nothing moved')
  // Offline suppresses the "what changed" ledger (no PB, no rungs) entirely.
  await expect(page.locator('.ed-sum__changed')).toHaveCount(0)
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
  await expect(page.locator('.ed-hero').first()).toBeVisible()

  // Without ever navigating to a game.
  await expect.poll(() => offlineModes.every((mode) => requested.has(mode)), { timeout: 10_000 }).toBe(true)
  await expect(page).toHaveURL(/#?\/?$/)
})
