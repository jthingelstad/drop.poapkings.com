import { render, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BadgeEarned from '../../src/components/BadgeEarned'
import BadgeGrid from '../../src/components/BadgeGrid'
import DetailModal from '../../src/components/DetailModal'
import type { BadgeState } from '../../src/lib/badges'
import { player } from '../../src/lib/account'

const shareMock = vi.hoisted(() => ({
  prepareBadgeShare: vi.fn()
}))

const analyticsMock = vi.hoisted(() => ({
  track: vi.fn()
}))

vi.mock('../../src/lib/share-badge', () => shareMock)
vi.mock('../../src/lib/analytics', () => analyticsMock)

let host: HTMLDivElement

function draw(node: ComponentChildren): void {
  void act(() => {
    render(node, host)
  })
}

async function click(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

function badgeState(slug: string, value: number, rungIndex: number, runsAtRung?: number[]): BadgeState {
  return {
    slug,
    value,
    rungIndex,
    earnedAt: ['2026-08-02T12:00:00.000Z'],
    ...(runsAtRung ? { runsAtRung } : {})
  }
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === name || candidate.textContent?.trim() === name
  )
  if (!button) throw new Error(`Button not found: ${name}`)
  return button
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  shareMock.prepareBadgeShare.mockReset()
  shareMock.prepareBadgeShare.mockResolvedValue('https://drop.poapkings.com/share/P1111111111/badge/clockbreaker/4')
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  analyticsMock.track.mockReset()
  player.value = { id: 'signed-in-player' } as never
})

afterEach(() => {
  render(null, host)
  host.remove()
  document.body.classList.remove('modal-open')
  vi.useRealTimers()
  player.value = null
})

