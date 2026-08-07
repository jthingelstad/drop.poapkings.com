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

test('active play states use low chrome and keep controls visible', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const activeModes = [
    { hash: '#/surge', control: '.pip-keypad' },
    { hash: '#/survival', control: '.pip-keypad' },
    { hash: '#/trade', control: '.ed-trade__pad' }
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
  const teams = page.locator('.ed-trade__teams')
  await expect(teams).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.ed-trade__pad')).toBeVisible()

  const readSideIds = async (selector: string) =>
    page
      .locator(`${selector} [data-card-id]`)
      .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.cardId)))
  const total = (ids: number[]) => ids.reduce((sum, id) => sum + (cardsById.get(id)?.elixir ?? 0), 0)
  const answers = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
  const format = (value: number) => (value === 0 ? 'Even trade' : `${value > 0 ? `+${value}` : value} trade`)
  const seenIds: number[] = []

  for (let trade = 1; trade <= TRADE_ROUNDS; trade += 1) {
    await expect(teams).toHaveAttribute('data-trade-index', String(trade))
    const blueIds = await readSideIds('.ed-trade__team--blue')
    const redIds = await readSideIds('.ed-trade__team--red')
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
      const art = await teams.locator('.ed-trade__card-art').evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect()
          const team = element.closest('.ed-trade__team')?.getBoundingClientRect()
          return {
            width: bounds.width,
            height: bounds.height,
            contained:
              !!team &&
              bounds.left >= team.left - 1 &&
              bounds.right <= team.right + 1 &&
              bounds.top >= team.top - 1 &&
              bounds.bottom <= team.bottom + 1
          }
        })
      )
      const minWidth = trade === 1 ? 104 : 82
      const minHeight = trade === 1 ? 122 : 96
      expect(art.every((card) => card.width >= minWidth && card.height >= minHeight && card.contained)).toBe(true)
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
      await expect(page.locator('.ed-trade__card-cost')).toHaveCount(0)
      // The cue flips back to "Try again" after the wrong-beat, so arm an
      // in-page watcher before the click: it polls inside the browser and
      // cannot miss the window if the test worker is momentarily busy.
      const costRevealed = page.waitForFunction(() =>
        document.querySelector('[data-testid="trade-hint"]')?.textContent?.includes('Cost revealed')
      )
      await page.getByRole('button', { name: format(wrong!) }).click()
      await costRevealed
      await expect(page.locator('.ed-trade__card-cost')).toHaveCount(1)
    }

    await expect(page.getByRole('button', { name: format(answer) })).toBeEnabled()
    await page.getByRole('button', { name: format(answer) }).click()
    await expect(page.getByRole('button', { name: 'Next trade' })).toHaveCount(0)

    if (trade < TRADE_ROUNDS) {
      await page.waitForFunction(
        (expected) => document.querySelector('.ed-trade__teams')?.getAttribute('data-trade-index') === String(expected),
        trade + 1
      )
    }
  }

  // The Trade summary is now the shared summary card.
  await expect(page.locator('.ed-sum')).toBeVisible()
  await expect(page.getByText('Trade complete')).toBeVisible()
  expect(new Set(seenIds).size).toBe(seenIds.length)
})
