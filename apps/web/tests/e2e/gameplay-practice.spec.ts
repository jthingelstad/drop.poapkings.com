import { allowBlockedAssets, cardsData, expect, test, waitForKeypad } from './fixtures'

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

test('practice uses Surge feedback and keeps a missed card active until solved', async ({ page }, testInfo) => {
  await page.goto('/#/practice')
  await waitForKeypad(page)

  const motion = page.locator('.game-motion')
  await expect(motion).toHaveClass(/game-motion--card/)
  const cardName = await page.locator('.pcard__img').getAttribute('alt')
  const card = cardsData.cards.find((candidate) => candidate.name === cardName)
  expect(card).toBeTruthy()
  expect(card!.elixir).toBeGreaterThan(1)
  expect(card!.elixir).toBeLessThan(9)

  await page.getByRole('button', { name: `${card!.elixir - 1} elixir`, exact: true }).click()
  await expect(page.getByTestId('practice-hint')).toContainText('Higher')
  await expect(page.locator('.ed-game__progress')).toHaveText('Card 1 / 15')
  await expect(page.locator('.pcard__cost')).toHaveCount(0)
  await expect(page.locator('.pcard__img')).toHaveAttribute('alt', card!.name)

  await expect(page.getByRole('button', { name: `${card!.elixir + 1} elixir`, exact: true })).toBeEnabled()
  await page.getByRole('button', { name: `${card!.elixir + 1} elixir`, exact: true }).click()
  await expect(page.getByTestId('practice-hint')).toContainText('Lower')
  await expect(page.locator('.ed-game__progress')).toHaveText('Card 1 / 15')
  await expect(page.locator('.pcard__img')).toHaveAttribute('alt', card!.name)

  await testInfo.attach('practice-wrong-feedback.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })

  await expect(page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true })).toBeEnabled()
  await page.getByRole('button', { name: `${card!.elixir} elixir`, exact: true }).click()
  const feedback = await motion.evaluate((element) => ({
    className: element.className,
    phaseClass: element.querySelector('.pcard')?.className,
    costBadges: element.querySelectorAll('.pcard__cost').length,
    purpleDrops: element.querySelectorAll('.drop-pop-wrap').length
  }))
  expect(feedback.className).toContain('game-motion--card')
  expect(feedback.phaseClass).toContain('pcard')
  expect(feedback.costBadges).toBe(0)
  expect(feedback.purpleDrops).toBe(0)

  await testInfo.attach('practice-correct-motion.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
  await expect(page.locator('.ed-game__progress')).toHaveText('Card 2 / 15')
})

test('card art fallback renders when card images cannot load', async ({ page }) => {
  allowBlockedAssets.add(page)
  // Card art is mirrored same-origin under /cards/; block that path.
  await page.route('**/cards/*.png', (route) => route.abort())
  await page.goto('/')
  await page.goto('/#/practice')
  await expect(page.locator('.pcard__fallback')).toBeVisible({ timeout: 12_000 })
})
