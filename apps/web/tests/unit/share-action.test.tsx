import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import ShareAction from '../../src/components/ShareAction'

describe('ShareAction', () => {
  it('keeps the share glyph and SHARE label static while the action runs', async () => {
    let finishShare: (() => void) | undefined
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          finishShare = resolve
        })
      )
    })
    const host = document.createElement('div')
    document.body.appendChild(host)

    await act(async () => {
      render(<ShareAction prepare={() => Promise.resolve('https://drop.poapkings.com/share/P1111111111')} />, host)
    })
    const button = host.querySelector<HTMLButtonElement>('button')!
    expect(button.textContent?.trim()).toBe('SHARE')
    expect(button.querySelector('.icon')).toBeTruthy()
    expect(button.querySelector('.tap-face')).toBeNull()

    void act(() => button.click())
    await vi.waitFor(() => expect(button.disabled).toBe(true))
    expect(button.textContent?.trim()).toBe('SHARE')
    expect(button.querySelector('.icon')).toBeTruthy()

    await act(async () => finishShare?.())
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    expect(button.textContent?.trim()).toBe('SHARE')
    expect(host.querySelector('.ed-link-action__status')?.textContent).toBe('Shared.')

    render(null, host)
    host.remove()
  })

  it('shows a selectable URL when native sharing and clipboard access are both unavailable', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const url = 'https://drop.poapkings.com/share/P1111111111'

    await act(async () => {
      render(<ShareAction prepare={() => Promise.resolve(url)} />, host)
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
      render(<ShareAction prepare={() => Promise.resolve(url)} />, host)
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
