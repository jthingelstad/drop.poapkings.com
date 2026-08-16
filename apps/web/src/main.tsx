import { render } from 'preact'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import { initSound } from './lib/sound'
import { initReducedMotion } from './lib/motion'
import { initAnalytics } from './lib/analytics-loader'
import { redirectingToStandalonePage } from './lib/router'
import './styles.css'

// A legacy hash route may already be leaving for its standalone document.
// Do not briefly mount the SPA or start its network checks while WebKit is
// completing that navigation.
if (!redirectingToStandalonePage) {
  // Hydrate user preferences before first paint.
  initSound()
  initReducedMotion()
  initAnalytics()

  const root = document.getElementById('app')!
  // index.html carries meaningful no-JavaScript copy for crawlers and slow
  // clients. Preact's render() appends beside unmanaged markup, so remove that
  // fallback immediately before mounting the interactive application.
  root.replaceChildren()

  render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
    root
  )
}
