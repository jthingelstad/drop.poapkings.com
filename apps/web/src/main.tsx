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

render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
  document.getElementById('app')!
)
