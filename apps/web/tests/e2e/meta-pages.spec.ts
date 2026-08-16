import { expect, isDesktopViewport, test } from './fixtures'

const pages = [
  { slug: 'about', title: 'About Elixir Drop' },
  { slug: 'releases', title: 'Elixir Drop Releases' },
  { slug: 'faq', title: 'Elixir Drop FAQ' },
  { slug: 'fair-play', title: 'Elixir Drop Fair Play' },
  { slug: 'privacy', title: 'Elixir Drop Privacy' },
  { slug: 'install', title: 'Install Elixir Drop' }
] as const

test('all six text pages are standalone, canonical, and responsive', { tag: '@deploy' }, async ({ page }) => {
  for (const meta of pages) {
    await page.goto(`/${meta.slug}/`)
    await expect(page).toHaveURL(new RegExp(`/${meta.slug}/$`))
    await expect(page).toHaveTitle(`${meta.title} | Elixir Drop`)
    await expect(page.getByRole('heading', { name: meta.title, exact: true })).toBeVisible()
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://drop.poapkings.com/${meta.slug}/`
    )
    await expect(page.locator('.static-section')).not.toHaveCount(0)
    await expect(page.locator('.ed-app')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-vite-error-overlay')
    await expect(page.locator('nav[aria-label="Elixir Drop information"] a[aria-current="page"]')).toHaveAttribute(
      'href',
      `/${meta.slug}/`
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(
      false
    )
  }
})

test('legacy hash text routes redirect to their real pages', async ({ page }) => {
  for (const meta of pages) {
    await page.goto(`/#/${meta.slug}`)
    await expect(page).toHaveURL(new RegExp(`/${meta.slug}/$`))
    await expect(page.getByRole('heading', { name: meta.title, exact: true })).toBeVisible()
  }
})

test('the app shells link to real pages and keep Discord external', async ({ page, viewport }) => {
  if (isDesktopViewport(viewport)) await page.goto('/')
  else await page.goto('/#/profile')

  const scope = page.locator(isDesktopViewport(viewport) ? '.ed-railfoot' : '.ed-morelist')
  await expect(scope.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about/')
  await expect(scope.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/faq/')
  await expect(scope.getByRole('link', { name: 'Fair Play' })).toHaveAttribute('href', '/fair-play/')
  await expect(scope.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy/')

  const discord = scope.getByRole('link', { name: /Discord/ })
  await expect(discord).toHaveAttribute('href', 'https://discord.gg/SdvKfJW5kA')
  await expect(discord).toHaveAttribute('target', '_blank')
  await expect(discord).toHaveAttribute('rel', 'noopener noreferrer')

  if (isDesktopViewport(viewport)) {
    const boxes = await scope.locator('a.ed-railfoot__link').evaluateAll((links) =>
      links.map((link) => {
        const rect = link.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      })
    )
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        const a = boxes[left]!
        const b = boxes[right]!
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true)
      }
    }
  }
})

test('contact and Fair Play review mail go to the Drop mailbox', async ({ page }) => {
  await page.goto('/about/')
  await expect(page.getByRole('link', { name: 'drop@poapkings.com' }).first()).toHaveAttribute(
    'href',
    'mailto:drop@poapkings.com'
  )
  await expect(page.getByText(/Sign-in magic links come from elixir@poapkings.com/)).toBeVisible()

  await page.goto('/fair-play/')
  await expect(page.getByRole('link', { name: 'drop@poapkings.com' }).first()).toHaveAttribute(
    'href',
    'mailto:drop@poapkings.com?subject=Elixir%20Drop%20Fair%20Play%20re-review'
  )
})
