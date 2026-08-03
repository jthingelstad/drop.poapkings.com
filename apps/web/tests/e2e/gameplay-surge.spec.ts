import AxeBuilder from '@axe-core/playwright'
import { cardsData, completeSurge, expect, fulfillTestRun, test, testApiBaseUrl, waitForKeypad } from './fixtures'

test('preparing, loading, and countdown keep one stable game stage', async ({ page }, testInfo) => {
  let releaseStart!: () => void
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve
  })
  await page.route(`${testApiBaseUrl}/runs/start`, async (route) => {
    await startGate
    await fulfillTestRun(route)
  })

  await page.goto('/#/surge')
  const startStage = page.locator('[data-game-start-phase]')
  const modeName = page.locator('.ed-game__count-mode')
  await expect(startStage).toHaveAttribute('data-game-start-phase', 'preparing')
  await expect(modeName).toHaveText('Surge')
  const preparingBounds = await startStage.boundingBox()
  expect(preparingBounds).not.toBeNull()

  let releaseAssets!: () => void
  const assetGate = new Promise<void>((resolve) => {
    releaseAssets = resolve
  })
  await page.route('**/cards/*.png', async (route) => {
    await assetGate
    await route.continue()
  })

  releaseStart()
  await expect(startStage).toHaveAttribute('data-game-start-phase', 'loading')
  await expect(modeName).toHaveText('Surge')
  const loadingBounds = await startStage.boundingBox()
  expect(loadingBounds).toEqual(preparingBounds)
  await testInfo.attach('pre-run-loading.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })

  releaseAssets()
  await expect(startStage).toHaveAttribute('data-game-start-phase', 'countdown')
  await expect(modeName).toHaveText('Surge')
  const countdownBounds = await startStage.boundingBox()
  expect(countdownBounds).toEqual(preparingBounds)
  await expect(page.locator('.ed-gameloading')).toHaveCount(0)
  await expect(page.locator('.route-loading__spinner')).toHaveCount(0)
  await testInfo.attach('pre-run-countdown.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
})

test('countdown uses standalone gold display text', async ({ page }) => {
  await page.goto('/#/surge')

  const numeral = page.locator('.run-count__num')
  await expect(numeral).toBeVisible()
  await expect(numeral).toHaveCSS('color', 'rgb(245, 200, 76)')
  await expect(page.locator('.run-count img')).toHaveCount(0)
  await expect(page.locator('.run-count__ring')).toHaveCount(0)
})

for (const speedrunKeyboard of [false, true]) {
  const layout = speedrunKeyboard ? 'speedrun' : 'normal'
  test(`surge accepts a landed iOS touch in the ${layout} keypad without waiting for click`, async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-14', 'This regression is specific to iOS touch event sequencing.')
    await page.addInitScript((speedrun) => {
      localStorage.setItem(
        'elixirdrop:settings',
        JSON.stringify({
          inputStyle: 'keypad',
          sound: false,
          reducedMotion: false,
          enhancedEffects: true,
          speedrunKeyboard: speedrun
        })
      )
    }, speedrunKeyboard)
    await page.goto('/#/surge')
    await waitForKeypad(page)

    const cardImage = page.locator('.pcard__img')
    const initialCardName = await cardImage.getAttribute('alt')
    const card = cardsData.cards.find((candidate) => candidate.name === initialCardName)
    expect(card).toBeTruthy()

    // This is the exact sequence seen in the field: Safari delivers the touch
    // (and the key flourish runs), but its later compatibility click can be
    // absent. One landed primary touch must still solve and advance the card.
    await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      bubbles: true,
      cancelable: true
    })
    await expect.poll(() => cardImage.getAttribute('alt')).not.toBe(initialCardName)

    // Follow it with a complete emulated touchscreen tap on the next card. The
    // pointerdown and compatibility click together must still advance exactly
    // once, never consume the card after it.
    const secondCardName = await cardImage.getAttribute('alt')
    const secondCard = cardsData.cards.find((candidate) => candidate.name === secondCardName)
    expect(secondCard).toBeTruthy()
    const secondButton = page.getByRole('button', { name: `${secondCard!.elixir} elixir`, exact: true })
    const bounds = await secondButton.boundingBox()
    expect(bounds).not.toBeNull()
    await page.touchscreen.tap(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await expect(page.locator('.ed-game__progress')).toHaveText('Card 3 / 15')
    await page.waitForTimeout(350)
    await expect(page.locator('.ed-game__progress')).toHaveText('Card 3 / 15')
  })
}

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

test('completed runs share a 1080x1350 score card with game, score, and Elixir Drop link', async ({
  page
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (payload: ShareData) => Boolean(payload.files?.length)
    })
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
  await expect(page.getByRole('button', { name: 'Shared' })).toBeVisible({ timeout: 10_000 })
  const payload = await page.evaluate(async () => {
    const shared = (window as unknown as { __runSharePayload?: ShareData }).__runSharePayload
    const file = shared?.files?.[0]
    let dimensions: { width: number; height: number } | undefined
    let imageBase64: string | undefined
    if (file) {
      // PNG stores its big-endian width/height in the IHDR header. Reading the
      // bytes avoids loading a blob: URL, which the production img-src CSP
      // deliberately disallows.
      const header = new DataView(await file.slice(0, 24).arrayBuffer())
      dimensions = { width: header.getUint32(16), height: header.getUint32(20) }
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 16_384) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
      }
      imageBase64 = btoa(binary)
    }
    return {
      title: shared?.title,
      text: shared?.text,
      url: shared?.url,
      file: file ? { name: file.name, type: file.type, size: file.size, ...dimensions } : undefined,
      imageBase64
    }
  })
  expect(payload).toMatchObject({
    title: expect.stringContaining('Knight Main · Surge:'),
    text: expect.stringMatching(/Knight Main scored .+ in Surge on Elixir Drop\. Can you beat it\?/),
    url: expect.stringMatching(/#\/surge$/),
    file: {
      name: 'elixir-drop.png',
      type: 'image/png',
      size: expect.any(Number),
      width: 1080,
      height: 1350
    }
  })
  expect(payload.file!.size).toBeGreaterThan(50_000)
  await testInfo.attach('share-card.png', {
    body: Buffer.from(payload.imageBase64!, 'base64'),
    contentType: 'image/png'
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
