import type { Page } from '@playwright/test'
import {
  allowBlockedAssets,
  cardsData,
  expect,
  test,
  testApiBaseUrl,
  useSignedOutState,
  waitForKeypad
} from './fixtures'

test('Practice opens directly as the single training mode', async ({ page }) => {
  await page.goto('/#/practice')
  await expect(page.locator('.ed-game__mode')).toHaveText('Practice', { timeout: 12_000 })
  await expect(page.locator('.pip-keypad')).toBeVisible()
})

test('Practice finishes a guest session without claiming to score it', async ({ page }) => {
  let releaseCompletion: (() => void) | undefined
  const completionHeld = new Promise<void>((resolve) => {
    releaseCompletion = resolve
  })
  await page.route(`${testApiBaseUrl}/runs/complete`, async (route) => {
    await completionHeld
    await route.fallback()
  })

  await useSignedOutState(page, '/practice')
  await waitForKeypad(page)
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
  await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')
  await page.getByRole('button', { name: 'End session' }).click()

  try {
    const notice = page.locator('.run-recording')
    await expect(notice).toContainText('Finishing your session…')
    await expect(notice).not.toContainText(/scor/i)
    await expect(page.locator('[data-summary]')).toBeVisible()
  } finally {
    releaseCompletion?.()
  }

  await expect(page.getByText('Practice session complete', { exact: true })).toBeVisible()
})

