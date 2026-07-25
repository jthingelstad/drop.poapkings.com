import { cardsData, expect, test } from './fixtures'

test('higher/lower: tap the higher card; a miss resets the streak', async ({ page }) => {
  await page.goto('/#/higher-lower')
  await expect(page.locator('.ed-duel')).toBeVisible()
  // Low chrome + effects present, like the other running modes.
  await expect(page.locator('.game-motion')).toBeVisible()
  await expect(page.locator('.game-fx-layer')).toHaveCount(1)
  await expect(page.locator('.site-foot')).toHaveCount(0)

  // Wait for play to begin (the streak metric renders once the countdown ends).
  await expect(page.locator('.ed-game__metric').first()).toBeVisible({ timeout: 12_000 })

  // Index (0 = left, 1 = right) of the higher-cost card, read from the two
  // rendered card names.
  const higherIndex = async () => {
    const names = await page
      .locator('.ed-duel__card .pcard__img')
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt')))
    const costs = names.map((name) => cardsData.cards.find((card) => card.name === name)?.elixir ?? 0)
    return costs[0]! > costs[1]! ? 0 : 1
  }

  // Tap the higher card → correct, streak advances to 1.
  await page
    .locator('.ed-duel__card')
    .nth(await higherIndex())
    .click()
  await expect(page.locator('.ed-duel__card--correct')).toBeVisible()
  await expect(page.locator('.ed-game__metric').first()).toHaveText('1')

  // Next round: the reveal holds for the advance delay before a fresh pair is
  // dealt. Wait for that deal — reveal classes cleared and the cards tappable
  // again — rather than sleeping through the delay.
  await expect(page.locator('.ed-duel__card--correct')).toHaveCount(0)
  await expect(page.locator('.ed-duel__card').first()).toBeEnabled()

  // Tap the lower card → miss, streak resets to 0.
  const lower = (await higherIndex()) === 0 ? 1 : 0
  await page.locator('.ed-duel__card').nth(lower).click()
  await expect(page.locator('.ed-duel__card--wrong')).toBeVisible()
  await expect(page.locator('.ed-game__metric').first()).toHaveText('0')
})

test('higher/lower stacks both choices vertically on every shell', async ({ page }) => {
  await page.goto('/#/higher-lower')
  const choices = page.locator('.ed-duel__card')
  await expect(choices).toHaveCount(2)
  await expect(choices.first()).toBeVisible()

  const bounds = await choices.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left }
    })
  )
  expect(bounds[1]!.top).toBeGreaterThan(bounds[0]!.bottom)
  expect(Math.abs(bounds[1]!.left - bounds[0]!.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(bounds[1]!.right - bounds[0]!.right)).toBeLessThanOrEqual(1)
})

test('higher/lower: running out the clock ends the round', async ({ page }) => {
  await page.goto('/#/higher-lower')
  await expect(page.locator('.ed-duel')).toBeVisible()
  // Never tap — the opening window (after the 3-2-1) runs out and the timeout
  // reveals the round (the lower card, auto-picked on timeout, is flagged wrong).
  await expect(page.locator('.ed-duel__card--wrong')).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.ed-duel__card--correct')).toBeVisible()
  await expect(page.locator('[data-summary]')).toBeVisible()
  await expect(page.locator('.ed-duel')).toHaveCount(0)
  const costBadge = page.locator('.ed-sum-chip__cost').first()
  await expect(costBadge).toBeVisible()
  expect(
    await costBadge.evaluate((element) => {
      const badge = element.getBoundingClientRect()
      const chip = element.closest('.ed-sum-chip')?.getBoundingClientRect()
      return (
        !!chip &&
        badge.left >= chip.left &&
        badge.top >= chip.top &&
        badge.right <= chip.right &&
        badge.bottom <= chip.bottom
      )
    })
  ).toBe(true)
  const share = page.getByRole('button', { name: 'Share score' })
  await expect(share).toBeVisible()
  expect(
    await share.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight
    })
  ).toBe(true)
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()
})

test('higher/lower records once, then waits for an explicit replay while idle', async ({ page }) => {
  // Fake timers so the idle window can pass in virtual time. Installed before
  // the first navigation and left ticking, so the countdown and the round clock
  // still run at real speed while the round is played.
  await page.clock.install()

  let startRequests = 0
  let completionRequests = 0
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === '/runs/start') startRequests += 1
    if (path === '/runs/complete') completionRequests += 1
  })

  await page.goto('/#/higher-lower')
  const cards = page.locator('.ed-duel__card')
  await expect(cards.first()).toBeEnabled({ timeout: 12_000 })

  const names = await cards.locator('.pcard__img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt')))
  const costs = names.map((name) => cardsData.cards.find((card) => card.name === name)?.elixir ?? 0)
  const lowerIndex = costs[0]! < costs[1]! ? 0 : 1
  await cards.nth(lowerIndex).click()

  const replay = page.getByRole('button', { name: 'Play again' })
  await expect(replay).toBeVisible({ timeout: 8_000 })
  await expect.poll(() => completionRequests).toBe(1)
  expect(startRequests).toBe(1)

  // The old behavior prepared and timed out another signed run every ~6s.
  // Staying idle must leave both network counts unchanged — fast-forward ten
  // virtual seconds so every timer that was due in that window fires now.
  await page.clock.runFor(10_000)
  // Round-trip the page so anything those timers kicked off has reached the
  // request listener before the counts are read.
  await expect(replay).toBeVisible()
  expect(completionRequests).toBe(1)
  expect(startRequests).toBe(1)

  await replay.click()
  await expect.poll(() => startRequests).toBe(2)
  await expect(replay).toHaveCount(0)
  await expect(cards.first()).toBeEnabled({ timeout: 12_000 })
})
