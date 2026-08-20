import AxeBuilder from '@axe-core/playwright'
import { expect, isDesktopViewport, test } from './fixtures'

test('the desktop rail defaults Falling Cards off, then cycles through subtle, background, and full screen', async ({
  page,
  viewport
}) => {
  test.skip(!isDesktopViewport(viewport), 'the visible screensaver launcher is a desktop-rail control')
  await page.goto('/')

  const backgroundCanvas = page.locator('.ed-wallpaper canvas')
  await expect(backgroundCanvas).toHaveCount(1)
  await expect(backgroundCanvas).toBeHidden()
  await backgroundCanvas.evaluate((canvas) => canvas.setAttribute('data-persistence-check', 'mounted'))

  const launcher = page.getByRole('button', { name: 'Falling Cards' })
  await expect(launcher).toBeVisible()
  await expect(launcher).toContainText('Subtle →')
  await launcher.click()
  await expect(backgroundCanvas).toBeVisible()
  await expect(backgroundCanvas).toHaveAttribute('data-persistence-check', 'mounted')
  await expect(page.locator('.ed-wallpaper')).toHaveClass(/ed-wallpaper--subtle/)
  await expect(page.locator('.ed-desktop')).toBeVisible()
  await expect(launcher).toContainText('Background →')

  await launcher.click()
  await expect(backgroundCanvas).toBeVisible()
  await expect(backgroundCanvas).toHaveAttribute('data-persistence-check', 'mounted')
  await expect(page.locator('.ed-wallpaper')).not.toHaveClass(/ed-wallpaper--subtle/)
  await expect(page.locator('.ed-desktop')).toBeVisible()
  await expect(launcher).toContainText('Full screen →')

  await launcher.click()

  const overlay = page.getByTestId('screensaver')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveClass(/screensaver--desktop-background/)
  await expect(overlay.locator('canvas')).toHaveCount(0)
  await expect(page.locator('.ed-app--screensaver')).toHaveCount(1)
  await expect(page.locator('.ed-desktop')).toBeHidden()
  await expect(page.locator('.ed-wallpaper canvas')).toHaveAttribute('data-persistence-check', 'mounted')
  // Any input dismisses the screensaver; the Escape key lands as a keydown exit
  // (the overlay traps focus so the capture-phase handler catches it).
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
  await expect(page.locator('.ed-desktop')).toBeVisible()
  await expect(page.locator('.ed-wallpaper canvas')).toBeHidden()
  await expect(page.locator('.ed-wallpaper canvas')).toHaveAttribute('data-persistence-check', 'mounted')
  await expect(launcher).toContainText('Subtle →')

  // The next press restores the Subtle background without hiding the panels.
  await launcher.click()
  await expect(page.locator('.ed-wallpaper canvas')).toBeVisible()
  await expect(page.locator('.ed-wallpaper canvas')).toHaveAttribute('data-persistence-check', 'mounted')
  await expect(page.locator('.ed-wallpaper')).toHaveClass(/ed-wallpaper--subtle/)
  await expect(page.locator('.ed-desktop')).toBeVisible()
  await expect(launcher).toContainText('Background →')
})

test('five logo taps start the screensaver and any key exits it', async ({ page, isMobile }) => {
  // The redesign's logo-tap door is the mobile "More games" title (there is no
  // tapped hero logo on desktop — desktop uses the visible "Falling Cards" rail
  // launcher instead, covered above).
  test.skip(!isMobile, 'the logo-tap screensaver door exists on the mobile shell')
  await page.goto('/')
  // The logo-tap door is wired to the first "More games" title ("The other four");
  // the redesign added a second .ed-more__title for the Practice list.
  const logo = page.locator('.ed-more__title').first()
  await expect(logo).toBeVisible()
  for (let tap = 0; tap < 5; tap += 1) await logo.click()

  const overlay = page.getByTestId('screensaver')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('role', 'dialog')
  await expect(overlay.locator('canvas')).toBeVisible()
  const axe = await new AxeBuilder({ page }).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  // Any input dismisses the screensaver — the Escape key lands as a keydown exit
  // (the overlay traps focus, so the key is caught in the capture phase).
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
  await expect(page.locator('.ed-home')).toBeVisible()
})