describe('DetailModal', () => {
  it('locks page scroll, closes from the backdrop, and restores its explicit trigger', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const onClose = vi.fn()

    draw(
      <DetailModal label="Run details" className="run-sheet" onClose={onClose} returnFocus={trigger}>
        <p>Details</p>
      </DetailModal>
    )

    const backdrop = host.querySelector<HTMLElement>('.ed-detail-modal')!
    const card = host.querySelector<HTMLElement>('[role="dialog"]')!
    expect(document.body.classList.contains('modal-open')).toBe(true)
    expect(document.activeElement).toBe(card)
    expect(card.classList.contains('run-sheet')).toBe(true)

    await click(card)
    expect(onClose).not.toHaveBeenCalled()
    await click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()

    draw(null)
    expect(document.body.classList.contains('modal-open')).toBe(false)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('traps keyboard focus and uses the latest close handler for Escape', () => {
    const firstClose = vi.fn()
    const latestClose = vi.fn()
    draw(
      <DetailModal label="Keyboard details" onClose={firstClose}>
        <button>Last action</button>
      </DetailModal>
    )
    draw(
      <DetailModal label="Keyboard details" onClose={latestClose}>
        <button>Last action</button>
      </DetailModal>
    )

    const card = host.querySelector<HTMLElement>('[role="dialog"]')!
    const close = buttonNamed('Close')
    const last = buttonNamed('Last action')

    card.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(close)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(last)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(close)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(firstClose).not.toHaveBeenCalled()
    expect(latestClose).toHaveBeenCalledOnce()
  })

  it('closes from its close button', async () => {
    const onClose = vi.fn()
    draw(
      <DetailModal label="Closable" onClose={onClose}>
        content
      </DetailModal>
    )

    await click(buttonNamed('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('BadgeEarned', () => {
  it('renders nothing when no known badge rung was earned', () => {
    draw(<BadgeEarned earned={[]} />)
    expect(host.innerHTML).toBe('')

    draw(<BadgeEarned earned={[{ slug: 'retired-badge', rungIndex: 0, value: 1, at: 'now' }]} />)
    expect(host.innerHTML).toBe('')
  })

  it('renders one earned rung with high-resolution artwork and its rung chip', () => {
    draw(<BadgeEarned earned={[{ slug: 'clockbreaker', rungIndex: 3, value: 34.2, at: 'now' }]} />)

    expect(host.querySelector('[role="status"]')?.textContent).toContain('Badge earned')
    expect(host.querySelector('.ed-earned__name')?.textContent).toBe('Clockbreaker')
    expect(host.querySelector('.badge-med__chip')?.textContent).toBe('35s')
    const art = host.querySelector<HTMLImageElement>('.badge-med__art')!
    expect(art.getAttribute('src')).toBe('/assets/badges/clockbreaker-384.png')
    expect(art.width).toBe(117)
    expect(host.querySelector('.badge-med--earned')).not.toBeNull()
  })

  it('counts multiple earned rungs and skips an out-of-range chip', () => {
    draw(
      <BadgeEarned
        earned={[
          { slug: 'reps', rungIndex: 0, value: 100, at: 'now' },
          { slug: 'night-shift', rungIndex: 99, value: 1, at: 'now' }
        ]}
      />
    )

    expect(host.querySelector('.ed-earned__title')?.textContent).toBe('2 badges earned')
    expect(host.querySelectorAll('.ed-earned__item')).toHaveLength(2)
    expect(host.textContent).toContain('Night Shift')
    expect(host.querySelectorAll('.badge-med__chip')).toHaveLength(1)
  })
})

describe('BadgeGrid', () => {
  it('shows the whole locked set on the Badges scope, and a line on a public profile', () => {
    // The full Badges scope shows every badge (locked / silhouetted) even at zero
    // earned — a set you cannot see whole is not a set.
    draw(<BadgeGrid states={[]} />)
    expect(host.querySelector('.ed-badges__grid')).not.toBeNull()
    expect(host.textContent).not.toContain('No badges yet')
    expect(host.querySelectorAll('.ed-badges__cell').length).toBeGreaterThan(20)

    // The earned-only public view still collapses to a line when empty.
    draw(<BadgeGrid states={[]} earnedOnly />)
    expect(host.textContent).toBe('No badges earned yet.')
  })

  it('filters a public wall to earned badges and restores focus after the modal closes', async () => {
    draw(<BadgeGrid states={[badgeState('reps', 175, 0)]} earnedOnly />)
    const trigger = buttonNamed('Reps, 100')
    expect(host.querySelectorAll('.ed-badges__cell')).toHaveLength(1)

    await click(trigger)
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Reps')
    expect(host.textContent).toContain('Next milestone')
    expect(host.textContent).toContain('Current: 175 · 75 to go')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('70')

    await click(buttonNamed('Close'))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('names locked secret badges while keeping their condition hidden', async () => {
    draw(<BadgeGrid states={[badgeState('reps', 100, 0)]} />)

    await click(buttonNamed('Night Shift'))
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Night Shift')
    expect(host.textContent).toContain('Secret badge — earn it to reveal how.')
    expect(host.textContent).not.toContain('between midnight and 5:00 a.m.')
    expect(host.querySelector('[role="progressbar"]')).toBeNull()
    await click(buttonNamed('Close'))

    await click(buttonNamed('Clockbreaker'))
    expect(host.textContent).toContain('Fastest Surge run')
    expect(host.textContent).toContain('60s')
    expect(host.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('explains exactly how an earned secret badge was triggered', async () => {
    draw(<BadgeGrid states={[badgeState('night-shift', 1, 0)]} />)

    await click(buttonNamed('Night Shift, 1'))
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Night Shift')
    expect(host.textContent).toContain('Earned by completing a game between midnight and 5:00 a.m. local time.')
    expect(host.textContent).not.toContain('Secret badge — earn it to reveal how.')
  })

  it('describes descending time progress and a completed milestone ladder', async () => {
    draw(<BadgeGrid states={[badgeState('clockbreaker', 34.2, 3, [12, 9, 5, 2]), badgeState('reps', 10_000, 8)]} />)

    await click(buttonNamed('Clockbreaker, 35s'))
    expect(host.textContent).toContain('Best: 34.2s · 4.2s faster to go')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('16')
    await click(buttonNamed('Close'))

    await click(buttonNamed('Reps, 10K'))
    expect(host.textContent).toContain('Milestones complete')
    expect(host.textContent).toContain('Current: 10K · all milestones achieved')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100')
  })

  it.each([
    ['copied', 'Link copied.', true],
    ['shared', 'Shared.', true],
    ['unavailable', 'Copy this link:', false],
    ['cancelled', '', false]
  ] as const)('handles the %s badge-sharing outcome', async (outcome, status, tracked) => {
    vi.useFakeTimers()
    if (outcome === 'shared') {
      Object.defineProperty(navigator, 'share', { value: vi.fn().mockResolvedValue(undefined), configurable: true })
    } else if (outcome === 'copied') {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true
      })
    } else if (outcome === 'cancelled') {
      Object.defineProperty(navigator, 'share', {
        value: vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
        configurable: true
      })
    }
    draw(
      <BadgeGrid
        states={[badgeState('clockbreaker', 34.2, 3)]}
        earnedOnly
        playerId="signed-in-player"
        playerName="Knight Main"
      />
    )
    await click(buttonNamed('Clockbreaker, 35s'))

    await click(buttonNamed('SHARE'))
    await vi.waitFor(() => {
      expect(shareMock.prepareBadgeShare).toHaveBeenCalledWith({ slug: 'clockbreaker', rungIndex: 3 })
      expect(host.querySelector('.ed-badges__permalink-status')?.textContent).toBe(status)
      expect(analyticsMock.track).toHaveBeenCalledTimes(tracked ? 1 : 0)
    })

    if (tracked) {
      expect(buttonNamed('SHARE').disabled).toBe(false)
      void act(() => {
        vi.advanceTimersByTime(1_800)
      })
      expect(buttonNamed('SHARE').disabled).toBe(false)
    }
  })

  it('disables duplicate share attempts while the native sheet is opening', async () => {
    let finishShare: (() => void) | undefined
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockReturnValue(
        new Promise((_resolve, reject) => {
          finishShare = () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        })
      )
    })
    draw(
      <BadgeGrid
        states={[badgeState('reps', 100, 0)]}
        earnedOnly
        playerId="signed-in-player"
        playerName="Knight Main"
      />
    )
    await click(buttonNamed('Reps, 100'))

    const share = buttonNamed('SHARE')
    void act(() => {
      share.click()
    })
    expect(buttonNamed('SHARE').disabled).toBe(true)
    buttonNamed('SHARE').click()
    expect(shareMock.prepareBadgeShare).toHaveBeenCalledOnce()

    await act(async () => {
      finishShare?.()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(buttonNamed('SHARE').disabled).toBe(false))
  })

  it('does not offer sharing without a complete public identity', async () => {
    draw(<BadgeGrid states={[badgeState('reps', 100, 0)]} earnedOnly playerId="player-one" />)
    await click(buttonNamed('Reps, 100'))
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'SHARE')).toBe(false)
  })

  it('does not offer an uncredited badge share to a signed-out visitor', async () => {
    player.value = null
    draw(<BadgeGrid states={[badgeState('reps', 100, 0)]} earnedOnly playerId="player-one" playerName="Knight Main" />)
    await click(buttonNamed('Reps, 100'))
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'SHARE')).toBe(false)
  })

  it("does not offer sharing from another player's badge wall", async () => {
    draw(
      <BadgeGrid states={[badgeState('reps', 100, 0)]} earnedOnly playerId="player-two" playerName="Royal Ghosted" />
    )
    await click(buttonNamed('Reps, 100'))
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'SHARE')).toBe(false)
  })
})
