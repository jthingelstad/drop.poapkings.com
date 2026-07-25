import AxeBuilder from '@axe-core/playwright'
import { cardsData, completeSurge, expect, test, waitForKeypad } from './fixtures'

test('surge points higher or lower after a wrong guess and clears on the solve', async ({ page }) => {
  await page.goto('/#/surge')
  await waitForKeypad(page)

  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  const wrongCost = card!.elixir === 1 ? 2 : 1
  const expectedCue = wrongCost < card!.elixir ? 'Higher' : 'Lower'

  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()
  await expect(page.getByTestId('surge-hint')).toContainText(expectedCue)

  // Solving the card clears the cue for the next one.
  const correctButton = page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true })
  await expect(correctButton).toBeEnabled()
  await correctButton.click()
  await expect(page.getByTestId('surge-hint')).toBeEmpty()
})

test('surge summary shows cost accuracy bars', async ({ page }, testInfo) => {
  await page.goto('/#/surge')
  await completeSurge(page)

  const chart = page.locator('.ed-sum-bands')
  await expect(chart).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()

  const barHeights = await chart
    .locator('.ed-sum-band__bar')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  expect(barHeights).toHaveLength(5)
  expect(barHeights.every((height) => height > 0)).toBe(true)

  const fillHeights = await chart
    .locator('.ed-sum-band__fill')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  expect(fillHeights.some((height) => height > 0)).toBe(true)

  await testInfo.attach('surge-summary.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
})

test('completed runs use native browser sharing with game, score, and Elixir Drop link', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload: ShareData) => {
        ;(window as unknown as { __runSharePayload?: ShareData }).__runSharePayload = payload
      }
    })
  })
  await page.goto('/#/surge')
  await completeSurge(page)

  const axe = await new AxeBuilder({ page }).analyze()
  expect(
    axe.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
  ).toEqual([])

  const shareButton = page.getByRole('button', { name: 'Share score' })
  await expect(shareButton).toBeVisible()
  expect(
    await shareButton.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight
    })
  ).toBe(true)
  if (testInfo.project.name === 'iphone-14') {
    await testInfo.attach('share-score-first-viewport.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    })
  }
  await shareButton.click()
  await expect(page.getByRole('button', { name: 'Shared' })).toBeVisible()
  const payload = await page.evaluate(() => (window as unknown as { __runSharePayload?: ShareData }).__runSharePayload)
  expect(payload).toMatchObject({
    title: expect.stringContaining('Surge:'),
    text: expect.stringMatching(/I scored .+ in Surge on Elixir Drop\. Can you beat it\?/),
    url: expect.stringMatching(/#\/surge$/)
  })
})

test('surge runtime cues drive card motion and the optional effects canvas', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium provides the stable WebGL test surface for Pixi effects.')

  await page.goto('/#/surge')
  await waitForKeypad(page)

  const motionCard = page.locator('.game-motion')
  const cardName = await motionCard.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  await expect(page.locator('.game-fx-layer canvas')).toHaveCount(1)

  const wrongCost = card!.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()
  // The miss has landed once the higher/lower cue carries text; the shake is
  // driven off the same runtime cue, so poll the transform rather than sleeping.
  await expect(page.getByTestId('surge-hint')).not.toBeEmpty()
  await expect.poll(() => motionCard.evaluate((element) => getComputedStyle(element).transform)).not.toBe('none')
  await testInfo.attach('surge-wrong-shake.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })

  const correctButton = page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true })
  await expect(correctButton).toBeEnabled()
  await correctButton.click()
  await expect.poll(() => motionCard.locator('.pcard__img').getAttribute('alt')).not.toBe(cardName)
  await expect(motionCard).toBeVisible()
  await testInfo.attach('surge-correct-transition.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
})

test('surge keeps gameplay still and skips optional effects when reduced motion is enabled', async ({ page }) => {
  await page.goto('/#/settings')
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await page.goto('/#/surge')
  await waitForKeypad(page)

  const motionCard = page.locator('.game-motion')
  const cardName = await motionCard.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  await expect(page.locator('.game-fx-layer canvas')).toHaveCount(0)

  const wrongCost = card!.elixir === 1 ? 2 : 1
  await page.getByRole('button', { name: `${wrongCost} elixir`, exact: true }).click()
  // Same anchor as the motion test: once the cue carries text the wrong-answer
  // runtime cue has been handled, so a still card proves reduced motion won.
  await expect(page.getByTestId('surge-hint')).not.toBeEmpty()
  expect(await motionCard.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
  await expect(motionCard).toBeVisible()
})
