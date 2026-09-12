import { render, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '@elixir-drop/contracts'
import AccountTags from '../../src/components/AccountTags'
import ElixirConnection from '../../src/components/ElixirConnection'

const accountMock = vi.hoisted(() => ({
  beginElixirLogin: vi.fn(async () => undefined),
  chooseElixirPlayer: vi.fn(async () => undefined),
  disconnectElixirAccount: vi.fn(async () => undefined)
}))

vi.mock('../../src/lib/account', () => accountMock)

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
    await Promise.resolve()
  })
}

const base: Player = {
  id: 'p1',
  email: 'ace@example.com',
  publicName: 'Ace',
  totalGames: 3,
  xp: 5,
  level: 2,
  levelStartGames: 0,
  nextLevelGames: 20,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z'
}

const KING = { playerTag: '#20JJJ2CCRU', name: 'King Thing', relationship: 'primary' as const, verified: true }
const ALT = { playerTag: '#VJQV8G8RL', name: 'thingles', relationship: 'alt' as const, verified: false }

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  accountMock.beginElixirLogin.mockClear()
  accountMock.chooseElixirPlayer.mockClear()
  accountMock.disconnectElixirAccount.mockClear()
})

afterEach(() => {
  render(null, host)
  host.remove()
})

describe('ElixirConnection', () => {
  it('offers Connect when nothing is linked, and starts the flow toward Account', async () => {
    draw(<ElixirConnection player={base} />)
    expect(host.textContent).toContain('Not connected')
    const button = host.querySelector('button')!
    expect(button.textContent).toContain('Connect Elixir')
    await click(button)
    expect(accountMock.beginElixirLogin).toHaveBeenCalledWith('/profile?scope=account')
  })

  it('shows the chosen player with the verified mark and the dates, no picker for one candidate', () => {
    draw(
      <ElixirConnection
        player={{
          ...base,
          playerTag: KING.playerTag,
          elixir: {
            linkedAt: '2026-09-12T18:00:00.000Z',
            checkedAt: '2026-09-12T18:00:00.000Z',
            playerTag: KING.playerTag,
            playerName: 'King Thing',
            verified: true,
            verifiedAt: '2026-09-12T18:00:00.000Z',
            candidates: [KING]
          }
        }}
      />
    )
    expect(host.textContent).toContain('King Thing')
    expect(host.querySelector('.ed-elixir__verified')).not.toBeNull()
    expect(host.querySelector('.ed-elixir__picker')).toBeNull()
    expect(host.textContent).toContain('Re-check with Elixir')
  })

  it('asks for a choice when more than one player is offered, and picks by tag', async () => {
    draw(
      <ElixirConnection
        player={{
          ...base,
          elixir: {
            linkedAt: '2026-09-12T18:00:00.000Z',
            checkedAt: '2026-09-12T18:00:00.000Z',
            verified: false,
            candidates: [KING, ALT]
          }
        }}
      />
    )
    expect(host.textContent).toContain('Choose the player Drop shows')
    const candidates = [...host.querySelectorAll<HTMLButtonElement>('.ed-elixir__candidate')]
    expect(candidates.map((c) => c.textContent)).toEqual([
      expect.stringContaining('King Thing'),
      expect.stringContaining('thingles')
    ])
    expect(candidates[0]!.textContent).toContain('verified')
    expect(candidates[1]!.textContent).toContain('not verified')
    await click(candidates[1]!)
    expect(accountMock.chooseElixirPlayer).toHaveBeenCalledWith('#VJQV8G8RL')
  })

  it('an unverified choice points at Elixir → Verify; a refused track is explained; Disconnect disconnects', async () => {
    draw(
      <ElixirConnection
        player={{
          ...base,
          playerTag: ALT.playerTag,
          elixir: {
            linkedAt: '2026-09-12T18:00:00.000Z',
            checkedAt: '2026-09-12T18:00:00.000Z',
            playerTag: ALT.playerTag,
            verified: false,
            candidates: [KING, ALT],
            trackRefused: '#2PP'
          }
        }}
      />
    )
    expect(host.querySelector('a[href="https://elixir.poapkings.com/account/verify"]')).not.toBeNull()
    expect(host.textContent).toContain('#2PP')
    const current = host.querySelector<HTMLButtonElement>('.ed-elixir__candidate--current')!
    expect(current.disabled).toBe(true)
    const disconnect = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Disconnect')!
    await click(disconnect)
    expect(accountMock.disconnectElixirAccount).toHaveBeenCalled()
  })

  it('surfaces a failure from the account layer', async () => {
    accountMock.beginElixirLogin.mockRejectedValueOnce(new Error('Elixir did not answer.'))
    draw(<ElixirConnection player={base} />)
    await click(host.querySelector('button')!)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Elixir did not answer.')
  })
})

describe('AccountTags', () => {
  it('renders the verified mark as Elixir’s check, and DEV as gold text', () => {
    draw(<AccountTags tags={['developer', 'verified', 'verified']} />)
    const tags = host.querySelectorAll('.ed-account-tag')
    expect(tags.length).toBe(2)
    expect(tags[0]!.textContent).toBe('DEV')
    expect(tags[1]!.classList.contains('ed-account-tag--verified')).toBe(true)
    expect(tags[1]!.getAttribute('aria-label')).toContain('Verified in Elixir')
    expect(tags[1]!.querySelector('svg')).not.toBeNull()
  })
})
