import { useSignal } from '@preact/signals'
import type { InputStyle } from '../../types'
import { getSettings, saveSettings } from '../../lib/storage'
import { navigate } from '../../lib/router'
import { buildMeta } from '../../lib/build'
import releaseMeta from '../../data/release.json'
import PlayerPreferences from '../../components/PlayerPreferences'

export default function Settings() {
  const s = getSettings()
  const inputStyle = useSignal<InputStyle>(s.inputStyle)

  function setInput(style: InputStyle) {
    inputStyle.value = style
    saveSettings({ inputStyle: style })
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

        <PlayerPreferences />

        <dl class="settings-meta" aria-label="Build information">
          <div class="settings-meta__row">
            <dt>Release</dt>
            <dd>
              {releaseMeta.name}: {releaseMeta.blurb}
            </dd>
          </div>
          <div class="settings-meta__row">
            <dt>Build ID</dt>
            <dd>
              <code>{buildMeta.id}</code>
            </dd>
          </div>
          <div class="settings-meta__row">
            <dt>Build date</dt>
            <dd>
              <time dateTime={buildMeta.dateIso}>{buildMeta.dateLabel}</time>
            </dd>
          </div>
        </dl>

        <button class="btn btn--ghost btn--sm settings__back" onClick={() => navigate('/')}>
          Done
        </button>
      </div>
    </div>
  )
}
