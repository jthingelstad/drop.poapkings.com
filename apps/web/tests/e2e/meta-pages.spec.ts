import { expect, isDesktopViewport, test } from './fixtures'

test('About, Releases, FAQ, Fair Play, and Privacy share one stable responsive page layout', async ({
  page,
  viewport
}) => {
  const routes = [
    { hash: 'about', title: 'About Elixir Drop' },
    { hash: 'releases', title: 'Release history' },
    { hash: 'faq', title: 'Frequently asked' },
    { hash: 'fair-play', title: 'Fair Play' },
    { hash: 'privacy', title: 'What Drop keeps—and why' }
  ] as const
  let referencePage: { left: number; width: number } | null = null

  for (const meta of routes) {
    await page.goto(`/#/${meta.hash}`)
    const pageSurface = page.locator('.ed-page')
    await expect(pageSurface).toBeVisible()
    await expect(pageSurface.getByRole('heading', { name: meta.title, exact: true })).toBeVisible()
    await expect(pageSurface.locator('.ed-meta-section')).not.toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-vite-error-overlay')

    const box = await pageSurface.boundingBox()
    expect(box).not.toBeNull()
    if (referencePage) {
      expect(Math.abs(box!.x - referencePage.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(box!.width - referencePage.width)).toBeLessThanOrEqual(1)
    } else {
      referencePage = { left: box!.x, width: box!.width }
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflow).toBe(false)

    if (isDesktopViewport(viewport)) {
      await expect(page.locator('.ed-rail__foot')).toBeVisible()
      const shell = await page.locator('.ed-desktop').evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        viewportHeight: document.documentElement.clientHeight,
        documentScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight
      }))
      expect(Math.abs(shell.height - shell.viewportHeight)).toBeLessThanOrEqual(1)
      expect(shell.documentScrolls).toBe(false)

      const linkTops = await page
        .locator('.ed-railfoot__link')
        .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().top)))
      expect(Math.max(...linkTops) - Math.min(...linkTops)).toBeLessThanOrEqual(3)
    } else {
      await expect(page.locator('.ed-desktop')).toHaveCount(0)
    }
  }

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/\/#\/fair-play$/)
  await expect(page.getByRole('article').getByRole('heading', { name: 'Fair Play', exact: true })).toBeVisible()
})

test('the meta entry points link to the Elixir Drop Discord', async ({ page, viewport }) => {
  // The old global footer moved into the meta entry points: the desktop
  // left-rail cluster, and the mobile Profile → More list.
  const desktop = isDesktopViewport(viewport)
  if (desktop) {
    await page.goto('/')
  } else {
    await page.goto('/#/profile')
  }

  const scope = desktop ? '.ed-railfoot' : '.ed-morelist'
  const discord = page.locator(`${scope} a`, { hasText: 'Discord' })
  await expect(discord).toBeVisible()
  await expect(discord).toHaveAttribute('href', 'https://discord.gg/SdvKfJW5kA')
  await expect(discord).toHaveAttribute('target', '_blank')
  await expect(discord).toHaveAttribute('rel', 'noopener noreferrer')
})

test('contact and Fair Play review mail go to the Drop mailbox', async ({ page }) => {
  await page.goto('/#/about')
  const generalContact = page.getByRole('link', { name: 'drop@poapkings.com' })
  await expect(generalContact).toHaveAttribute('href', 'mailto:drop@poapkings.com')
  await expect(page.getByText(/Sign-in magic links still come from elixir@poapkings.com/)).toBeVisible()

  await page.goto('/#/fair-play')
  const reviewContact = page.getByRole('link', { name: 'drop@poapkings.com' })
  await expect(reviewContact).toHaveAttribute(
    'href',
    'mailto:drop@poapkings.com?subject=Elixir%20Drop%20Fair%20Play%20re-review'
  )
})
