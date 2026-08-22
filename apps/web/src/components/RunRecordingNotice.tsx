import { recordingNotice } from '../lib/use-game-run'
import { useEffect, useState } from 'preact/hooks'
import Icon from './Icon'

export default function RunRecordingNotice() {
  const notice = recordingNotice.value
  const report = notice.state === 'error' ? notice.report : undefined
  const [context, setContext] = useState('')

  useEffect(() => setContext(''), [report?.runId])

  if (notice.state === 'idle') return null

  const blocking = notice.state === 'saving' || notice.state === 'error'
  return (
    <div
      class={`run-recording${blocking ? ' run-recording--blocking' : ''}`}
      role={notice.state === 'error' ? 'alert' : 'status'}
    >
      <div class={`run-recording__card run-recording__card--${notice.state}`}>
        <span class="run-recording__icon" aria-hidden="true">
          {notice.state === 'saving' || notice.state === 'scoring' ? (
            <Icon name="loader-circle" className="icon--spin" />
          ) : notice.state === 'saved' ? (
            <Icon name="check" />
          ) : (
            <Icon name="triangle-alert" />
          )}
        </span>
        <div class="run-recording__body">
          <strong>{notice.message}</strong>
          {'detail' in notice && notice.detail && <small>{notice.detail}</small>}
          {report && (
            <div class="run-report">
              <p aria-live="polite">
                {report.state === 'sending'
                  ? 'Sending a private error report…'
                  : report.state === 'failed'
                    ? 'The automatic error report could not be sent.'
                    : report.state === 'saving-context'
                      ? 'Adding your context…'
                      : report.state === 'context-saved'
                        ? 'Error report and context sent. Thank you.'
                        : report.state === 'context-failed'
                          ? 'The error report was sent, but your context did not save.'
                          : 'Error report sent automatically.'}
              </p>
              {report.state === 'failed' && (
                <button type="button" class="btn btn--outline btn--sm" onClick={report.retry}>
                  Retry report
                </button>
              )}
              {(report.state === 'ready' || report.state === 'saving-context' || report.state === 'context-failed') && (
                <form
                  class="run-report__context"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    const value = context.trim()
                    if (!value) return
                    await report.submitContext(value)
                  }}
                >
                  <label for="run-report-context">What happened? (optional)</label>
                  <textarea
                    id="run-report-context"
                    rows={3}
                    maxlength={1000}
                    value={context}
                    disabled={report.state === 'saving-context'}
                    onInput={(event) => setContext(event.currentTarget.value)}
                  />
                  <small>Describe what you saw. Don’t include email or personal information.</small>
                  <button
                    type="submit"
                    class="btn btn--outline btn--sm"
                    disabled={!context.trim() || report.state === 'saving-context'}
                  >
                    Add context
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
        {notice.state === 'error' && (
          <button class="btn btn--gold btn--sm" onClick={notice.action}>
            {notice.actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
