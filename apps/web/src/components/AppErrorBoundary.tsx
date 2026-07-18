import { Component, type ComponentChildren } from 'preact'
import { navigate } from '../lib/router'

interface Props {
  children: ComponentChildren
}

interface State {
  failed: boolean
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    console.error('Elixir Drop render failed', { name: error.name, message: error.message })
  }

  private returnHome = (): void => {
    navigate('/')
    this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main>
        <div class="main-content account-screen">
          <div class="account-card" role="alert">
            <img src="/assets/emoji/elixir_time.png" alt="" class="route-loading__img" aria-hidden="true" />
            <div class="eyebrow">Drop hit a snag</div>
            <h1>This screen could not load</h1>
            <p class="lede">Your account and recorded games are safe. Return home or reload Drop to try again.</p>
            <button class="btn btn--gold" onClick={this.returnHome}>
              Return home
            </button>
            <button class="btn btn--ghost btn--sm" onClick={() => window.location.reload()}>
              Reload Drop
            </button>
          </div>
        </div>
      </main>
    )
  }
}
