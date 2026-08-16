import { render } from 'preact'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import { initSound } from './lib/sound'
import { initReducedMotion } from './lib/motion'
import { initAnalytics } from './lib/analytics-loader'
import './styles.css'

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
