import type { Page } from '@playwright/test'
import { cardsData, expect, test, waitForKeypad } from './fixtures'

async function exchangeCardLabelsClear(page: Page): Promise<boolean> {
  return page.locator('.ed-xcard--revealed').evaluateAll((cards) => {
    if (cards.length === 0) return false
    return cards.every((card) => {
      const image = card.querySelector('.ed-xcard__img')?.getBoundingClientRect()
      const cost = card.querySelector('.ed-xcard__cost')?.getBoundingClientRect()
      const name = card.querySelector('.ed-xcard__name')?.getBoundingClientRect()
      if (!image || !cost || !name) return false
      const costOverlapsName =
        cost.left < name.right && cost.right > name.left && cost.top < name.bottom && cost.bottom > name.top
      return cost.top <= image.top + 8 && name.top >= image.bottom && !costOverlapsName
    })
  })
}

test.describe('mobile timed-mode controls', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true })

  test('keeps every timed keypad in the first viewport', async ({ page }) => {
    for (const hash of ['#/surge', '#/survival']) {
      await page.goto(`/${hash}`)
      const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
      await expect(keypad).toBeVisible({ timeout: 12_000 })

      const controlsFit = await keypad.evaluate((element) => {
        const buttons = [...element.querySelectorAll('button')]
        return buttons.every((button) => button.getBoundingClientRect().bottom <= window.innerHeight + 1)
      })
      expect(controlsFit).toBe(true)
    }
  })

  // Practice is untimed (no countdown), but pairs a full card with the same
  // keypad — its bottom row must not fall off the first viewport either.
  test('keeps the Practice keypad in the first viewport', { tag: '@deploy' }, async ({ page }) => {
    await page.goto('/#/practice/costs')
    const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
    await expect(keypad).toBeVisible({ timeout: 12_000 })

    const controlsFit = await keypad.evaluate((element) =>
      [...element.querySelectorAll('button')].every(
        (button) => button.getBoundingClientRect().bottom <= window.innerHeight + 1
      )
    )
    expect(controlsFit).toBe(true)
  })

  test('locks vertical browser gestures during active play', { tag: '@deploy' }, async ({ page }, testInfo) => {
    await page.goto('/#/practice/costs')
    await waitForKeypad(page)

    const game = page.locator('.ed-game')
    const scroller = page.locator('.ed-mobile__scroll--game')
    const lock = await scroller.evaluate((element) => {
      const styles = getComputedStyle(element)
      return {
        overflowY: styles.overflowY,
        overscrollBehaviorY: styles.overscrollBehaviorY,
        touchAction: styles.touchAction
      }
    })
    expect(lock).toEqual({
      overflowY: 'hidden',
      overscrollBehaviorY: 'none',
      touchAction: 'none'
    })

    const before = await page.evaluate(() => ({
      documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
      gameTop: document.querySelector('.ed-game')?.getBoundingClientRect().top ?? 0,
      scrollerScrollTop: document.querySelector('.ed-mobile__scroll--game')?.scrollTop ?? 0
    }))
    const bounds = await game.boundingBox()
    expect(bounds).not.toBeNull()

    // Mobile WebKit does not expose wheel input through Playwright. Chromium's
    // mobile viewport exercises displacement, while every engine asserts the
    // CSS touch contract that prevents a real finger pan from reaching iOS.
    if (testInfo.project.name === 'chromium') {
      await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
      await page.mouse.wheel(0, 500)
      await page.mouse.wheel(0, -500)
    }

    const after = await page.evaluate(() => ({
      documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
      gameTop: document.querySelector('.ed-game')?.getBoundingClientRect().top ?? 0,
      scrollerScrollTop: document.querySelector('.ed-mobile__scroll--game')?.scrollTop ?? 0
    }))
    expect(after).toEqual(before)

    const cardName = await page.locator('.pcard__img').getAttribute('alt')
    const card = cardsData.cards.find((candidate) => candidate.name === cardName)
    expect(card).toBeTruthy()
    const answer = page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true })
    const answerBounds = await answer.boundingBox()
    expect(answerBounds).not.toBeNull()
    await page.touchscreen.tap(answerBounds!.x + answerBounds!.width / 2, answerBounds!.y + answerBounds!.height / 2)
    await expect(page.locator('.ed-game__progress')).toHaveText('1 practiced')
  })

  test('keeps both Higher / Lower cards usable in the first viewport', async ({ page }) => {
    await page.goto('/#/higher-lower')
    const cards = page.locator('.ed-duel__card')
    await expect(cards).toHaveCount(2)
    await expect(cards.first()).toBeEnabled({ timeout: 12_000 })

    const controlsFit = await cards.evaluateAll((elements) =>
      elements.every((element) => {
        const bounds = element.getBoundingClientRect()
        const image = element.querySelector('.pcard__img')?.getBoundingClientRect()
        return (
          bounds.top >= 0 &&
          bounds.bottom <= window.innerHeight + 1 &&
          bounds.width >= window.innerWidth * 0.75 &&
          !!image &&
          image.width > 0 &&
          image.height > 0
        )
      })
    )
    expect(controlsFit).toBe(true)
  })

  test('keeps the Trade board separated below the update banner', async ({ page }) => {
    await page.goto('/#/trade')
    const trade = page.locator('.ed-trade')
    await expect(trade).toBeVisible({ timeout: 12_000 })

    const layout = await trade.evaluate((element) => {
      const game = element.closest('.ed-game')?.getBoundingClientRect()
      const motion = element.querySelector(':scope > .game-motion')?.getBoundingClientRect()
      const blue = element.querySelector('.ed-xlane--blue')?.getBoundingClientRect()
      const red = element.querySelector('.ed-xlane--red')?.getBoundingClientRect()
      const prompt = element.querySelector('.ed-trade__prompt')?.getBoundingClientRect()
      const pad = element.querySelector('.ed-xpad')?.getBoundingClientRect()
      return {
        viewportWidth: window.innerWidth,
        gameWidth: game?.width ?? 0,
        boardContained: !!motion && !!blue && !!red && blue.top >= motion.top - 1 && red.bottom <= motion.bottom + 1,
        boardClearsPrompt: !!red && !!prompt && red.bottom <= prompt.top + 1,
        padFits: !!pad && pad.left >= 0 && pad.right <= window.innerWidth + 1 && pad.bottom <= window.innerHeight + 1
      }
    })
    expect(layout.gameWidth).toBeGreaterThanOrEqual(layout.viewportWidth * 0.9)
    expect(layout.boardContained).toBe(true)
    expect(layout.boardClearsPrompt).toBe(true)
    expect(layout.padFits).toBe(true)

    // Any answer reveals at least one cost. The shared card wrapper must keep
    // that badge on the image rather than dropping it over the name below.
    await page.locator('.ed-xpad__key:not(:disabled)').first().click()
    await expect(page.locator('.ed-xcard--revealed').first()).toBeVisible()
    expect(await exchangeCardLabelsClear(page)).toBe(true)
  })

  test('the Rain field reclaims the space of the retired instruction caption', async ({ page }) => {
    await page.goto('/#/rain')
    // The "Clear the lit card before it lands" caption was removed; the field
    // gets those pixels back, and there is no instruction over it.
    await expect(page.locator('.ed-rain__field')).toBeVisible({ timeout: 12_000 })
    await expect(page.locator('.ed-rain__hint')).toHaveCount(0)
  })

  // The pip keypad is always two full-width rows — it trades vertical space for
  // tap-target width, so it is the layout most likely to push its own bottom row
  // off screen. Practice is the tightest budget of the four keypad modes (it
  // also renders the input pills), and Rain draws the pad over the
  // falling-cards field.
  test('keeps both keypad rows in the first viewport', async ({ page }) => {
    for (const hash of ['#/surge', '#/survival', '#/practice/costs', '#/rain']) {
      await page.goto(`/${hash}`)
      const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
      await expect(keypad).toBeVisible({ timeout: 12_000 })
      await expect(keypad.locator('.pip-keypad__row')).toHaveCount(2)

      const controlsFit = await keypad.evaluate((element) =>
        [...element.querySelectorAll('button')].every(
          (button) => button.getBoundingClientRect().bottom <= window.innerHeight + 1
        )
      )
      expect(controlsFit, `keypad overflows on ${hash}`).toBe(true)
    }
  })

  test('keeps completed summary actions reachable in an installed-app viewport', async ({ page }, testInfo) => {
    await page.goto('/#/surge')
    // Standalone iPhones reserve the status-bar inset inside the fixed game
    // shell. The CSS token is the existing deterministic seam for that space.
    await page.evaluate(() => document.documentElement.style.setProperty('--ed-safe-area-top', '47px'))
    await waitForKeypad(page)
    // Use the supported number-key path to reach the summary. Pointer/touch
    // sequencing has its own regression coverage; this test owns layout only.
    for (let index = 0; index < 15; index += 1) {
      const cardName = await page.locator('.pcard__img').getAttribute('alt')
      const card = cardsData.cards.find((candidate) => candidate.name === cardName)
      expect(card).toBeTruthy()
      await page.keyboard.press(String(card!.elixir))
      if (index < 14) {
        await expect(page.locator('.ed-game__progress')).toHaveText(`Card ${index + 2} / 15`)
      }
    }
    await expect(page.locator('.ed-sum')).toBeVisible()

    const summary = page.locator('.ed-gamewrap')
    const actions = summary.locator('.ed-sum__actions')
    const replay = actions.getByRole('button', { name: 'Play again' })
    const home = actions.getByRole('button', { name: 'Home' })
    const geometry = await summary.evaluate((element) => {
      const scroller = element.parentElement
      const actionBlock = element.querySelector<HTMLElement>('.ed-sum__actions')
      const wrapperBounds = element.getBoundingClientRect()
      const actionBounds = actionBlock?.getBoundingClientRect()
      return {
        containsActions: !!actionBounds && actionBounds.bottom <= wrapperBounds.bottom + 1,
        nestedScrollRange: Math.max(0, (scroller?.scrollHeight ?? 0) - (scroller?.clientHeight ?? 0)),
        documentScrollRange: Math.max(0, (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight)
      }
    })

    // Active play needs a fixed nested shell, but a completed summary does not.
    // iOS standalone WebKit can leave a dynamically populated nested scroll
    // range stale until the PWA is suspended and resumed, hiding these actions.
    expect(geometry.containsActions).toBe(true)
    expect(geometry.nestedScrollRange).toBeLessThanOrEqual(1)
    expect(geometry.documentScrollRange).toBeGreaterThan(0)

    await actions.scrollIntoViewIfNeeded()
    const actionBounds = await actions.boundingBox()
    expect(actionBounds).not.toBeNull()
    expect(actionBounds!.y).toBeGreaterThanOrEqual(0)
    expect(actionBounds!.y + actionBounds!.height).toBeLessThanOrEqual(665)
    await expect(replay).toBeVisible()
    await expect(home).toBeVisible()
    if (testInfo.project.name === 'iphone-14') {
      await testInfo.attach('completed-summary-actions.png', {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png'
      })
    }
  })
})

