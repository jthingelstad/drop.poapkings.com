import { useSignal } from '@preact/signals'
import type { InputStyle } from '../../types'
import { getSettings, saveSettings } from '../../lib/storage'
import { setSoundEnabled, playCorrect } from '../../lib/sound'
import { applyReducedMotion } from '../../lib/motion'
import { navigate } from '../../lib/router'

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

export default function Settings() {
  const s = getSettings()
  const inputStyle = useSignal<InputStyle>(s.inputStyle)
  const sound = useSignal(s.sound)
  const reducedMotion = useSignal(Boolean(s.reducedMotion))

  function setInput(style: InputStyle) {
    inputStyle.value = style
    saveSettings({ inputStyle: style })
  }

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

  return (
    <div class="main-content settings">
      <div class="settings__card">
        <h1 class="h1">Settings</h1>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__name">Practice input</div>
            <div class="setting-row__desc">How you answer in Practice. Surge always uses the keypad.</div>
          </div>
          <div class="input-toggle">
            <button
              class={`input-toggle__btn${inputStyle.value === 'keypad' ? ' input-toggle__btn--active' : ''}`}
              onClick={() => setInput('keypad')}
              aria-pressed={inputStyle.value === 'keypad'}
            >
              Keypad
            </button>
            <button
              class={`input-toggle__btn${inputStyle.value === 'choice' ? ' input-toggle__btn--active' : ''}`}
              onClick={() => setInput('choice')}
              aria-pressed={inputStyle.value === 'choice'}
            >
              4 choices
            </button>
          </div>
        </div>

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
            <div class="setting-row__desc">Drop the celebratory animations. Surge keeps its timer and red flash.</div>
          </div>
          <Toggle on={reducedMotion.value} onToggle={toggleMotion} label="Reduce motion" />
        </div>

        <button class="btn btn--ghost btn--sm settings__back" onClick={() => navigate('/')}>
          Done
        </button>
      </div>
    </div>
  )
}
