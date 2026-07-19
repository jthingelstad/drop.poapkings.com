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
  it('uses one consistent default crop for canonical card art', () => {
    expect(avatarCrop(26000000)).toEqual({ x: 50, y: 48, scale: 1.06 })
    expect(hasAvatarCropOverride(26000000)).toBe(false)
  })

  it('supports small per-card focal adjustments', () => {
    expect(avatarCrop(26000037)).toEqual({ x: 50, y: 44, scale: 1.1 })
    expect(hasAvatarCropOverride(26000037)).toBe(true)
    expect(avatarCrop(26000106)).toEqual({ x: 50, y: 43, scale: 1.65 })
    expect(hasAvatarCropOverride(26000106)).toBe(true)
  })

  it('passes crop coordinates to every rendered card avatar', async () => {
    const html = await renderToStringAsync(<PlayerAvatar favoriteCardId={26000037} size="large" />)

    expect(html).toContain('--avatar-x:50%')
    expect(html).toContain('--avatar-y:44%')
    expect(html).toContain('--avatar-scale:1.1')
    expect(html).toContain('Inferno Dragon favorite card')
  })

  it('renders the complete canonical catalog in the development audit', async () => {
    const html = await renderToStringAsync(<AvatarAudit />)

    expect(html.match(/data-card-id=/g)).toHaveLength(canonicalCardCount)
    expect(html).toContain('Avatar crop audit')
    expect(html).toContain(`${canonicalCardCount} cards · 52px`)
  })

  it('falls back to Elixir when a card image cannot load', async () => {
    const container = document.createElement('div')
    render(<PlayerAvatar favoriteCardId={26000037} size="medium" />, container)
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toContain('/cards/26000037.png')

    image?.dispatchEvent(new Event('error'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(container.querySelector('.player-avatar--fallback')).not.toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/emoji/elixir.png')
    render(<></>, container)
  })
})
