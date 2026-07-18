import { recordingNotice } from '../lib/use-game-run'

export default function RunRecordingNotice() {
  const notice = recordingNotice.value
  if (notice.state === 'idle') return null

  const blocking = notice.state === 'saving' || notice.state === 'error'
  return (
    <div
      class={`run-recording${blocking ? ' run-recording--blocking' : ''}`}
      role={notice.state === 'error' ? 'alert' : 'status'}
    >
      <div class={`run-recording__card run-recording__card--${notice.state}`}>
        <span class="run-recording__icon" aria-hidden="true">
          {notice.state === 'saving' ? '⏳' : notice.state === 'saved' ? '✓' : '!'}
        </span>
        <div>
          <strong>{notice.message}</strong>
          {notice.state === 'error' && <small>Your score and progress will stay here while Drop reconnects.</small>}
        </div>
        {notice.state === 'error' && (
          <button class="btn btn--gold btn--sm" onClick={notice.retry}>
            Retry recording
          </button>
        )}
      </div>
    </div>
  )
}
