import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClanInviteModal from '../../src/components/ClanInviteModal'
import { clanChatInviteMessage, discordInviteMessage } from '../../src/lib/clan-invite'

const context = {
  gameName: 'Survival',
  playerName: 'Knight Main',
  clanName: 'POAP KINGS',
  result: { rank: 4, score: '24 streak' }
}

let host: HTMLDivElement

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === name
  )
  if (!button) throw new Error(`Button not found: ${name}`)
  return button
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}

function draw(prepareProfileLink = vi.fn().mockResolvedValue('https://drop.poapkings.com/share/PKNIGHT')): void {
  void act(() => {
    render(
      <ClanInviteModal
        {...context}
        onClose={() => undefined}
        returnFocus={null}
        prepareProfileLink={prepareProfileLink}
      />,
      host
    )
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

afterEach(() => {
  render(null, host)
  host.remove()
  document.body.classList.remove('modal-open')
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('clan invitation messages', () => {
  it('builds URL-free Clan Chat copy from the selected board and standing', () => {
    expect(clanChatInviteMessage(context)).toBe(
      "I'm #4 in Survival (best: 24 streak). Beat me on our Drop ladder: DROP . POAPKINGS . COM"
    )
    expect(clanChatInviteMessage({ ...context, gameName: 'Rain', result: undefined })).toBe(
      'Join me in Rain on our Drop ladder: DROP . POAPKINGS . COM'
    )
  })

  it('builds Discord Markdown with the personalized profile URL', () => {
    expect(discordInviteMessage(context, 'https://drop.poapkings.com/share/PKNIGHT')).toBe(
      "I'm **Knight Main**, currently **#4 in Survival** on the **POAP KINGS Clan Ladder** (best: **24 streak**).\n\nThink you can beat me? [Take the challenge on Elixir Drop](https://drop.poapkings.com/share/PKNIGHT)"
    )
    expect(
      discordInviteMessage(
        { gameName: 'Surge', playerName: 'Star*Lord', clanName: 'A_B', result: undefined },
        'https://drop.poapkings.com/share/PSTAR'
      )
    ).toContain("I'm **Star\\*Lord**, playing **Surge** on the **A\\_B Clan Ladder**.")
  })
})

describe('ClanInviteModal', () => {
  it('defaults to the Clan Chat tab and copies its exact plain-text message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    draw()

    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Invite clanmates')
    expect(buttonNamed('Clan Chat').getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[aria-label="Clan Chat message preview"]')?.textContent).toBe(
      "I'm #4 in Survival (best: 24 streak). Beat me on our Drop ladder: DROP . POAPKINGS . COM"
    )

    await click(buttonNamed('Copy for Clan Chat'))
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "I'm #4 in Survival (best: 24 streak). Beat me on our Drop ladder: DROP . POAPKINGS . COM"
      )
    )
    expect(buttonNamed('Copied for Clan Chat')).toBeTruthy()
  })

  it('prepares the permanent profile link before copying Discord Markdown', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const prepareProfileLink = vi.fn().mockResolvedValue('https://drop.poapkings.com/share/PKNIGHT')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    draw(prepareProfileLink)

    await click(buttonNamed('Discord'))
    expect(host.querySelector('[aria-label="Discord message preview"]')?.textContent).toContain(
      'Knight Main, currently #4 in Survival on POAP KINGS Clan Ladder'
    )
    await click(buttonNamed('Copy for Discord'))

    await vi.waitFor(() => expect(prepareProfileLink).toHaveBeenCalledOnce())
    expect(writeText).toHaveBeenCalledWith(discordInviteMessage(context, 'https://drop.poapkings.com/share/PKNIGHT'))
    expect(buttonNamed('Copied for Discord')).toBeTruthy()
  })

  it('fails closed when the personalized Discord link cannot be prepared', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    draw(vi.fn().mockRejectedValue(new Error('publish failed')))

    await click(buttonNamed('Discord'))
    await click(buttonNamed('Copy for Discord'))

    await vi.waitFor(() =>
      expect(host.textContent).toContain('Your personal Drop link could not be prepared. Try again.')
    )
    expect(writeText).not.toHaveBeenCalled()
    expect(host.querySelector('textarea')).toBeNull()
  })

  it('shows the exact selectable message when clipboard access is unavailable', async () => {
    draw()

    await click(buttonNamed('Copy for Clan Chat'))

    const fallback = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Clan Chat invite message"]')
    expect(host.textContent).toContain('Copy this message:')
    expect(fallback?.value).toBe(
      "I'm #4 in Survival (best: 24 streak). Beat me on our Drop ladder: DROP . POAPKINGS . COM"
    )
  })
})
