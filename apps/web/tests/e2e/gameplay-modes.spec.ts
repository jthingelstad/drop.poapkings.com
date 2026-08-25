import { TRADE_LADDER, TRADE_ROUNDS } from '@elixir-drop/contracts'
import { cardsById, cardsData, expect, test, waitForKeypad } from './fixtures'

test('survival progressively tops up its card-art look-ahead', async ({ page }) => {
  const requestedCards = new Set<string>()
  await page.route('**/cards/*.png', async (route) => {
    requestedCards.add(new URL(route.request().url()).pathname)
    await route.continue()
  })

  await page.goto('/#/survival')

  const cardPath = (index: number) => `/cards/${cardsData.cards[index]!.id}.png`
  // Fourteen images gate startup. The first progressive top-up is requested
  // during the countdown, while the rest of the 175-card deck stays untouched.
  await expect.poll(() => requestedCards.has(cardPath(14))).toBe(true)
  expect(requestedCards.has(cardPath(15))).toBe(false)
  expect(requestedCards.has(cardPath(cardsData.cards.length - 1))).toBe(false)

  await waitForKeypad(page)
  const first = cardsData.cards[0]!
  await page.getByRole('button', { name: `${first.elixir} elixir`, exact: true }).click()

  // Advancing one card adds exactly the next distant card to the warm window;
  // it does not fan out across the remaining catalog.
  await expect.poll(() => requestedCards.has(cardPath(15))).toBe(true)
  expect(requestedCards.has(cardPath(16))).toBe(false)
})

