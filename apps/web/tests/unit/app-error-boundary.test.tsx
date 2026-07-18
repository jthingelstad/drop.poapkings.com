import { render } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppErrorBoundary from '../../src/components/AppErrorBoundary'

function BrokenScreen(): never {
  throw new Error('render exploded')
}

describe('AppErrorBoundary', () => {
  const root = document.createElement('div')

  afterEach(() => {
    render(null, root)
    root.remove()
  })

  it('replaces a crashed screen with recovery controls', async () => {
    document.body.append(root)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary>
        <BrokenScreen />
      </AppErrorBoundary>,
      root
    )

    await vi.waitFor(() => expect(root.textContent).toContain('This screen could not load'))
    expect(root.textContent).toContain('Return home')
    expect(root.textContent).toContain('Reload Drop')
  })
})
