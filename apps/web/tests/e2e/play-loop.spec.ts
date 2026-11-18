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
  await page.getByRole('link', { name: 'Exact Ten puzzle' }).click()
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
