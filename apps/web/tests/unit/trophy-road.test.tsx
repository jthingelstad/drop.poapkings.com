import { describe, expect, it } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import RANKS, { rankFor } from '../../src/data/starRanks'
import ArenaProgress from '../../src/components/ArenaProgress'

describe('per-player arena (Trophy Road)', () => {
  it('thresholds arenas on lifetime Player XP', () => {
    expect(rankFor(0).current.name).toBe('Goblin Stadium')
    expect(rankFor(39).current.name).toBe('Goblin Stadium')
    expect(rankFor(40).current.name).toBe('Bone Pit')
    expect(rankFor(200).current.name).toBe('Spell Valley')
    expect(rankFor(68_000).current.name).toBe('Summit of Heroes')
    expect(RANKS.every((rank, index) => index === 0 || rank.threshold > RANKS[index - 1]!.threshold)).toBe(true)
  })

  it('renders the current arena and XP-to-next progress', async () => {
    const html = await renderToStringAsync(<ArenaProgress xp={39} />)
    expect(html).toContain('Goblin Stadium')
    expect(html).toContain('39 XP')
    // 1 XP short of Bone Pit (threshold 40).
    expect(html).toContain('1 XP to Bone Pit')
    expect(html).not.toContain('games')
  })

  it('caps at the summit without a next-arena label', async () => {
    const html = await renderToStringAsync(<ArenaProgress xp={68_000} />)
    expect(html).toContain('Summit of Heroes')
    expect(html).toContain('Top arena reached.')
  })
})
