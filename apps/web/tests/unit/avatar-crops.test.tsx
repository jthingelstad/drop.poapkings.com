import { describe, expect, it } from 'vitest'
import { render } from 'preact'
import { renderToStringAsync } from 'preact-render-to-string'
import rawCards from '@elixir-drop/game-data/cards.json'
import PlayerAvatar from '../../src/components/PlayerAvatar'
import { avatarCrop, hasAvatarCropOverride } from '../../src/data/avatar-crops'
import AvatarAudit from '../../src/screens/AvatarAudit'
import type { CardsData } from '../../src/types'

const canonicalCardCount = (rawCards as CardsData).cards.length

describe('player avatar crops', () => {
  it('falls back to the default crop for a card outside the snapshot', () => {
    expect(avatarCrop(99999999)).toEqual({ x: 50, y: 48, scale: 1.21 })
    expect(hasAvatarCropOverride(99999999)).toBe(false)
  })

  it('carries a hand-set crop for every card in the canonical snapshot', () => {
    // Every crop was set by hand against the frame's inner edge, so a card
    // arriving without one would be the only avatar showing card border.
    const missing = (rawCards as CardsData).cards.filter((card) => !hasAvatarCropOverride(card.id))
    expect(missing.map((card) => card.name)).toEqual([])
  })

  it('supports per-card focal adjustments', () => {
    expect(avatarCrop(26000037)).toEqual({ x: 33, y: 43, scale: 1.28 })
    expect(avatarCrop(26000106)).toEqual({ x: 39, y: 49, scale: 1.37 })
  })

  it('passes crop coordinates to every rendered card avatar', async () => {
    const html = await renderToStringAsync(<PlayerAvatar favoriteCardId={26000037} size="large" />)

    expect(html).toContain('--avatar-x:33%')
    expect(html).toContain('--avatar-y:43%')
    expect(html).toContain('--avatar-scale:1.28')
    expect(html).toContain('Inferno Dragon favorite card')
  })

  it('renders the complete canonical catalog in the development audit', async () => {
    const html = await renderToStringAsync(<AvatarAudit />)

    expect(html.match(/data-card-id=/g)).toHaveLength(canonicalCardCount)
    expect(html).toContain('Avatar crop audit')
    expect(html).toContain(`${canonicalCardCount} cards · 52px`)
  })

  it('falls back to the app drop mark when a card image cannot load', async () => {
    const container = document.createElement('div')
    render(<PlayerAvatar favoriteCardId={26000037} size="medium" />, container)
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toContain('/cards/26000037.png')

    image?.dispatchEvent(new Event('error'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(container.querySelector('.player-avatar--fallback')).not.toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/icon/drop-icon-192.png')
    render(<></>, container)
  })
})
