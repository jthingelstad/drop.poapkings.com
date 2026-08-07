import { describe, expect, it } from 'vitest'
import { royaleApiClanUrl, royaleApiPlayerUrl } from '../../src/lib/royale-api'

describe('RoyaleAPI links', () => {
  it('normalizes player and clan tags into canonical profile paths', () => {
    expect(royaleApiPlayerUrl(' #ul2v9qrgo ')).toBe('https://royaleapi.com/player/UL2V9QRGO')
    expect(royaleApiClanUrl('#j2rgcrvg')).toBe('https://royaleapi.com/clan/J2RGCRVG')
  })
})