test('survival flashes the same every-10 counter as Rain', async ({ page }, testInfo) => {
  await page.goto('/#/survival')
  await waitForKeypad(page)

  const cardImage = page.locator('.pcard__img')
  for (let cleared = 0; cleared < 10; cleared += 1) {
    const name = await cardImage.getAttribute('alt')
    const card = cardsData.cards.find((candidate) => candidate.name === name)
    expect(card, `unknown survival card "${name}"`).toBeTruthy()
    await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
    if (cleared < 9) await expect(cardImage).not.toHaveAttribute('alt', name!)
  }

  await expect(page.locator('.game-milestone__num')).toHaveText('10')
  await testInfo.attach('survival-10-milestone.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
  await expect(page.locator('.game-milestone')).toHaveCount(0)
})

test(
  'practice reinforces the solved cost without a streak milestone',
  { tag: '@deploy' },
  async ({ page }, testInfo) => {
    // This deliberately clears ten hands to prove the retired streak milestone
    // never returns. WebKit can take more than the suite's 30-second aggregate
    // ceiling on a shared CI host; every individual interaction still uses the
    // normal five-second assertion limit.
    test.setTimeout(45_000)
    await page.goto('/#/practice')
    await waitForKeypad(page)

    const cardImage = page.locator('.pcard__img')
    await page.evaluate(() => {
      const testWindow = window as unknown as { __practiceReinforcementMs?: number }
      let reveal: Element | null = null
      let shownAt = 0
      const observer = new MutationObserver(() => {
        if (!reveal) {
          const current = document.querySelector('.pcard__answer-cost')
          if (current) {
            reveal = current
            shownAt = performance.now()
          }
          return
        }
        if (!reveal.isConnected) {
          testWindow.__practiceReinforcementMs = performance.now() - shownAt
          observer.disconnect()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
    const answerLiveCard = async () => {
      const name = await cardImage.getAttribute('alt')
      const card = cardsData.cards.find((candidate) => candidate.name === name)
      expect(card, `unknown practice card "${name}"`).toBeTruthy()
      await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
      return { card: card!, name: name! }
    }

    const first = await answerLiveCard()
    const reinforcement = page.locator('.pcard__answer-cost')
    await expect(reinforcement).toHaveText(String(first.card.elixir))
    const { artBounds, revealBounds, revealStyle, sameMotion } = await page.evaluate(() => {
      const art = document.querySelector('.pcard__img')
      const reveal = document.querySelector('.pcard__answer-cost')
      if (!(art instanceof HTMLElement) || !(reveal instanceof HTMLElement)) {
        throw new Error('Practice reinforcement was not rendered')
      }
      const bounds = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      return {
        artBounds: bounds(art),
        revealBounds: bounds(reveal),
        revealStyle: {
          backgroundImage: getComputedStyle(reveal).backgroundImage,
          borderStyle: getComputedStyle(reveal).borderStyle,
          filter: getComputedStyle(reveal).filter,
          fontSize: Number.parseFloat(getComputedStyle(reveal).fontSize)
        },
        sameMotion: art.closest('.game-motion') === reveal.closest('.game-motion')
      }
    })
    expect(artBounds).toBeTruthy()
    expect(revealBounds.width).toBe(artBounds.width)
    expect(Math.abs(artBounds.x + artBounds.width / 2 - (revealBounds.x + revealBounds.width / 2))).toBeLessThan(2)
    expect(Math.abs(artBounds.y + artBounds.height / 2 - (revealBounds.y + revealBounds.height / 2))).toBeLessThan(2)
    expect(revealStyle.backgroundImage).toBe('none')
    expect(revealStyle.borderStyle).toBe('none')
    expect(revealStyle.filter).not.toBe('none')
    expect(revealStyle.fontSize).toBeGreaterThanOrEqual(120)
    // The answer is structurally inside the same animated card container, so the
    // exit transform carries them as one object rather than replacing the value.
    expect(sameMotion).toBe(true)
    await testInfo.attach('practice-correct-feedback.png', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png'
    })
    // Measure the element's real in-page lifetime instead of asking the test
    // runner to schedule an assertion inside a 300ms window. A contended runner
    // may resume late, but the browser's mutation timestamps remain exact.
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __practiceReinforcementMs?: number }).__practiceReinforcementMs ?? 0
        )
      )
      .toBeGreaterThanOrEqual(275)
    // The hand swaps only after that attached exit completes.
    await expect(cardImage).not.toHaveAttribute('alt', first.name)
    await expect(reinforcement).toHaveCount(0)

    for (let answered = 2; answered <= 9; answered += 1) {
      const current = await answerLiveCard()
      await expect(cardImage).not.toHaveAttribute('alt', current.name)
    }

    await answerLiveCard()
    await expect(page.locator('.game-milestone')).toHaveCount(0)
    await expect(page.getByText(/streak/i)).toHaveCount(0)
  }
)

test('active play states use low chrome and keep controls visible', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const activeModes = [
    { hash: '#/surge', control: '.pip-keypad' },
    { hash: '#/survival', control: '.pip-keypad' },
    { hash: '#/trade', control: '.ed-xpad' }
  ]

  for (const mode of activeModes) {
    await page.goto('/')
    await page.goto(`/${mode.hash}`)
    // Game routes render the play area full-bleed — the footer never mounts.
    await expect(page.locator('.site-foot')).toHaveCount(0)

    await expect(page.locator(mode.control)).toBeVisible({ timeout: 12_000 })
    await expect(page.locator('.ed-game')).toBeVisible()
    await expect(page.locator('.game-motion')).toBeVisible()
    await expect(page.locator('.game-fx-layer')).toHaveCount(1)
    if (testInfo.project.name === 'chromium') {
      await expect(page.locator('.game-fx-layer canvas')).toHaveCount(1)
    }

    if (mode.hash === '#/surge') {
      const artChrome = await page
        .locator('.cr-card-art')
        .first()
        .evaluate((element) => ({
          before: getComputedStyle(element, '::before').content,
          after: getComputedStyle(element, '::after').content
        }))
      const cardPanel = await page
        .locator('.pcard')
        .first()
        .evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            backgroundImage: style.backgroundImage,
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth
          }
        })

      expect(artChrome).toEqual({ before: 'none', after: 'none' })
      expect(cardPanel).toEqual({ backgroundImage: 'none', borderStyle: 'none', borderWidth: '0px' })
    }

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    expect(hasHorizontalOverflow).toBe(false)

    const screenshot = await page.screenshot({ fullPage: false })
    await testInfo.attach(`${mode.hash.slice(2).replaceAll('/', '-')}-running.png`, {
      body: screenshot,
      contentType: 'image/png'
    })
  }
})

test('rain flashes the running total every 10 clears', async ({ page }) => {
  await page.goto('/#/rain')
  await waitForKeypad(page)

  // Clear the lit card by reading its name off the tile and tapping that cost.
  // Rain is endless and the deck wraps, so this drives a real 10-clear streak.
  for (let cleared = 0; cleared < 10; cleared += 1) {
    const lit = page.locator('.ed-rain__tile--lit').first()
    await expect(lit).toBeVisible({ timeout: 12_000 })
    const name = await lit.locator('.ed-rain__tile-name').textContent()
    const card = cardsData.cards.find((candidate) => candidate.name === name)
    expect(card, `unknown rain card "${name}"`).toBeTruthy()
    await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
    await expect(page.locator('.ed-game__metric')).toHaveText(String(cleared + 1))
  }

  // The milestone flash appears with the running total, then clears itself.
  await expect(page.locator('.game-milestone__num')).toHaveText('10')
  await expect(page.locator('.game-milestone')).toHaveCount(0, { timeout: 4_000 })
})

