import { cardsData, expect, test, waitForKeypad } from './fixtures'

test('a missed Survival card carries into Practice and survives reload', async ({ page }) => {
  // Leave an unfinished Practice session, as a player using browser Back can.
  await page.goto('/#/practice')
  await waitForKeypad(page)
  const first = await page.locator('.pcard__img').getAttribute('alt')
  const cost = cardsData.cards.find((card) => card.name === first)!.elixir
  await page.getByRole('button', { name: `${cost} elixir`, exact: true }).click()
  await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')
  await page.goto('/#/survival')
  await waitForKeypad(page)
  const name = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === name)!
  await page.getByRole('button', { name: `${card.elixir === 1 ? 2 : 1} elixir`, exact: true }).click()
  await page.getByRole('button', { name: `Practice ${card.name}` }).click()
  await waitForKeypad(page)
  await expect(page).toHaveURL(/#\/practice$/)
  await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')
  await expect(page.locator('.pcard__img')).toHaveAttribute('alt', card.name)
  await page.reload()
  await waitForKeypad(page)
  await expect(page.locator('.pcard__img')).toHaveAttribute('alt', card.name)
})

test('Exact Ten deals a solvable local hand and redeals only on request', { tag: '@deploy' }, async ({ page }) => {
  const runs: string[] = []
  page.on('request', (request) => {
    if (/\/runs\/(start|complete)$/.test(request.url())) runs.push(request.url())
  })
  await page.goto('/?signedOut=1#/')
  await page.getByRole('button', { name: /Exact Ten/ }).click()
  const buttons = page.getByRole('group', { name: 'Your five cards' }).getByRole('button')
  await expect(buttons).toHaveCount(5)
  const labels = await buttons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  const costs = labels.map((label) => cardsData.cards.find((card) => card.name === label)!.elixir)
  const solution = Array.from({ length: 31 }, (_, index) => index + 1).find(
    (mask) => costs.reduce((sum, cost, index) => sum + (mask & (1 << index) ? cost : 0), 0) === 10
  )!
  expect(solution).toBeTruthy()
  await buttons.first().click()
  await page.getByRole('button', { name: 'Check total' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'That adds up to' })).toContainText(String(costs[0]))
  await buttons.first().click()
  for (const index of costs.keys()) if (solution & (1 << index)) await buttons.nth(index).click()
  await page.getByRole('button', { name: 'Check total' }).click()
  await expect(page.getByText(/= 10\. Exactly!/)).toBeVisible()
  await page.getByRole('button', { name: 'Deal again' }).click()
  await expect(page.getByRole('button', { name: 'Check total' })).toBeDisabled()
  expect(runs).toEqual([])
})

test('a signed-in Exact Ten solve records the selected cards once', async ({ page }) => {
  await page.goto('/#/exact-ten')
  const audience = page.getByText(/verified player’s Elixir timeline/)
  await expect(audience).toBeVisible()
  const buttons = page.getByRole('group', { name: 'Your five cards' }).getByRole('button')
  const labels = await buttons.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')))
  const cards = labels.map((name) => cardsData.cards.find((c) => c.name === name)!)
  const mask = Array.from({ length: 31 }, (_, i) => i + 1).find(
    (m) => cards.reduce((n, c, i) => n + (m & (1 << i) ? c.elixir : 0), 0) === 10
  )!
  expect(mask).toBeTruthy()
  const selected = cards.filter((_, i) => mask & (1 << i))
  for (const card of selected) await page.getByRole('button', { name: card.name, exact: true }).click()
  const request = page.waitForRequest((r) => r.url().endsWith('/exact-ten/complete'))
  await page.getByRole('button', { name: 'Check total' }).click()
  expect((await request).postDataJSON()).toEqual({ handToken: 'fixture-hand', selected: selected.map((c) => c.id) })
  await expect(page.getByText('Game saved.')).toBeVisible()
})
