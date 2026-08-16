import {
  allowExpectedApiErrors,
  cardsData,
  expect,
  fulfillSupportData,
  fulfillTestRun,
  test,
  testApiRoute,
  testPlayer,
  testSession,
  waitForKeypad
} from './fixtures'

test('a server failure while preparing a signed run falls back to local play', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  let attempts = 0
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/runs/start' && attempts++ === 0) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'temporarily_unavailable', message: 'Player services are reconnecting.' }
        })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/surge')
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  await expect(page.getByRole('heading', { name: 'This game could not start' })).toHaveCount(0)
  await expect(page.locator('.ed-game__offline')).toContainText('Offline · not saved', { timeout: 12_000 })
  await waitForKeypad(page)
  expect(attempts).toBe(1)
})

test('a malformed signed challenge is rejected without local gameplay fallback', async ({ page }) => {
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/runs/start') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          runId: 'bad-run',
          runToken: 'bad-run',
          mode: 'surge',
          challenge: { mode: 'surge', cardIds: [26000000] },
          expiresAt: '2099-01-01T00:00:00.000Z'
        })
      })
      return
    }
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/surge')
  await expect(page.getByText('Drop received an invalid Surge challenge.')).toBeVisible()
  await expect(page.locator('.pip-keypad')).toHaveCount(0)
})

test('a failed completion blocks replay until the recorded run retry succeeds', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  let completionAttempts = 0
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/runs/complete' && completionAttempts++ === 0) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Try again.' } })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/survival')
  await waitForKeypad(page)
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  const wrongCost = card?.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()

  await expect(page.getByRole('button', { name: 'Retry recording' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry recording' }).click()
  await expect(page.getByText('Game recorded', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry recording' })).toHaveCount(0)
  expect(completionAttempts).toBe(2)
})

test('a permanently rejected game does not offer a retry that cannot work', async ({ page }) => {
  allowExpectedApiErrors.add(page)
  await page.unroute(testApiRoute)
  await page.route(testApiRoute, async (route) => {
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
        body: JSON.stringify({ player: testPlayer, recentRuns: [] })
      })
      return
    }
    if (path === '/runs/complete') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'invalid_request', message: 'Card order is invalid.' } })
      })
      return
    }
    if (await fulfillTestRun(route)) return
    if (await fulfillSupportData(route)) return
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/#/survival')
  await waitForKeypad(page)
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  const wrongCost = card?.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()

  await expect(page.getByText('This game could not be verified and was not recorded.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry recording' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('This game could not be verified and was not recorded.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()
})