test('Home offers RESUME and restores a Practice draft after route loss', { tag: '@deploy' }, async ({ page }) => {
  await useSignedOutState(page, '/practice')
  await waitForKeypad(page)
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
  await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')

  // Keep the fixture's signed-out identity stable across the full reload so the
  // guest draft is not intentionally rejected as belonging to another player.
  await page.goto('/?signedOut=1#/')
  const practice = page.locator('section[aria-labelledby="home-practice-title"]')
  await expect(practice.locator('.ed-grow__play')).toHaveText('RESUME')
  await practice.getByRole('button', { name: /Practice/ }).click()
  await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced', { timeout: 12_000 })

  await page.getByRole('button', { name: 'End session' }).click()
  await expect(page.getByText('Practice session complete', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await expect(practice.locator('.ed-grow__play')).toHaveText('PLAY')
})

test('continuous play modes expose working controls with low chrome', async ({ page }, testInfo) => {
  // Higher/Lower has its own tap-the-card coverage in gameplay-higher-lower.spec.ts.
  const modes = [{ hash: '#/practice', control: '.pip-keypad', answer: '4 elixir' }]

  for (const mode of modes) {
    await page.goto('/')
    await page.goto(`/${mode.hash}`)

    await expect(page.locator('.ed-game')).toBeVisible({ timeout: 12_000 })
    await expect(page.locator(mode.control)).toBeVisible()
    await expect(page.locator('.game-motion')).toBeVisible()
    await expect(page.locator('.game-fx-layer')).toHaveCount(1)
    if (testInfo.project.name === 'chromium') {
      await expect(page.locator('.game-fx-layer canvas')).toHaveCount(1)
    }
    await expect(page.locator('.site-foot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: mode.answer, exact: true })).toBeEnabled()

    await testInfo.attach(`${mode.hash.slice(2)}-running.png`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    })
    await page.getByRole('button', { name: mode.answer, exact: true }).click()
  }
})

// Practice deals weighted-random from the whole catalog, so the card on the
// table is not fixed. Open the mode until it shows one with a cost that has both
// a lower and a higher neighbour, so the directional hint can be driven both
// ways. 114 of the 120 cards qualify, so this lands on the first or second try.
async function openPracticeOnMidCostCard(page: Page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto('/#/practice')
    await waitForKeypad(page)
    const name = await page.locator('.pcard__img').getAttribute('alt')
    const card = cardsData.cards.find((candidate) => candidate.name === name)
    if (card && card.elixir > 1 && card.elixir < 9) return card
    await page.goto('/')
  }
  throw new Error('Practice never dealt a mid-cost card')
}

test(
  'practice scaffolds one recall retry, then teaches the exact answer',
  { tag: '@deploy' },
  async ({ page }, testInfo) => {
    const card = await openPracticeOnMidCostCard(page)

    const motion = page.locator('.game-motion')
    await expect(motion).toHaveClass(/game-motion--card/)
    // Endless: the progress line counts practice reads, not progress to a finish.
    await expect(page.locator('.ed-game__progress')).toHaveText('0 practiced')
    await expect(page.locator('.ed-game__bar')).toHaveCount(0)

    await page.getByRole('button', { name: `${card.elixir - 1} elixir`, exact: true }).click()
    const directionalHint = page.getByTestId('practice-hint')
    await expect(directionalHint).toContainText(`Higher than ${card.elixir - 1}`)
    const { cardBounds, hintBounds, hintFontSize } = await page.evaluate(() => {
      const displayedCard = document.querySelector('.pcard')
      const displayedHint = document.querySelector('[data-testid="practice-hint"]')
      if (!(displayedCard instanceof HTMLElement) || !(displayedHint instanceof HTMLElement)) {
        throw new Error('Practice card or directional hint was not rendered')
      }
      const bounds = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      return {
        cardBounds: bounds(displayedCard),
        hintBounds: bounds(displayedHint),
        hintFontSize: Number.parseFloat(getComputedStyle(displayedHint).fontSize)
      }
    })
    expect(Math.abs(hintBounds.y + hintBounds.height / 2 - (cardBounds.y + cardBounds.height))).toBeLessThan(56)
    expect(hintFontSize).toBeGreaterThanOrEqual(16)
    await page.waitForTimeout(700)
    await expect(directionalHint).toHaveCSS('opacity', '1')
    await testInfo.attach('practice-directional-hint.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    })
    await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')
    await expect(page.locator('.pcard__cost')).toHaveCount(0)
    await expect(page.locator('.pcard__img')).toHaveAttribute('alt', card.name)

    await expect(page.getByRole('button', { name: `${card.elixir + 1} elixir`, exact: true })).toBeEnabled()
    await page.getByRole('button', { name: `${card.elixir + 1} elixir`, exact: true }).click()
    await expect(page.locator('.pcard__img')).toHaveAttribute('alt', card.name)

    const answer = page.locator('.pcard__answer-cost')
    await expect(answer).toHaveText(String(card.elixir))
    await page.waitForTimeout(1_200)
    await expect(answer).toHaveText(String(card.elixir))

    await testInfo.attach('practice-wrong-feedback.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    })

    // A fresh card is dealt only after the teaching hold and attached exit.
    await expect(page.locator('.pcard__img')).not.toHaveAttribute('alt', card.name)
    await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')

    await page.getByRole('button', { name: 'End session' }).click()
    await expect(page.locator('[data-practice-stat="recall"]')).toContainText('0 / 1')
    await expect(page.locator('[data-practice-stat="due"]')).toContainText('1')
    await expect(page.getByRole('button', { name: /Review misses/ })).toBeVisible()
    await expect(page.getByText(/Practice session (saved|complete)/, { exact: true })).toBeVisible()
    await testInfo.attach('practice-review-due-summary.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    })
  }
)

test('practice never exposes the next hand before its image decode completes', async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as unknown as {
      holdCardDecode: boolean
      releaseCardDecodes: () => void
    }
    let releases: Array<() => void> = []
    HTMLImageElement.prototype.decode = function () {
      if (!testWindow.holdCardDecode) return Promise.resolve()
      return new Promise<void>((resolve) => releases.push(resolve))
    }
    testWindow.releaseCardDecodes = () => {
      const pending = releases
      releases = []
      for (const release of pending) release()
    }
  })

  await page.goto('/#/practice')
  await waitForKeypad(page)
  const image = page.locator('.pcard__img')
  const firstName = await image.getAttribute('alt')
  const first = cardsData.cards.find((card) => card.name === firstName)
  expect(first).toBeTruthy()

  await page.evaluate(() => {
    ;(window as unknown as { holdCardDecode: boolean }).holdCardDecode = true
  })
  await page.getByRole('button', { name: `${first!.elixir} elixir`, exact: true }).click()
  await page.waitForTimeout(400)

  // The feedback beat has elapsed, but the next hand remains entirely hidden
  // behind the solved one until its exact art can paint.
  await expect(image).toHaveAttribute('alt', first!.name)
  await expect(page.locator('.pcard')).toHaveClass(/pcard--correct/)
  await expect(page.locator('.pcard__answer-cost')).toHaveText(String(first!.elixir))

  await page.evaluate(() => {
    const testWindow = window as unknown as { holdCardDecode: boolean; releaseCardDecodes: () => void }
    testWindow.holdCardDecode = false
    testWindow.releaseCardDecodes()
  })
  await expect(image).not.toHaveAttribute('alt', first!.name)
  await expect(image).toHaveJSProperty('complete', true)
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
})

test('practice runs until the player ends it, then closes on stats with no personal best', async ({ page }) => {
  // Sixteen deliberate learning holds plus card-art handoffs can exceed the
  // suite's 30-second default on CI WebKit while remaining well within the
  // interaction's expected bound.
  test.setTimeout(45_000)
  const card = await openPracticeOnMidCostCard(page)

  // Past the retired 15-card round: answer 16 questions and the session is still
  // live. Every card is read off the board, since the deal is weighted.
  let live = card
  for (let index = 0; index < 16; index += 1) {
    await page.getByRole('button', { name: `${live.elixir} elixir`, exact: true }).click()
    await expect(page.locator('.ed-game__progress')).toHaveText(`${index + 1} practiced`)
    // The next card lands after a short beat and is never the one just solved,
    // so waiting for the art to change is what makes the next read safe.
    await expect(page.locator('.pcard__img')).not.toHaveAttribute('alt', live.name)
    const name = await page.locator('.pcard__img').getAttribute('alt')
    const next = cardsData.cards.find((candidate) => candidate.name === name)
    expect(next).toBeTruthy()
    live = next!
  }

  const endSession = page.getByRole('button', { name: 'End session' })
  await expect(endSession).toHaveText('')
  await expect(endSession.locator('svg')).toBeVisible()
  await endSession.click()
  await expect(page.locator('[data-summary]')).toBeVisible()
  await expect(page.locator('.ed-sum__headline')).toHaveText('16 cards practiced')
  await expect(page.locator('[data-practice-stat="recall"]')).toContainText('16 / 16')
  await expect(page.locator('[data-practice-stat="assisted"]')).toContainText('no help used')
  await expect(page.locator('[data-practice-stat="due"]')).toContainText('0')
  // No score, no record, no personal best anywhere on the summary.
  await expect(page.locator('.ed-sum__pb')).toHaveCount(0)
  await expect(page.locator('.ed-permalink')).toHaveCount(0)
  await expect(page.locator('[data-summary]')).not.toContainText(/personal best|New best/i)
})

test('practice summary separates recognition help from recall', async ({ page }, testInfo) => {
  await useSignedOutState(page, '/practice')
  await waitForKeypad(page)
  await page.getByRole('button', { name: '4 choices' }).click()

  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
  await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')
  await page.getByRole('button', { name: 'End session' }).click()

  await expect(page.locator('.ed-sum__headline')).toHaveText('1 card practiced')
  await expect(page.locator('[data-practice-stat="recall"]')).toContainText('no unassisted reads')
  await expect(page.locator('[data-practice-stat="assisted"]')).toContainText('1 / 1')
  await expect(page.locator('[data-practice-stat="due"]')).toContainText('0')
  await expect(page.locator('[data-summary]')).not.toContainText('Work on these')
  await expect(page.getByRole('button', { name: /Practice again/ })).toBeVisible()
  await expect(page.getByText(/Practice session (saved|complete)/, { exact: true })).toBeVisible()
  await testInfo.attach('practice-assisted-summary.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
})

test('practice offers voluntary idle help without revealing the answer', { tag: '@deploy' }, async ({ page }) => {
  await page.goto('/#/practice')
  await waitForKeypad(page)

  await expect(page.getByRole('button', { name: /Need a nudge/ })).toHaveCount(0)
  await page.waitForTimeout(7_100)
  await page.getByRole('button', { name: /Need a nudge/ }).click()

  await expect(page.locator('.mc-choices__btn')).toHaveCount(4)
  await expect(page.locator('.pcard__answer-cost')).toHaveCount(0)
})

test('practice keeps the learning hold and advances under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/practice')
  await waitForKeypad(page)

  const image = page.locator('.pcard__img')
  const name = await image.getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === name)
  expect(card).toBeTruthy()

  await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
  await expect(page.locator('.pcard__answer-cost')).toHaveText(String(card!.elixir))
  await page.waitForTimeout(250)
  await expect(page.locator('.pcard__answer-cost')).toBeVisible()
  await expect(image).not.toHaveAttribute('alt', card!.name)
})

test('card art fallback renders when card images cannot load', async ({ page }) => {
  allowBlockedAssets.add(page)
  // Card art is mirrored same-origin under /cards/; block that path.
  await page.route('**/cards/*.png', (route) => route.abort())
  await page.goto('/')
  await page.goto('/#/practice')
  await expect(page.locator('.pcard__fallback')).toBeVisible({ timeout: 12_000 })
})
