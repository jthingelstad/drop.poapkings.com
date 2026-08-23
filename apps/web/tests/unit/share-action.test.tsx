import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import ShareAction from '../../src/components/ShareAction'

describe('ShareAction', () => {
  it('shows a selectable URL when native sharing and clipboard access are both unavailable', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const url = 'https://drop.poapkings.com/share/P1111111111'

    await act(async () => {
      render(
        <ShareAction prepare={() => Promise.resolve(url)} idleLabel="Share profile" sharedMessage="Profile shared." />,
        host
      )
    })
    await act(async () => host.querySelector('button')!.click())

    await vi.waitFor(() => {
      const fallback = host.querySelector<HTMLInputElement>('input[aria-label="Share link"]')
      expect(host.textContent).toContain('Copy this link:')
      expect(fallback?.value).toBe(url)
    })
    render(null, host)
    host.remove()
  })

  it('keeps clipboard fallback copy URL-only', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const url = 'https://drop.poapkings.com/share/P1111111111'

    await act(async () => {
      render(
        <ShareAction prepare={() => Promise.resolve(url)} idleLabel="Share profile" sharedMessage="Profile shared." />,
        host
      )
    })
    await act(async () => host.querySelector('button')!.click())

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(url)
      expect(host.textContent).toContain('Link copied.')
    })
    render(null, host)
    host.remove()
  })
})

afterEach(() => {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  vi.clearAllMocks()
})
