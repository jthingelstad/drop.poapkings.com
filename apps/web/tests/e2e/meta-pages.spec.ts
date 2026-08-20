import { expect, isDesktopViewport, test } from './fixtures'

const pages = [
  { slug: 'games', title: 'Elixir Drop Game Modes', primary: true },
  { slug: 'learn-elixir-costs', title: 'Learn Clash Royale Elixir Costs', primary: true },
  { slug: 'elixir-costs', title: 'Clash Royale Elixir Costs', primary: false },
  { slug: 'badges', title: 'Elixir Drop Badges', primary: false },
  { slug: 'discord', title: 'Elixir Drop Discord', primary: true },
  { slug: 'install', title: 'Elixir Drop Game Setup', primary: true },
  { slug: 'fair-play', title: 'Elixir Drop Fair Play', primary: true },
  { slug: 'about', title: 'About Elixir Drop', primary: true },
  { slug: 'faq', title: 'Elixir Drop FAQ', primary: true },
  { slug: 'privacy', title: 'Elixir Drop Privacy', primary: true },
  { slug: 'releases', title: 'Elixir Drop Releases', primary: true }
] as const

test('all text pages are standalone, canonical, and responsive', { tag: '@deploy' }, async ({ page }) => {
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
    const current = page.locator('a[aria-current="page"]')
    if (meta.primary) await expect(current).toHaveAttribute('href', `/${meta.slug}/`)
    else await expect(current).toHaveCount(0)
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

test('the app shells link to real pages and the Discord guide', async ({ page, viewport }) => {
  // The About-Drop links live in the You page's Account scope on every width.
  // The desktop aside used to repeat them; gathering them in one place was the
  // point of the structure pass, so the rail cluster went with the repetition.
  await page.goto('/#/profile')
  await page.getByRole('tab', { name: 'Account' }).click()

  const scope = page.locator('.ed-account__links')
  await expect(scope.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about/')
  await expect(scope.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/faq/')
  await expect(scope.getByRole('link', { name: 'Fair Play' })).toHaveAttribute('href', '/fair-play/')
  await expect(scope.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy/')

  const discord = scope.getByRole('link', { name: /Discord/ })
  await expect(discord).toHaveAttribute('href', '/discord/')

  await expect(scope.getByRole('link', { name: 'Game Setup' })).toHaveAttribute('href', '/install/')

  if (isDesktopViewport(viewport)) {
    await expect(page.locator('.ed-railfoot')).toHaveCount(0)
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

test('generated guides expose the canonical public content without revealing hidden badges', async ({ page }) => {
  await page.goto('/games/')
  await expect(page.locator('.static-mode')).toHaveCount(6)
  await expect(page.getByRole('link', { name: 'Play Surge' })).toHaveAttribute('href', '/#/surge')
  await expect(page.getByRole('link', { name: 'Fair Play' }).first()).toHaveAttribute('href', '/fair-play/')
  await expect(page.getByText('Ledger', { exact: true })).toHaveCount(0)

  await page.goto('/learn-elixir-costs/')
  await expect(page.getByText('Ledger', { exact: true })).toHaveCount(0)

  await page.goto('/elixir-costs/')
  await expect(page.locator('.static-card-grid li')).toHaveCount(120)
  await expect(page.getByText('Three Musketeers', { exact: true })).toBeVisible()

  await page.goto('/badges/')
  await expect(page.locator('.static-badge')).toHaveCount(22)
  await expect(page.getByRole('heading', { name: '7 hidden badges' })).toBeVisible()
  const badge = (name: string) =>
    page.locator('.static-badge').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await expect(badge('Bridge Read')).toContainText('4,000 · 5,000')
  await expect(badge('Stormchaser')).toContainText('8,500 · 10,000')
  await expect(badge('Reps')).toContainText('8,000 · 10,000')
  await expect(badge('Spellcaster')).toContainText('2,500 · 3,000')
  await expect(badge('Sharp Trade')).toContainText('50s · 40s')
  await expect(page.getByText('Night Shift', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/midnight and 5:00/)).toHaveCount(0)

  await page.goto('/discord/')
  await expect(page.getByRole('link', { name: 'Join the Elixir Drop Discord' })).toHaveAttribute(
    'href',
    'https://discord.gg/SdvKfJW5kA'
  )

  await page.goto('/install/')
  await expect(page.getByText(/All six games available/)).toBeVisible()
  await expect(page.getByText(/never uploaded later/)).toBeVisible()
})
