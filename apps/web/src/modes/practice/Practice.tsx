import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import GameStartScreen from '../../components/game/GameStart'
import { offline } from '../../lib/api-availability'
import { player, sessionToken } from '../../lib/account'
import { restoreServerPracticeDraft } from '../../lib/practice-checkpoint'
import { loadPracticeDraft } from '../../lib/practice-draft'
import PracticeLoop from './PracticeLoop'

export default function Practice() {
  const currentPlayer = player.peek()
  const needsServerRecoveryCheck = Boolean(
    currentPlayer && sessionToken() && !offline.peek() && !loadPracticeDraft(currentPlayer.id)
  )
  const state = useSignal<'loading' | 'ready' | 'error'>(needsServerRecoveryCheck ? 'loading' : 'ready')
  const message = useSignal('')
  const prepare = useCallback(async () => {
    state.value = 'loading'
    message.value = ''
    const currentPlayer = player.peek()
    if (loadPracticeDraft(currentPlayer?.id ?? null) || !currentPlayer || !sessionToken() || offline.peek()) {
      state.value = 'ready'
      return
    }
    try {
      await restoreServerPracticeDraft(currentPlayer.id, sessionToken()!)
      state.value = 'ready'
    } catch (error) {
      if (offline.peek()) {
        state.value = 'ready'
        return
      }
      message.value = error instanceof Error ? error.message : 'Practice recovery could not be checked.'
      state.value = 'error'
    }
  }, [message, state])

  useEffect(() => {
    void prepare()
  }, [prepare])

  if (state.value === 'loading') return <GameStartScreen modeName="Practice" phase="preparing" />
  if (state.value === 'error') {
    return (
      <div class="main-content account-screen">
        <div class="account-card" aria-live="polite">
          <div class="eyebrow">Practice recovery</div>
          <h1>Practice could not resume yet</h1>
          <p class="account-message account-message--error">{message.value}</p>
          <p class="lede">Nothing has been replaced. Retry when player services reconnect.</p>
          <button class="btn btn--gold" onClick={() => void prepare()}>
            Try again
          </button>
        </div>
      </div>
    )
  }
  return <PracticeLoop eyebrow="Practice session" />
}
