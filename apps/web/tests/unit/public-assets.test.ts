import { readdirSync } from 'node:fs'
import { BADGE_LIST, GAME_MODES } from '@elixir-drop/contracts'
import { describe, expect, it } from 'vitest'

function files(relative: string, extension: string): string[] {
  return readdirSync(new URL(relative, import.meta.url))
    .filter((name) => name.endsWith(extension))
    .sort()
}

describe('public visual assets', () => {
  it('ships exactly the badge sizes addressed by the UI and share card', () => {
    const expected = BADGE_LIST.flatMap(({ slug }) => [`${slug}-192.png`, `${slug}-384.png`]).sort()
    expect(files('../../public/assets/badges/', '.png')).toEqual(expected)
  })

  it('ships exactly the mode sizes addressed by the UI and share card', () => {
    const expected = GAME_MODES.flatMap((mode) => [`${mode}-192.png`, `${mode}-384.png`]).sort()
    expect(files('../../public/assets/modes/', '.png')).toEqual(expected)
  })

  it('keeps static asset directories to the sizes used by production markup', () => {
    expect(files('../../public/assets/empty/', '.png')).toEqual([
      'empty-board-512.png',
      'empty-runs-256.png',
      'empty-runs-512.png'
    ])
    expect(files('../../public/assets/icon/', '.png')).toEqual([
      'drop-icon-180.png',
      'drop-icon-192.png',
      'drop-icon-32.png',
      'drop-icon-512.png'
    ])
    expect(files('../../public/assets/fonts/', '.otf')).toEqual(['Clash_Regular.otf'])
    expect(files('../../public/assets/share/', '.png')).toEqual([
      'og-default.png',
      'share-backdrop.png',
      'share-sticker.png'
    ])
  })
})
