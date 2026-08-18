import AxeBuilder from '@axe-core/playwright'
import { expect, isDesktopViewport, test } from './fixtures'

test('the desktop rail launches the Falling Cards screensaver', async ({ page, viewport }) => {
  test.skip(!isDesktopViewport(viewport), 'the visible screensaver launcher is a desktop-rail control')
  await page.goto('/')

  const launcher = page.getByRole('button', { name: 'Falling Cards' })
  await expect(launcher).toBeVisible()
  await launcher.click()

  const overlay = page.getByTestId('screensaver')
  await expect(overlay).toBeVisible()
  // Any input dismisses the screensaver; the Escape key lands as a keydown exit
  // (the overlay traps focus so the capture-phase handler catches it).
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
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
  const axe = await new AxeBuilder({ page }).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  // Any input dismisses the screensaver — the Escape key lands as a keydown exit
  // (the overlay traps focus, so the key is caught in the capture phase).
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
  await expect(page.locator('.ed-home')).toBeVisible()
})
