import { afterEach, describe, expect, it } from 'vitest'
import { isEnhancedEffectsEnabled } from '../../src/lib/motion'
import { saveSettings } from '../../src/lib/storage'

afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('reduce-motion')
})

describe('isEnhancedEffectsEnabled', () => {
  it('defaults to on', () => {
    expect(isEnhancedEffectsEnabled()).toBe(true)
  })

  it('turns off when the setting is disabled', () => {
    saveSettings({ enhancedEffects: false })
    expect(isEnhancedEffectsEnabled()).toBe(false)
  })

  it('is forced off by reduced motion, whatever the setting says', () => {
    saveSettings({ enhancedEffects: true })
    document.documentElement.classList.add('reduce-motion')
    expect(isEnhancedEffectsEnabled()).toBe(false)
  })
})
