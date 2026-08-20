import AxeBuilder from '@axe-core/playwright'
import { cardsData, completeSurge, expect, fulfillTestRun, test, testApiBaseUrl, waitForKeypad } from './fixtures'

test('preparing, loading, and countdown keep one stable game stage', { tag: '@deploy' }, async ({ page }, testInfo) => {
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
  const renderedStageBounds = async () => {
    let bounds = await startStage.boundingBox()
    await expect
      .poll(async () => {
        bounds = await startStage.boundingBox()
        return bounds !== null
      })
      .toBe(true)
    return bounds!
  }
  await expect(startStage).toHaveAttribute('data-game-start-phase', 'preparing')
  await expect(modeName).toHaveText('Surge')
  const preparingBounds = await renderedStageBounds()

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
  const loadingBounds = await renderedStageBounds()
  expect(loadingBounds).toEqual(preparingBounds)
  await testInfo.attach('pre-run-loading.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })

  releaseAssets()
  await expect(startStage).toHaveAttribute('data-game-start-phase', 'countdown')
  await expect(modeName).toHaveText('Surge')
  const countdownBounds = await renderedStageBounds()
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

test('desktop can repeat Surge entirely from the home row and Space', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop keyboard loop')
  await page.goto('/#/surge')
  await waitForKeypad(page)

  const homeKeys = ['A', 'S', 'D', 'F', 'G', 'J', 'K', 'L', ';']
  for (let index = 0; index < 15; index += 1) {
    const cardName = await page.locator('.pcard__img').getAttribute('alt')
    const card = cardsData.cards.find((candidate) => candidate.name === cardName)
    expect(card).toBeTruthy()
    await page.keyboard.press(homeKeys[card!.elixir - 1]!)
    if (index < 14) await expect(page.locator('.ed-game__progress')).toHaveText(`Card ${index + 2} / 15`)
  }

  await expect(page.locator('[data-summary]')).toBeVisible()
  await page.keyboard.press('Space')
  await waitForKeypad(page)
  await expect(page.locator('.ed-game__progress')).toHaveText('Card 1 / 15')
})

// This ran twice, once per keypad layout, until the two-row pad became the only
// pad — after which it was the same test twice, in four browsers, presenting as
// coverage of two things.
test(
  'surge accepts a landed iOS touch in the keypad without waiting for click',
  { tag: '@deploy' },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-14', 'This regression is specific to iOS touch event sequencing.')
    await page.addInitScript(() => {
      localStorage.setItem(
        'elixirdrop:settings',
        JSON.stringify({
          inputStyle: 'keypad',
          sound: false,
          reducedMotion: false,
          enhancedEffects: true
        })
      )
    })
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
  }
)

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

test('the surge summary is the one-frame layout without the accuracy chart', async ({ page }, testInfo) => {
  await page.goto('/#/surge')
  await completeSurge(page)

  // The new summary is one frame: the score, "what changed", the signature
  // panel, then share and the actions. The accuracy-by-cost chart and the three
  // generic tiles are gone.
  await expect(page.locator('.ed-sum')).toBeVisible()
  await expect(page.locator('.ed-sum__headline')).toBeVisible()
  await expect(page.locator('.ed-sum-bands')).toHaveCount(0)
  await expect(page.locator('.ed-sum-tiles')).toHaveCount(0)
  // A summary keys no referee at all: every run that just ended is awaiting one,
  // and a referee cannot have cleared a run that ended two seconds ago.
  await expect(page.locator('.ed-sum [aria-label="Referee cleared"]')).toHaveCount(0)
  await expect(page.locator('.ed-sum [aria-label="Awaiting referee"]')).toHaveCount(0)
  await expect(page.locator('.ed-sum')).not.toContainText('Awaiting the referee')
  // The chart states its own unit and scale and reads itself back in a sentence,
  // so height is a quantity rather than a shape.
  await expect(page.locator('.ed-sig__unit')).toHaveText('Seconds per card')
  await expect(page.locator('.ed-sig__scale')).toContainText('0')
  await expect(page.locator('.ed-sig__reading')).not.toBeEmpty()
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()

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

  const shareButton = page.getByRole('button', { name: 'Share this run' })
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
    // The link is a minted permalink to THIS run, never the mode's home. It is
    // what makes the share countable, and what a stranger actually opens.
    url: expect.stringMatching(/#\/r\/[A-Z2-9]{6}$/),
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

// Two things depend on the share function: reach is counted per opened link,
// and the public-profile challenge needs somewhere for a shared run to land.
test('a shared link opens the run itself, with the score as the button', async ({ page }) => {
  await page.goto('/#/r/SHRBBB')

  await expect(page.locator('.ed-sharedrun__score')).toHaveText('17.412s')
  await expect(page.getByRole('button', { name: 'BEAT 17.412s' })).toBeVisible()
  // The player behind it, and nothing the public profile does not already show.
  await expect(page.locator('.ed-sharedrun__player-name')).toHaveText('Knight Main')
  await expect(page.locator('.ed-sharedrun__free')).toContainText('no account needed')

  // The button opens the mode, not the home page.
  await page.getByRole('button', { name: 'BEAT 17.412s' }).click()
  await expect(page).toHaveURL(/#\/surge$/)
})

test('a share mints a new token every time, so reach counts per share', async ({ page }) => {
  // Two complete share-card renders can cross the suite's 30-second ceiling
  // when several WebGL-backed desktop tests contend for the same CI worker.
  // Each individual share still has its own strict 10-second assertion below.
  test.setTimeout(45_000)
  const minted: string[] = []
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload: ShareData) => {
        const seen = (window as unknown as { __sharedUrls?: string[] }).__sharedUrls ?? []
        seen.push(payload.url ?? '')
        ;(window as unknown as { __sharedUrls?: string[] }).__sharedUrls = seen
      }
    })
  })
  await page.goto('/#/surge')
  await completeSurge(page)

  const shareButton = page.getByRole('button', { name: 'Share this run' })
  await shareButton.click()
  await expect(page.getByRole('button', { name: 'Shared' })).toBeVisible({ timeout: 10_000 })
  await expect(shareButton).toBeVisible({ timeout: 10_000 })
  await shareButton.click()
  await expect(page.getByRole('button', { name: 'Shared' })).toBeVisible({ timeout: 10_000 })

  minted.push(...(await page.evaluate(() => (window as unknown as { __sharedUrls?: string[] }).__sharedUrls ?? [])))
  expect(minted).toHaveLength(2)
  expect(minted[0]).not.toBe(minted[1])
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
  await page.getByRole('tab', { name: 'Settings' }).click()
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
