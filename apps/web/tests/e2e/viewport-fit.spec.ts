import type { Page } from '@playwright/test'
import { cardsData, expect, test, testApiBaseUrl, testStats, waitForKeypad } from './fixtures'

// Turn the setting on the way a player would leave it: written to the settings
// blob before the app boots. PipKeypad reads it fresh when it mounts.
async function useSpeedrunKeyboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'elixirdrop:settings'
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
    localStorage.setItem(key, JSON.stringify({ ...stored, speedrunKeyboard: true }))
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
  test('keeps the Practice keypad in the first viewport', async ({ page }) => {
    await page.goto('/#/practice')
    const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
    await expect(keypad).toBeVisible({ timeout: 12_000 })

    const controlsFit = await keypad.evaluate((element) =>
      [...element.querySelectorAll('button')].every(
        (button) => button.getBoundingClientRect().bottom <= window.innerHeight + 1
      )
    )
    expect(controlsFit).toBe(true)
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
    await page.route(`${testApiBaseUrl}/stats`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...testStats, webVersion: 'newer-build' })
      })
    )
    await page.goto('/#/trade')
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    const trade = page.locator('.ed-trade')
    await expect(trade).toBeVisible({ timeout: 12_000 })

    const layout = await trade.evaluate((element) => {
      const game = element.closest('.ed-game')?.getBoundingClientRect()
      const motion = element.querySelector(':scope > .game-motion')?.getBoundingClientRect()
      const blue = element.querySelector('.ed-trade__team--blue')?.getBoundingClientRect()
      const red = element.querySelector('.ed-trade__team--red')?.getBoundingClientRect()
      const prompt = element.querySelector('.ed-trade__prompt')?.getBoundingClientRect()
      const pad = element.querySelector('.ed-trade__pad')?.getBoundingClientRect()
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
  })

  test('keeps the Rain instruction out of the falling-card field', async ({ page }) => {
    await page.goto('/#/rain')
    const hint = page.locator('.ed-rain__hint')
    const field = page.locator('.ed-rain__field')
    await expect(hint).toBeVisible({ timeout: 12_000 })
    await expect(field).toBeVisible()

    const [hintBounds, fieldBounds] = await Promise.all([hint.boundingBox(), field.boundingBox()])
    expect(hintBounds).not.toBeNull()
    expect(fieldBounds).not.toBeNull()
    expect(hintBounds!.y + hintBounds!.height).toBeLessThanOrEqual(fieldBounds!.y + 1)
  })

  // The Speedrun keyboard trades vertical space for tap-target width, so it is
  // the layout most likely to push its own bottom row off screen. Practice is
  // the tightest budget of the four keypad modes (it also renders the input
  // pills), and Rain draws the pad over the falling-cards field.
  test('keeps the speedrun keyboard in the first viewport', async ({ page }) => {
    await useSpeedrunKeyboard(page)
    for (const hash of ['#/surge', '#/survival', '#/practice', '#/rain']) {
      await page.goto(`/${hash}`)
      const keypad = page.getByRole('group', { name: 'Elixir cost keypad' })
      await expect(keypad).toBeVisible({ timeout: 12_000 })
      await expect(keypad.locator('.pip-keypad__row')).toHaveCount(2)

      const controlsFit = await keypad.evaluate((element) =>
        [...element.querySelectorAll('button')].every(
          (button) => button.getBoundingClientRect().bottom <= window.innerHeight + 1
        )
      )
      expect(controlsFit, `speedrun keypad overflows on ${hash}`).toBe(true)
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
    await page.route(`${testApiBaseUrl}/stats`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...testStats, webVersion: 'newer-build' })
      })
    )
    await page.goto('/#/higher-lower')
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
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
    await page.route(`${testApiBaseUrl}/stats`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...testStats, webVersion: 'newer-build' })
      })
    )
    await page.goto('/#/trade')
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    const trade = page.locator('.ed-trade')
    await expect(trade).toBeVisible({ timeout: 12_000 })

    const layout = await trade.evaluate((element) => {
      const game = element.closest('.ed-game')?.getBoundingClientRect()
      const motion = element.querySelector(':scope > .game-motion')?.getBoundingClientRect()
      const blue = element.querySelector('.ed-trade__team--blue')?.getBoundingClientRect()
      const red = element.querySelector('.ed-trade__team--red')?.getBoundingClientRect()
      const prompt = element.querySelector('.ed-trade__prompt')?.getBoundingClientRect()
      const pad = element.querySelector('.ed-trade__pad')?.getBoundingClientRect()
      return {
        gameWidth: game?.width ?? 0,
        boardContained: !!motion && !!blue && !!red && blue.top >= motion.top - 1 && red.bottom <= motion.bottom + 1,
        boardClearsPrompt: !!red && !!prompt && red.bottom <= prompt.top + 1,
        padFits: !!pad && pad.left >= 0 && pad.right <= window.innerWidth + 1 && pad.bottom <= window.innerHeight + 1
      }
    })
    expect(layout.gameWidth).toBeGreaterThanOrEqual(500)
    expect(layout.boardContained).toBe(true)
    expect(layout.boardClearsPrompt).toBe(true)
    expect(layout.padFits).toBe(true)
  })

  // The strict gate: fully in view, top and bottom, on the shortest desktop.
  test('keeps the entire speedrun keyboard in view', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the low-height desktop shell has dedicated viewport coverage')
    await useSpeedrunKeyboard(page)
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
