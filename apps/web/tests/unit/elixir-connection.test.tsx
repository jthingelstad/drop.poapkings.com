import { render, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '@elixir-drop/contracts'
import AccountTags from '../../src/components/AccountTags'
import ElixirConnection from '../../src/components/ElixirConnection'

const accountMock = vi.hoisted(() => ({
  beginElixirLogin: vi.fn(async () => undefined)
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
const ALT = { playerTag: '#2PYQ0C', name: 'Sample Alt', relationship: 'alt' as const, verified: false }

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  accountMock.beginElixirLogin.mockClear()
})

afterEach(() => {
  void act(() => render(null, host))
  host.remove()
})

describe('ElixirConnection', () => {
  it('offers a check with Elixir before any player is read, and starts the flow toward Account', async () => {
    draw(<ElixirConnection player={base} />)
    expect(host.textContent).toContain('Not checked with Elixir yet')
    expect(host.textContent).toContain('Your Drop account is your Elixir account')
    const button = host.querySelector('button')!
    expect(button.textContent).toContain('Check with Elixir')
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

  it("never offers a picker, even with an alt on the account; the name and picture are Elixir's", () => {
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
            candidates: [KING, ALT]
          }
        }}
      />
    )
    expect(host.querySelector('.ed-elixir__picker')).toBeNull()
    expect(host.querySelector('.ed-elixir__candidate')).toBeNull()
    expect(host.textContent).not.toContain('Sample Alt')
    expect(host.textContent).toContain('Your name and picture come from your Elixir account')
    expect(host.querySelector('a[href="https://elixir.poapkings.com/"]')).not.toBeNull()
  })

  it('an unverified primary points at Elixir → Verify; there is no disconnect', async () => {
    draw(
      <ElixirConnection
        player={{
          ...base,
          playerTag: KING.playerTag,
          elixir: {
            linkedAt: '2026-09-12T18:00:00.000Z',
            checkedAt: '2026-09-12T18:00:00.000Z',
            playerTag: KING.playerTag,
            verified: false,
            candidates: [{ ...KING, verified: false }]
          }
        }}
      />
    )
    expect(host.querySelector('a[href="https://elixir.poapkings.com/console/account/verify"]')).not.toBeNull()
    expect(host.textContent).not.toContain('would not add')
    expect(host.querySelector('.ed-elixir__unverified')).not.toBeNull()
    expect([...host.querySelectorAll('button')].some((b) => /disconnect/i.test(b.textContent ?? ''))).toBe(false)
  })

  it('points to Elixir when the account has no player, and keeps a typed tag as not verified', () => {
    draw(
      <ElixirConnection
        player={{
          ...base,
          playerTag: '#2PP',
          elixir: {
            linkedAt: '2026-09-12T18:00:00.000Z',
            checkedAt: '2026-09-12T18:00:00.000Z',
            verified: false,
            candidates: []
          }
        }}
      />
    )
    expect(host.textContent).toContain(
      'Your Elixir account has no Clash Royale player yet. Add one at elixir.poapkings.com, then sign in with Elixir again.'
    )
    expect(host.querySelector('a[href="https://elixir.poapkings.com"]')).not.toBeNull()
    expect(host.textContent).toContain('Drop keeps the tag you typed in before, #2PP, as not verified.')
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
