import { afterEach, describe, expect, it } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import { BADGE_LIST } from '@elixir-drop/contracts'
import { activeInterrupt, updateStripDismissed } from '../../src/lib/interrupt-ladder'
import ChargeRing from '../../src/components/ChargeRing'
import UpdateBanner from '../../src/components/UpdateBanner'
import BadgeCelebration from '../../src/components/BadgeCelebration'
import { route } from '../../src/lib/router'
import { updateAvailable } from '../../src/lib/version'
import { earnedBadges } from '../../src/lib/use-game-run'
import { player } from '../../src/lib/account'

const render = (node: Parameters<typeof renderToStringAsync>[0]) => renderToStringAsync(node)

afterEach(() => {
  route.value = '/'
  updateAvailable.value = false
  updateStripDismissed.value = false
  earnedBadges.value = []
  player.value = null
})

// --- The pure gate ---------------------------------------------------------

describe('interrupt ladder gate', () => {
  const base = { onPlaySurface: false, badgeEarned: false, updateReady: false, updateDismissed: false }

  it('lets the badge celebration take a summary (tier 1)', () => {
    expect(activeInterrupt({ ...base, onPlaySurface: true, badgeEarned: true })).toBe(1)
  })

  it('lets nothing else cover a run or a summary — a lower tier waits, it does not queue', () => {
    // On a play surface with an update pending but no badge, the strip must not
    // show; it waits for an idle screen rather than queueing behind the run.
    expect(activeInterrupt({ ...base, onPlaySurface: true, updateReady: true })).toBeNull()
  })

  it('shows the update strip on an idle screen (tier 4)', () => {
    expect(activeInterrupt({ ...base, updateReady: true })).toBe(4)
  })

  it('keeps a dismissed update strip gone', () => {
    expect(activeInterrupt({ ...base, updateReady: true, updateDismissed: true })).toBeNull()
  })

  it('shows nothing on a quiet idle screen', () => {
    expect(activeInterrupt(base)).toBeNull()
  })
})

// --- Charge ring -----------------------------------------------------------

describe('ChargeRing', () => {
  it('fills the gold slot and says Charging', async () => {
    const html = await render(<ChargeRing />)
    expect(html).toContain('charge-ring')
    expect(html).toContain('charge-ring__arc')
    expect(html).toContain('>Charging<')
  })

  it('has a reconnecting variant that holds and adds the offline reassurance', async () => {
    const html = await render(<ChargeRing variant="reconnecting" />)
    expect(html).toContain('charge-ring--reconnecting')
    expect(html).toContain('>Reconnecting<')
    expect(html).toContain('Games still work from this device')
  })
})

// --- The two overlays consult the gate -------------------------------------

describe('UpdateBanner (tier 4 strip)', () => {
  it('shows the no-scrim strip on an idle screen when an update is ready', async () => {
    route.value = '/'
    updateAvailable.value = true
    const html = await render(<UpdateBanner />)
    expect(html).toContain('update-strip')
    expect(html).toContain('A new version of Elixir Drop is ready.')
  })

  it('never shows over a run or summary', async () => {
    route.value = '/surge'
    updateAvailable.value = true
    const html = await render(<UpdateBanner />)
    expect(html).not.toContain('update-strip')
  })
})

describe('BadgeCelebration (tier 1 takeover)', () => {
  it('celebrates a just-earned rung on the summary, with Carry on', async () => {
    route.value = '/surge'
    const badge = BADGE_LIST[0]
    earnedBadges.value = [{ slug: badge.slug, rungIndex: 0, value: badge.rungs[0], at: '2026-08-18T00:00:00.000Z' }]
    const html = await render(<BadgeCelebration />)
    expect(html).toContain('badge-celebrate')
    expect(html).toContain('Rung cleared')
    expect(html).toContain('Carry on')
    expect(html).toContain(badge.name)
  })

  it('does not fire off a summary (no game route)', async () => {
    route.value = '/'
    const badge = BADGE_LIST[0]
    earnedBadges.value = [{ slug: badge.slug, rungIndex: 0, value: badge.rungs[0], at: '2026-08-18T00:00:00.000Z' }]
    const html = await render(<BadgeCelebration />)
    expect(html).not.toContain('badge-celebrate')
  })
})
