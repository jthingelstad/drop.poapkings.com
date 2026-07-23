import { useSignal } from '@preact/signals'
import { applyReducedMotion } from '../lib/motion'
import { setSoundEnabled, playCorrect } from '../lib/sound'
import { getSettings, saveSettings } from '../lib/storage'

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      class={`switch${on ? ' switch--on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
    >
      <span class="switch__knob" />
    </button>
  )
}

export default function PlayerPreferences() {
  const settings = getSettings()
  const sound = useSignal(settings.sound)
  const reducedMotion = useSignal(Boolean(settings.reducedMotion))
  const enhancedEffects = useSignal(settings.enhancedEffects ?? true)

  function toggleSound() {
    const on = !sound.value
    sound.value = on
    saveSettings({ sound: on })
    setSoundEnabled(on)
    if (on) playCorrect()
  }

  function toggleMotion() {
    const on = !reducedMotion.value
    reducedMotion.value = on
    saveSettings({ reducedMotion: on })
    applyReducedMotion(on)
  }

  function toggleEnhanced() {
    const on = !enhancedEffects.value
    enhancedEffects.value = on
    saveSettings({ enhancedEffects: on })
  }

  return (
    <div class="player-preferences">
      <div class="setting-row">
        <div class="setting-row__text">
          <div class="setting-row__name">Sound</div>
          <div class="setting-row__desc">Little blips on right and wrong answers. Off by default.</div>
        </div>
        <Toggle on={sound.value} onToggle={toggleSound} label="Sound effects" />
      </div>

      <div class="setting-row">
        <div class="setting-row__text">
          <div class="setting-row__name">Reduce motion</div>
          <div class="setting-row__desc">Drop celebratory animations and haptics. Timers and answer feedback stay.</div>
        </div>
        <Toggle on={reducedMotion.value} onToggle={toggleMotion} label="Reduce motion" />
      </div>

      <div class="setting-row">
        <div class="setting-row__text">
          <div class="setting-row__name">Enhance effects</div>
          <div class="setting-row__desc">
            Richer particle bursts across the games. On by default; Reduce motion turns effects off.
          </div>
        </div>
        <Toggle on={enhancedEffects.value} onToggle={toggleEnhanced} label="Enhance effects" />
      </div>
    </div>
  )
}
