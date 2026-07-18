import { describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { renderToStringAsync } from 'preact-render-to-string'
import StarCount from '../../src/components/StarCount'
import TrophyModal from '../../src/components/TrophyModal'
import RANKS, { rankFor } from '../../src/data/starRanks'
import { TROPHY_ROAD_UPDATED_EVENT } from '../../src/lib/trophy-road'

describe('site-wide Trophy Road', () => {
  it('uses completed-game-scale arena thresholds', () => {
    expect(rankFor(49).current.name).toBe('Goblin Stadium')
    expect(rankFor(50).current.name).toBe('Bone Pit')
    expect(rankFor(100).current.name).toBe('Spell Valley')
    expect(rankFor(17_250).current.name).toBe('Summit of Heroes')
    expect(RANKS.every((rank, index) => index === 0 || rank.threshold > RANKS[index - 1]!.threshold)).toBe(true)
  })

  it('describes recorded games without page-view language', async () => {
    const html = await renderToStringAsync(<TrophyModal trophyRoadGames={49} onClose={vi.fn()} />)

    expect(html).toContain('Every completed, recorded Drop game adds one to the whole site’s road.')
    expect(html).toContain('49 Drop games')
    expect(html).toContain('1 game away from Bone Pit.')
    expect(html).not.toContain('visits')
  })

  it('refreshes the server-owned counter after a game is recorded', async () => {
    let trophyRoadGames = 592
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api-config.json')) {
        return new Response(JSON.stringify({ apiBaseUrl: 'https://api.example' }), { status: 200 })
      }
      return new Response(JSON.stringify({ trophyRoadGames }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const root = document.createElement('div')

    render(<StarCount />, root)
    await vi.waitFor(() => expect(root.querySelector('.starcount__n')?.textContent).toBe('592'))

    trophyRoadGames = 593
    window.dispatchEvent(new Event(TROPHY_ROAD_UPDATED_EVENT))
    await vi.waitFor(() => expect(root.querySelector('.starcount__n')?.textContent).toBe('593'))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    render(null, root)
    vi.unstubAllGlobals()
  })
})
