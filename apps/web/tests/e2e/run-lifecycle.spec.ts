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

test('a server failure while preparing a signed run falls back to local play', { tag: '@deploy' }, async ({ page }) => {
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

test(
  'a transient completion failure replays automatically without asking the player to retry',
  { tag: '@deploy' },
  async ({ page }) => {
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

    await expect(page.getByText('Game recorded', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry recording' })).toHaveCount(0)
    expect(completionAttempts).toBe(2)
  }
)

test(
  'a completion failure that reaches Retry recording reports itself and still saves on retry',
  { tag: '@deploy' },
  async ({ page }) => {
    allowExpectedApiErrors.add(page)
    let completionAttempts = 0
    const reportBodies: Array<Record<string, unknown>> = []
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
        completionAttempts += 1
        if (completionAttempts <= 2) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'Try again.' } })
          })
          return
        }
      }
      if (path === '/run-reports') {
        reportBodies.push(route.request().postDataJSON() as Record<string, unknown>)
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            accepted: true,
            reportId: 'report-retryable',
            runReference: '#DRETRY',
            contextSaved: false
          })
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
    await expect.poll(() => reportBodies.length).toBe(1)
    expect(reportBodies[0]).toMatchObject({
      runId: expect.any(String),
      failure: { code: 'temporarily_unavailable', status: 503 },
      client: { buildId: expect.any(String), online: true, visibility: 'visible', displayMode: 'browser' }
    })

    await page.getByRole('button', { name: 'Retry recording' }).click()
    await expect(page.getByText('Game recorded', { exact: true })).toBeVisible()
    expect(completionAttempts).toBe(3)
    expect(reportBodies).toHaveLength(1)
  }
)

test(
  'a permanently rejected game reports itself and accepts optional context',
  { tag: '@deploy' },
  async ({ page }) => {
    allowExpectedApiErrors.add(page)
    const reportBodies: Array<Record<string, unknown>> = []
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
      if (path === '/run-reports') {
        const report = route.request().postDataJSON() as Record<string, unknown>
        reportBodies.push(report)
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            accepted: true,
            reportId: 'report-1',
            runReference: '#DTEST',
            contextSaved: typeof report.context === 'string'
          })
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
    await expect(page.getByText('Error report sent automatically.')).toBeVisible()
    expect(reportBodies).toHaveLength(1)
    expect(reportBodies[0]).toMatchObject({
      runId: expect.any(String),
      failure: { code: 'invalid_request', status: 400 },
      client: { buildId: expect.any(String), online: true, visibility: 'visible', displayMode: 'browser' }
    })
    await expect(page.getByRole('button', { name: 'Retry recording' })).toHaveCount(0)
    await page.getByLabel('What happened? (optional)').fill('The final card would not submit.')
    await page.getByRole('button', { name: 'Add context' }).click()
    await expect(page.getByText('Error report and context sent. Thank you.')).toBeVisible()
    expect(reportBodies).toHaveLength(2)
    expect(reportBodies[1]).toMatchObject({ context: 'The final card would not submit.' })
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByText('This game could not be verified and was not recorded.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()
  }
)
