import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { emailValidationMessage } from '@elixir-drop/contracts'
import { pollLogin, requestLogin } from '../lib/api'
import { applyPolledSession, redeemCodeAccount } from '../lib/account'
import { authReturnPathFromRoute, gamePathForRoute, profileRouteForGame } from '../lib/game-routes'
import { navigate, route } from '../lib/router'
import { clearRecruiter, recruiterAttribution } from '../lib/referral'

export default function Login() {
  const returnTo = authReturnPathFromRoute(route.value)
  const email = useSignal('')
  const code = useSignal('')
  const status = useSignal<'idle' | 'sending' | 'sent' | 'verifying' | 'error'>('idle')
  const message = useSignal('')
  const codeError = useSignal('')
  const pollId = useSignal('')
  const codeInput = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (status.value === 'sent') codeInput.current?.focus({ preventScroll: true })
  }, [status.value])

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
      email.value = email.value.trim()
      const response = await requestLogin(email.value, returnTo, recruiterAttribution())
      clearRecruiter()
      message.value = response.message
      code.value = ''
      codeError.value = ''
      pollId.value = response.pollId ?? ''
      status.value = 'sent'
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'The login email could not be sent.'
      status.value = 'error'
    }
  }

  async function submitCode(event: Event) {
    event.preventDefault()
    if (code.value.length !== 6 || status.value === 'verifying') return
    status.value = 'verifying'
    codeError.value = ''
    try {
      const authenticatedPlayer = await redeemCodeAccount(email.value, code.value)
      if (!authenticatedPlayer.favoriteCardId || !authenticatedPlayer.publicName) {
        const returnToGame = returnTo ? gamePathForRoute(returnTo) : undefined
        navigate(returnToGame ? profileRouteForGame(returnToGame) : '/profile')
        return
      }
      navigate(returnTo || '/profile')
    } catch (error) {
      codeError.value = error instanceof Error ? error.message : 'This sign-in code could not be used.'
      status.value = 'sent'
    }
  }

  const awaitingCode = status.value === 'sent' || status.value === 'verifying'

  return (
    <div class="main-content account-screen">
      <div class="account-card">
        <div class="eyebrow">Player account</div>
        <h1>Sign In</h1>
        {!awaitingCode && (
          <>
            <p class="lede">
              Enter your email and we’ll send a six-digit code and private link. No password, no Clash Royale account
              access.
            </p>
            <p class="account-privacy">
              Your email stays private and is used for sign-in plus occasional Drop release news after you successfully
              sign in. Your chosen player name, favorite card, scores, and optional public Clash Royale tag appear in
              Drop.{' '}
              <a class="text-link" href="/privacy/">
                Privacy details
              </a>
            </p>
          </>
        )}
        {awaitingCode ? (
          <>
            <div class="account-message account-message--success" role="status">
              {message.value}
            </div>
            <form class="account-form account-form--code" onSubmit={submitCode} novalidate>
              <label for="login-code">Six-digit sign-in code</label>
              <input
                ref={codeInput}
                id="login-code"
                name="code"
                type="text"
                autocomplete="one-time-code"
                autocapitalize="none"
                inputmode="numeric"
                pattern="[0-9]{6}"
                maxlength={6}
                required
                spellcheck={false}
                aria-invalid={Boolean(codeError.value)}
                aria-describedby={codeError.value ? 'login-code-error' : 'login-code-help'}
                value={code.value}
                onInput={(event) => {
                  code.value = event.currentTarget.value.replaceAll(/\D/g, '').slice(0, 6)
                  codeError.value = ''
                }}
              />
              <p id="login-code-help" class="account-privacy">
                Mail may offer to fill this code automatically.
              </p>
              <button class="btn btn--gold" disabled={code.value.length !== 6 || status.value === 'verifying'}>
                {status.value === 'verifying' ? 'Signing you in…' : 'Verify code'}
              </button>
            </form>
            {codeError.value && (
              <div id="login-code-error" class="account-message account-message--error" role="alert">
                {codeError.value}
              </div>
            )}
            {pollId.value && (
              <p class="account-privacy" role="status">
                Prefer the link? Keep this page open and tap it in your email. You&rsquo;ll be signed in here
                automatically, even if the link opens in another browser.
              </p>
            )}
            <button
              class="btn btn--ghost btn--sm"
              onClick={() => {
                status.value = 'idle'
                message.value = ''
                code.value = ''
                codeError.value = ''
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
              {status.value === 'sending' ? 'Sending…' : 'Sign In'}
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
