import { render } from 'preact'
import App from './App'
import { initSound } from './lib/sound'
import { initReducedMotion } from './lib/motion'
import './styles.css'

// Hydrate user preferences before first paint.
initSound()
initReducedMotion()

render(<App />, document.getElementById('app')!)
