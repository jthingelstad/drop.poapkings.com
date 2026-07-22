// Load Tinylytics only on routes that cannot contain credentials. Drop is a
// hash-routed SPA and its one-time login token lives in #/auth?...; loading a
// generic SPA collector there would create an unnecessary disclosure risk.

import { analyticsCollectorReady, flushLoginCompleted } from './analytics'

const EMBED_SRC = 'https://tinylytics.app/embed/JjqvUeyEnrPM1f_iXrbU/min.js?spa&events&beacon'
const SCRIPT_ID = 'elixir-drop-tinylytics'

function authRoute(): boolean {
  return window.location.hash === '#/auth' || window.location.hash.startsWith('#/auth?')
}

export function initAnalytics(): void {
  if (typeof document === 'undefined') return

  const load = () => {
    if (authRoute()) return
    window.removeEventListener('hashchange', load)

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) return

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = EMBED_SRC
    script.defer = true
    script.addEventListener('load', () => {
      analyticsCollectorReady()
      flushLoginCompleted()
    })
    document.head.appendChild(script)
  }

  if (authRoute()) window.addEventListener('hashchange', load)
  else load()
}
