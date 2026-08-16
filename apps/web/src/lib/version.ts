import { signal } from '@preact/signals'
import { buildMeta } from './build'

// Set once Pages reports a newer front-end build than the one running in this
// tab. The app then invites the player to reload. Latches on: a shipped update
// never becomes "un-shipped" within a session.
export const updateAvailable = signal(false)

// Visual QA deliberately runs against the deployed API, whose build id will
// normally differ from a local bundle. Keep this opt-in and evaluated at call
// time so production and the explicit stale-app tests stay enabled by default.
export function isUpdateNoticeEnabled(): boolean {
  return import.meta.env.VITE_DISABLE_UPDATE_NOTICE !== '1'
}

// Compare Pages' current front-end build id against this tab's. Only real CI
// builds carry a git-sha id, so dev/unknown builds and missing versions are
// ignored to avoid false prompts.
export function noteWebVersion(serverVersion: string | undefined): void {
  if (!isUpdateNoticeEnabled() || updateAvailable.value || !serverVersion) return
  if (buildMeta.id === 'dev' || !buildMeta.id) return
  if (serverVersion !== buildMeta.id) updateAvailable.value = true
}

// The version manifest lives with the browser bundle, not behind the player
// API. That means an API outage cannot masquerade as a stale app, and Pages can
// authoritatively report which document is current. Failure is intentionally
// silent: offline play must not create a second connectivity error path.
export async function checkForWebUpdate(fetcher: typeof fetch = globalThis.fetch, nonce = Date.now()): Promise<void> {
  if (!isUpdateNoticeEnabled() || updateAvailable.value || buildMeta.id === 'dev' || !buildMeta.id) return

  try {
    const response = await fetcher(`/version.json?check=${nonce}`, { cache: 'no-store' })
    if (!response.ok) return
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('webVersion' in body)) return
    const version = body.webVersion
    if (typeof version === 'string') noteWebVersion(version)
  } catch {
    // An unreachable manifest is ordinary offline behavior.
  }
}

// A normal reload may reuse the cached app shell. Give the document request a
// unique query while preserving the hash route so installed PWAs are forced to
// fetch the current index and its content-hashed assets.
export function latestVersionUrl(href: string, nonce = Date.now()): string {
  const url = new URL(href)
  url.searchParams.set('drop-refresh', String(nonce))
  return url.toString()
}

export function reloadToLatest(): void {
  window.location.replace(latestVersionUrl(window.location.href))
}