test.describe('mobile-width mouse fallback', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: false })

  test('opens Cost Recall from the ranked touch-only gate', { tag: '@deploy' }, async ({ page }) => {
    await page.goto('/#/survival')
    // The gate names the mode it stopped and states the reason once.
    await expect(page.getByText('Survival is a thumb game')).toBeVisible()
    // The bridge: a code that opens THAT mode, not the home page.
    await expect(page.getByRole('img', { name: /QR code opening Survival/ })).toBeVisible()
    await expect(page.locator('.ed-touchgate__url')).toContainText('#/survival')

    await page.getByRole('button', { name: 'Practice instead' }).click()

    await expect(page).toHaveURL(/#\/practice\/costs$/)
    await expect(page.getByRole('group', { name: 'Elixir cost keypad' })).toBeVisible({ timeout: 12_000 })
  })

  test('the gate also opens that mode’s board without reaching for a phone', async ({ page }) => {
    await page.goto('/#/rain')
    await page.getByRole('button', { name: 'Open the Rain board' }).click()
    await expect(page).toHaveURL(/#\/leaderboards\?mode=rain$/)
  })
})

test.describe('low-height desktop timed controls', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('keeps the entire Surge keypad in view', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the low-height desktop shell has dedicated viewport coverage')
    await page.goto('/#/surge')
    const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
    await expect(keypad).toBeVisible({ timeout: 12_000 })

    const controlsFit = await keypad.evaluate((element) =>
      [...element.querySelectorAll('button')].every((button) => {
        const bounds = button.getBoundingClientRect()
        return bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1
      })
    )
    expect(controlsFit).toBe(true)
  })

  test('keeps Higher / Lower in view below the update banner', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the low-height desktop shell has dedicated viewport coverage')
    await page.goto('/#/higher-lower')
    const cards = page.locator('.ed-duel__card')
    await expect(cards.first()).toBeEnabled({ timeout: 12_000 })

    const controlsFit = await cards.evaluateAll((elements) =>
      elements.every((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1
      })
    )
    expect(controlsFit).toBe(true)
  })

  test('keeps the Trade board full-width below the update banner', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the low-height desktop shell has dedicated viewport coverage')
    await page.goto('/#/trade')
    const trade = page.locator('.ed-trade')
    await expect(trade).toBeVisible({ timeout: 12_000 })

    const layout = await trade.evaluate((element) => {
      const game = element.closest('.ed-game')?.getBoundingClientRect()
      const motion = element.querySelector(':scope > .game-motion')?.getBoundingClientRect()
      const blue = element.querySelector('.ed-xlane--blue')?.getBoundingClientRect()
      const red = element.querySelector('.ed-xlane--red')?.getBoundingClientRect()
      const prompt = element.querySelector('.ed-trade__prompt')?.getBoundingClientRect()
      const pad = element.querySelector('.ed-xpad')?.getBoundingClientRect()
      return {
        gameWidth: game?.width ?? 0,
        boardContained: !!motion && !!blue && !!red && blue.top >= motion.top - 1 && red.bottom <= motion.bottom + 1,
        boardClearsPrompt: !!red && !!prompt && red.bottom <= prompt.top + 1,
        padFits: !!pad && pad.left >= 0 && pad.right <= window.innerWidth + 1 && pad.bottom <= window.innerHeight + 1
      }
    })
    // The desktop shell now letterboxes the phone column (~440px), so the board
    // no longer spans a wide center stage — it fills the column instead.
    expect(layout.gameWidth).toBeGreaterThanOrEqual(400)
    expect(layout.boardContained).toBe(true)
    expect(layout.boardClearsPrompt).toBe(true)
    expect(layout.padFits).toBe(true)
  })

  // The strict gate: fully in view, top and bottom, on the shortest desktop.
  test('keeps both keypad rows in view', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the low-height desktop shell has dedicated viewport coverage')
    await page.goto('/#/surge')
    const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
    await expect(keypad).toBeVisible({ timeout: 12_000 })
    await expect(keypad.locator('.pip-keypad__row')).toHaveCount(2)

    const controlsFit = await keypad.evaluate((element) =>
      [...element.querySelectorAll('button')].every((button) => {
        const bounds = button.getBoundingClientRect()
        return bounds.top >= 0 && bounds.bottom <= window.innerHeight + 1
      })
    )
    expect(controlsFit).toBe(true)
  })

  test('keeps the Higher / Lower replay action in view', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the low-height desktop shell has dedicated viewport coverage')
    // Higher/Lower runs on three lives, so reaching the summary means spending
    // all three. Freeze the round clock and tap the LOWER card three times —
    // far quicker and steadier than running three shrinking windows out.
    await page.clock.install({ time: new Date('2026-07-25T12:00:00.000Z') })
    await page.goto('/#/higher-lower')
    const cards = page.locator('.ed-duel__card')
    await expect(cards.first()).toBeEnabled({ timeout: 12_000 })
    await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 200))
    for (let miss = 0; miss < 3; miss += 1) {
      const names = await cards.locator('.pcard__img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt')))
      const costs = names.map((name) => cardsData.cards.find((card) => card.name === name)?.elixir ?? 0)
      await cards.nth(costs[0]! < costs[1]! ? 0 : 1).click()
      await expect(page.locator('.ed-duel__card--wrong')).toBeVisible()
      // Past the 1400ms reveal beat, which deals the next pair (or ends it).
      await page.clock.runFor(1_600)
    }

    const replay = page.getByRole('button', { name: 'Play again' })
    await expect(replay).toBeVisible({ timeout: 12_000 })
    const bounds = await replay.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(721)

    const notice = page.locator('.run-recording__card--saved')
    if (await notice.isVisible()) {
      const noticeBounds = await notice.boundingBox()
      expect(noticeBounds).not.toBeNull()
      const overlaps =
        bounds!.x < noticeBounds!.x + noticeBounds!.width &&
        bounds!.x + bounds!.width > noticeBounds!.x &&
        bounds!.y < noticeBounds!.y + noticeBounds!.height &&
        bounds!.y + bounds!.height > noticeBounds!.y
      expect(overlaps).toBe(false)
    }
  })
})
