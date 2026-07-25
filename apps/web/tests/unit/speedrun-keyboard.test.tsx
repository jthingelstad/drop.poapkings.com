/** @vitest-environment jsdom */
import { render } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PipKeypad from '../../src/components/PipKeypad'
import { getSettings, saveSettings } from '../../src/lib/storage'

// The keypad reads the setting fresh at render, so these drive it through real
// storage rather than a mock — that is the path a player actually takes.
function mount(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  render(<PipKeypad onPick={() => {}} />, host)
  return host
}

function rowShape(host: HTMLElement): number[] {
  const rows = [...host.querySelectorAll('.pip-keypad__row')]
  if (rows.length === 0) return [host.querySelectorAll('button[data-pip-value]').length]
  return rows.map((row) => row.querySelectorAll('button[data-pip-value]').length)
}

describe('speedrun keyboard', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('defaults to the single row every player already learned', () => {
    expect(getSettings().speedrunKeyboard).toBe(false)
    const host = mount()
    expect(host.querySelector('.pip-keypad--speedrun')).toBeNull()
    expect(rowShape(host)).toEqual([9])
  })

  it('deals 1-5 over 6-9 when the setting is on', () => {
    saveSettings({ speedrunKeyboard: true })
    const host = mount()
    expect(host.querySelector('.pip-keypad--speedrun')).not.toBeNull()
    expect(rowShape(host)).toEqual([5, 4])

    const rows = [...host.querySelectorAll('.pip-keypad__row')]
    const values = (row: Element) =>
      [...row.querySelectorAll('button[data-pip-value]')].map((b) => Number(b.getAttribute('data-pip-value')))
    expect(values(rows[0]!)).toEqual([1, 2, 3, 4, 5])
    expect(values(rows[1]!)).toEqual([6, 7, 8, 9])
  })

  it('keeps all nine keys, their values and their labels in either layout', () => {
    // ~12 e2e specs and the physical number-key handler key off .pip-keypad,
    // the group role, data-pip-value, and the "N elixir" labels. A layout
    // change must not disturb any of them.
    for (const speedrun of [false, true]) {
      localStorage.clear()
      saveSettings({ speedrunKeyboard: speedrun })
      const host = mount()
      const keys = [...host.querySelectorAll('button[data-pip-value]')]
      expect(keys).toHaveLength(9)
      expect(keys.map((k) => Number(k.getAttribute('data-pip-value')))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
      expect(keys[3]!.getAttribute('aria-label')).toBe('4 elixir')
      expect(host.querySelector('.pip-keypad')).not.toBeNull()
      expect(host.querySelector('[role="group"][aria-label="Elixir cost keypad"]')).not.toBeNull()
    }
  })

  it('still answers when a key is tapped in the two-row layout', () => {
    saveSettings({ speedrunKeyboard: true })
    const picked: number[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(<PipKeypad onPick={(n) => picked.push(n)} />, host)

    host.querySelector<HTMLButtonElement>('[data-pip-value="7"]')?.click()
    expect(picked).toEqual([7])
  })
})
