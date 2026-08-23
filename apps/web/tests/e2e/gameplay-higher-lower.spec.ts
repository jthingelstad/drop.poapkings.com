import type { Page } from '@playwright/test'
import { cardsData, expect, test } from './fixtures'

// Higher/Lower drives a real response clock (5s on the opening pair, then the
// same continuously tightening hyperbolic curve as Survival). Racing that clock
// from the test runner is what made this file flake under full parallel load:
// the page can lose several hundred ms to a busy machine between "read the two
// card names" and "click one".
//
// So every gameplay test here installs Playwright's clock and then PAUSES it, in
// the same shape the surge idle test uses. The page loads with time flowing
// normally (the 3-2-1 countdown needs its timers), and from the moment the board
// is live the round clock only advances when the test says so. `fastForward`
// jumps to due timers without replaying every animation frame along the way,
// which keeps WebKit's clock deterministic on slower CI runners.
const CLOCK_START = new Date('2026-07-25T12:00:00.000Z')
// The reveal beats the mode holds before dealing the next pair: 750ms after a
// correct read, 1400ms after a miss. Both are far inside every round's window,
// so stepping them can never expire the clock by accident.
const AFTER_CORRECT_MS = 900
const AFTER_MISS_MS = 1_600

// Load the mode with the clock installed, wait for the board, then freeze time
// where the page currently is — a fixed pause target would jump the round clock
// forward by however long the countdown and the signed-run fetch happened to
// take, which is the very variance this file is removing.
async function openFrozenBoard(page: Page) {
  await page.clock.install({ time: CLOCK_START })
  await page.goto('/#/higher-lower')
  await expect(page.locator('.ed-duel')).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.ed-duel__card').first()).toBeEnabled({ timeout: 12_000 })
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 200))
}

// Index (0 = top, 1 = bottom) of the higher-cost card in the live pair, read
// from the two rendered card names.
async function higherIndex(page: Page): Promise<number> {
  const names = await page
    .locator('.ed-duel__card .pcard__img')
    .evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt')))
  const costs = names.map((name) => cardsData.cards.find((card) => card.name === name)?.elixir ?? 0)
  return costs[0]! > costs[1]! ? 0 : 1
}

const livesRow = (page: Page) => page.locator('[data-testid="higher-lower-lives"]')

// Run the current round's window out in virtual steps and stop the moment the
// timeout lands. Stepping (rather than one big jump) keeps the assertion clear
// of the 1400ms reveal beat that follows a miss, without the test needing to
// know exactly which virtual millisecond the round clock was armed at.
async function runOutTheClock(page: Page) {
  for (let step = 0; step < 12; step += 1) {
    await page.clock.fastForward(1_000)
    // A timeout announces itself in the prompt, NOT with a wrong-card
    // highlight: the player never tapped, so no card is blamed. This used to
    // watch for `.ed-duel__card--wrong`, which existed only because the client
    // synthesized a pick on the player's behalf when the clock ran out.
    if (await page.getByTestId('higher-lower-prompt').getByText("Time's up").count()) return
  }
  throw new Error('the Higher/Lower response window never expired')
}

// Tap the card the player should NOT pick.
async function tapLower(page: Page) {
  const lower = (await higherIndex(page)) === 0 ? 1 : 0
  await page.locator('.ed-duel__card').nth(lower).click()
}

test('higher/lower: a miss costs a life and the run keeps counting', { tag: '@deploy' }, async ({ page }) => {
  await openFrozenBoard(page)
  // Low chrome + effects present, like the other running modes.
  await expect(page.locator('.game-motion')).toBeVisible()
  await expect(page.locator('.game-fx-layer')).toHaveCount(1)
  await expect(page.locator('.site-foot')).toHaveCount(0)
  await expect(page.locator('.ed-game__metric').first()).toHaveText('0')
  await expect(livesRow(page)).toHaveAttribute('aria-label', '3 of 3 lives left')

  // Tap the higher card → correct, the score goes to 1.
  await page
    .locator('.ed-duel__card')
    .nth(await higherIndex(page))
    .click()
  await expect(page.locator('.ed-duel__card--correct')).toBeVisible()
  await expect(page.locator('.ed-game__metric').first()).toHaveText('1')
  await expect(livesRow(page)).toHaveAttribute('aria-label', '3 of 3 lives left')

  // Step past the reveal beat: the next pair is dealt and the cards go live.
  await page.clock.fastForward(AFTER_CORRECT_MS)
  await expect(page.locator('.ed-duel__card--correct')).toHaveCount(0)
  await expect(page.locator('.ed-duel__card').first()).toBeEnabled()

  // Tap the lower card → a miss. It reveals the answer and costs ONE LIFE; the
  // score keeps its total and the run continues.
  await tapLower(page)
  await expect(page.locator('.ed-duel__card--wrong')).toBeVisible()
  await expect(page.locator('.ed-duel__card--correct')).toBeVisible()
  await expect(page.locator('.ed-game__metric').first()).toHaveText('1')
  await expect(livesRow(page)).toHaveAttribute('aria-label', '2 of 3 lives left')

  // Still playing — no summary — and a later correct read still adds up.
  await page.clock.fastForward(AFTER_MISS_MS)
  await expect(page.locator('[data-summary]')).toHaveCount(0)
  await expect(page.locator('.ed-duel__card').first()).toBeEnabled()
  await page
    .locator('.ed-duel__card')
    .nth(await higherIndex(page))
    .click()
  await expect(page.locator('.ed-game__metric').first()).toHaveText('2')
})

