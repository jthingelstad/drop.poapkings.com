import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { emailValidationMessage } from '@elixir-drop/contracts'
import { pollLogin, requestLogin } from '../lib/api'
import { applyPolledSession } from '../lib/account'
import { gameReturnPathFromRoute } from '../lib/game-routes'
import { navigate, route } from '../lib/router'
import { track } from '../lib/analytics'

export default function Login() {
  const returnTo = gameReturnPathFromRoute(route.value)
  const email = useSignal('')
  const status = useSignal<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const message = useSignal('')
  const pollId = useSignal('')

  // Once the link is on its way, quietly poll for the session. This is what lets
  // an installed PWA finish signing in even though the emailed link opens in a
  // separate browser (Safari) whose storage the PWA can't share.
  useEffect(() => {
    if (status.value !== 'sent' || !pollId.value) return
    const controller = new AbortController()
    const deadline = Date.now() + 15 * 60_000
    let timer = 0
    let stopped = false
    const tick = async () => {
      if (stopped || Date.now() > deadline) return
      try {
        const result = await pollLogin(pollId.value, controller.signal)
        if (result.ready) {
          stopped = true
          await applyPolledSession(result.session)
          navigate(returnTo || '/')
          return
        }
      } catch {
        // transient — keep polling
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), 2500)
    }
    timer = window.setTimeout(() => void tick(), 2500)
    return () => {
      stopped = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [status.value, pollId.value, returnTo])

  async function submit(event: Event) {
    event.preventDefault()
    const validationMessage = emailValidationMessage(email.value)
    if (validationMessage) {
      message.value = validationMessage
      status.value = 'error'
      return
    }
    status.value = 'sending'
    try {
      const response = await requestLogin(email.value.trim(), returnTo)
      message.value = response.message
      pollId.value = response.pollId ?? ''
      status.value = 'sent'
      track('account.login_requested')
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'The login email could not be sent.'
      status.value = 'error'
    }
  }

  return (
    <div class="main-content account-screen">
      <div class="account-card">
        <div class="eyebrow">Player account required</div>
        <h1>Sign in with email</h1>
        <p class="lede">We’ll send a private link. No password, no Clash Royale account access.</p>
        <p class="account-privacy">
          Your email is used only for sign-in and stays private. Your chosen player name, favorite card, scores, and
          optional public Clash Royale tag appear in Drop.{' '}
          <button class="text-link" onClick={() => navigate('/privacy')}>
            Privacy details
          </button>
        </p>
        {status.value === 'sent' ? (
          <>
            <div class="account-message account-message--success" role="status">
              {message.value}
            </div>
            {pollId.value && (
              <p class="account-privacy" role="status">
                Keep this page open — tap the link in your email and you&rsquo;ll be signed in here automatically, even
                if the link opens in another browser.
              </p>
            )}
            <button
              class="btn btn--ghost btn--sm"
              onClick={() => {
                status.value = 'idle'
                message.value = ''
                pollId.value = ''
              }}
            >
              Send again or use a different address
            </button>
          </>
        ) : (
          <form class="account-form" onSubmit={submit} novalidate>
            <label for="login-email">Email address</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autocomplete="email"
              autocapitalize="none"
              inputmode="email"
              maxlength={254}
              required
              spellcheck={false}
              aria-invalid={status.value === 'error'}
              aria-describedby={status.value === 'error' ? 'login-email-error' : undefined}
              value={email.value}
              onInput={(event) => {
                email.value = event.currentTarget.value
                if (status.value === 'error') {
                  status.value = 'idle'
                  message.value = ''
                }
              }}
            />
            <button class="btn btn--gold" disabled={status.value === 'sending'}>
              {status.value === 'sending' ? 'Sending…' : 'Email me a login link'}
            </button>
          </form>
        )}
        {status.value === 'error' && (
          <div id="login-email-error" class="account-message account-message--error" role="alert">
            {message.value}
          </div>
        )}
        <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
          Back to home
        </button>
      </div>
    </div>
  )
}