test('trade auto-advances the ten-exchange ladder with one cost hint per wrong guess', async ({ page }) => {
  await page.goto('/#/trade')
  const teams = page.locator('.ed-xboard')
  await expect(teams).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.ed-xpad')).toBeVisible()

  const readSideIds = async (selector: string) =>
    page
      .locator(`${selector} [data-card-id]`)
      .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
  const total = (ids: number[]) => ids.reduce((sum, id) => sum + (cardsById.get(id)?.elixir ?? 0), 0)
  const answers = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
  const format = (value: number) =>
    value === 0 ? 'Even' : value > 0 ? `Blue ahead by ${value}` : `Red ahead by ${Math.abs(value)}`
  const seenIds: number[] = []

  for (let trade = 1; trade <= TRADE_ROUNDS; trade += 1) {
    await expect(page.locator('.ed-trade__board')).toHaveAttribute('data-trade-index', String(trade))
    const blueIds = await readSideIds('.ed-xlane--blue')
    const redIds = await readSideIds('.ed-xlane--red')
    const roundIds = [...blueIds, ...redIds]
    expect(new Set(roundIds).size).toBe(roundIds.length)
    seenIds.push(...roundIds)

    // The board shape is the ladder's, the same on every run: 1v1 openers,
    // growing one card at a time, 3v3 only at the finish.
    const board = TRADE_LADDER[trade - 1]!
    expect({ blue: blueIds.length, red: redIds.length }).toEqual(board)

    // Notice-free play scales the art to the current rung instead of making
    // the simple opening as small as the 3v3 finish. Both ends of the ladder
    // still keep every card inside its team panel.
    if (trade === 1 || trade === TRADE_ROUNDS) {
      // A dealt card animates in, so a bare measurement can catch it mid-scale
      // and read a third of its real height. Poll the geometry until the deal
      // has settled, then assert on the settled values.
      const measure = () =>
        teams.locator('.ed-xcard').evaluateAll((elements) =>
          elements.map((element) => {
            const bounds = element.getBoundingClientRect()
            const lane = element.closest('.ed-xlane')?.getBoundingClientRect()
            return {
              width: bounds.width,
              height: bounds.height,
              contained:
                !!lane &&
                bounds.left >= lane.left - 1 &&
                bounds.right <= lane.right + 1 &&
                bounds.top >= lane.top - 1 &&
                bounds.bottom <= lane.bottom + 1
            }
          })
        )
      // The exchange board uses a fixed 96×120 card in both lanes at every rung,
      // so the card no longer scales per rung — it just has to be a real card
      // kept inside its lane at both ends of the ladder.
      await expect
        .poll(async () => {
          const settled = await measure()
          return settled.length > 0 && settled.every((card) => card.width >= 60 && card.height >= 60)
        })
        .toBe(true)
      expect((await measure()).every((card) => card.contained)).toBe(true)
    }

    // Every run now ends on the widest board the mode can draw, so six cards on
    // a phone is no longer a rare deal — it is the finish line of every run.
    if (board.blue === 3 && board.red === 3) {
      const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      expect(overflows).toBe(false)
    }

    const answer = total(redIds) - total(blueIds)
    expect(answer).toBeGreaterThanOrEqual(-4)
    expect(answer).toBeLessThanOrEqual(4)

    if (trade === 1) {
      const wrong = answers.find((value) => value !== answer)
      expect(wrong).toBeDefined()
      await expect(page.locator('.ed-xcard__cost')).toHaveCount(0)
      // The cue flips back to "Try again" after the wrong-beat, so arm an
      // in-page watcher before the click: it polls inside the browser and
      // cannot miss the window if the test worker is momentarily busy.
      const costRevealed = page.waitForFunction(() =>
        document.querySelector('[data-testid="trade-hint"]')?.textContent?.includes('Cost revealed')
      )
      await page.getByRole('button', { name: format(wrong!) }).click()
      await costRevealed
      await expect(page.locator('.ed-xcard__cost')).toHaveCount(1)
    }

    await expect(page.getByRole('button', { name: format(answer) })).toBeEnabled()
    if (trade === 1) {
      const answerCost = answer === 0 ? 5 : answer > 0 ? answer : 5 + Math.abs(answer)
      const homeKeys = ['A', 'S', 'D', 'F', 'G', 'J', 'K', 'L', ';']
      await page.keyboard.press(homeKeys[answerCost - 1]!)
    } else {
      await page.getByRole('button', { name: format(answer) }).click()
    }
    await expect(page.getByRole('button', { name: 'Next trade' })).toHaveCount(0)

    if (trade < TRADE_ROUNDS) {
      await page.waitForFunction(
        (expected) => document.querySelector('.ed-trade__board')?.getAttribute('data-trade-index') === String(expected),
        trade + 1
      )
    }
  }

  // The Trade summary is now the shared summary card.
  await expect(page.locator('.ed-sum')).toBeVisible()
  await expect(page.getByText('Trade complete')).toBeVisible()
  expect(new Set(seenIds).size).toBe(seenIds.length)
})
