import type { Page } from '@playwright/test'
import { cardsData, expect, test } from './fixtures'

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
