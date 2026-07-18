import { useSignal } from '@preact/signals'
import { requestLogin } from '../lib/api'
import { navigate } from '../lib/router'

export default function Login() {
  const email = useSignal('')
  const status = useSignal<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const message = useSignal('')

  async function submit(event: Event) {
    event.preventDefault()
    status.value = 'sending'
    try {
      const response = await requestLogin(email.value)
      message.value = response.message
      status.value = 'sent'
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'The login email could not be sent.'
      status.value = 'error'
    }
  }

  return (
    <div class="main-content account-screen">
      <div class="account-card">
        <div class="eyebrow">Save your grind</div>
        <h1>Sign in with email</h1>
        <p class="lede">We’ll send a private link. No password, no Clash Royale account access.</p>
        {status.value === 'sent' ? (
          <div class="account-message account-message--success" role="status">
            {message.value}
          </div>
        ) : (
          <form class="account-form" onSubmit={submit}>
            <label for="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              autocomplete="email"
              required
              value={email.value}
              onInput={(event) => (email.value = event.currentTarget.value)}
            />
            <button class="btn btn--gold" disabled={status.value === 'sending'}>
              {status.value === 'sending' ? 'Sending…' : 'Email me a login link'}
            </button>
          </form>
        )}
        {status.value === 'error' && <div class="account-message account-message--error">{message.value}</div>}
        <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
          Keep playing anonymously
        </button>
      </div>
    </div>
  )
}