test('higher/lower stacks both choices vertically on every shell', async ({ page, isMobile }) => {
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

  if (isMobile) {
    const rendered = await choices.evaluateAll((elements) => ({
      viewportWidth: window.innerWidth,
      choices: elements.map((element) => {
        const card = element.getBoundingClientRect()
        const image = element.querySelector('.pcard__img')?.getBoundingClientRect()
        return { cardWidth: card.width, imageWidth: image?.width ?? 0, imageHeight: image?.height ?? 0 }
      })
    }))
    expect(rendered.choices.every((choice) => choice.cardWidth >= rendered.viewportWidth * 0.75)).toBe(true)
    expect(rendered.choices.every((choice) => choice.imageWidth > 0 && choice.imageHeight > 0)).toBe(true)
  }
})

test('higher/lower: a timeout costs a life, and the last life ends the run', async ({ page }) => {
  await openFrozenBoard(page)

  // Never tap on the opening pair: the window is run out in virtual time, so
  // the test does not sit through a real 5s clock.
  await runOutTheClock(page)
  // A timeout reveals the answer and costs a life, exactly like a wrong tap —
  // and the run carries on.
  await expect(page.locator('.ed-duel__card--correct')).toBeVisible()
  await expect(livesRow(page)).toHaveAttribute('aria-label', '2 of 3 lives left')
  await expect(page.locator('[data-summary]')).toHaveCount(0)
  await page.clock.fastForward(AFTER_MISS_MS)
  await expect(page.locator('.ed-duel__card').first()).toBeEnabled()

  // Spend the last two lives by tapping the wrong card; zero lives ends it.
  await tapLower(page)
  await expect(livesRow(page)).toHaveAttribute('aria-label', '1 of 3 lives left')
  await page.clock.fastForward(AFTER_MISS_MS)
  // Wait for the replacement pair before deriving its lower-card index. On a
  // busy WebKit worker the old pair can still be present here; letting click()
  // do the waiting would apply an index computed from that old pair to the new
  // one, which can turn the intended miss into a correct answer.
  await expect(page.locator('.ed-duel__card--correct')).toHaveCount(0)
  await expect(page.locator('.ed-duel__card').first()).toBeEnabled()
  await tapLower(page)
  await expect(livesRow(page)).toHaveAttribute('aria-label', '0 of 3 lives left')

  await page.clock.fastForward(AFTER_MISS_MS)
  await expect(page.locator('[data-summary]')).toBeVisible()
  await expect(page.locator('.ed-duel')).toHaveCount(0)

  // The summary chips keep their cost badge inside the chip, and the actions
  // stay on screen (the layout guard this test has always carried).
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
  // The run recorded, so it has a permalink to point at and the control is
  // offered. A not-recorded run has none at all — see the offline spec.
  const share = page.getByRole('button', { name: 'SHARE', exact: true })
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
  let startRequests = 0
  let completionRequests = 0
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === '/runs/start') startRequests += 1
    if (path === '/runs/complete') completionRequests += 1
  })

  await openFrozenBoard(page)

  // Spend all three lives on the lower card.
  for (let miss = 0; miss < 3; miss += 1) {
    await tapLower(page)
    await expect(page.locator('.ed-duel__card--wrong')).toBeVisible()
    await page.clock.fastForward(AFTER_MISS_MS)
    if (miss < 2) {
      await expect(page.locator('.ed-duel__card--wrong')).toHaveCount(0)
      await expect(page.locator('.ed-duel__card').first()).toBeEnabled()
    }
  }

  const replay = page.getByRole('button', { name: 'Play again' })
  await expect(replay).toBeVisible()
  await expect.poll(() => completionRequests).toBe(1)
  expect(startRequests).toBe(1)

  // The old behavior prepared and timed out another signed run every ~6s.
  // Staying idle must leave both network counts unchanged — fast-forward ten
  // virtual seconds so every timer that was due in that window fires now.
  await page.clock.fastForward(10_000)
  // Round-trip the page so anything those timers kicked off has reached the
  // request listener before the counts are read.
  await expect(replay).toBeVisible()
  expect(completionRequests).toBe(1)
  expect(startRequests).toBe(1)

  await replay.click()
  await expect.poll(() => startRequests).toBe(2)
  await expect(replay).toHaveCount(0)
  // Let time flow again so the replay's 3-2-1 can actually run.
  await page.clock.resume()
  await expect(page.locator('.ed-duel__card').first()).toBeEnabled({ timeout: 12_000 })
})
