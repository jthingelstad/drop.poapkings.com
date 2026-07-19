import { signal } from '@preact/signals'
import { buildMeta } from './build'

// Set once the server reports a newer front-end build than the one running in
// this tab. The app then invites the player to reload. Latches on: a shipped
// update never becomes "un-shipped" within a session.
export const updateAvailable = signal(false)

// Compare the server's current front-end build id (from /stats) against this
// tab's. Only real CI builds carry a git-sha id, so dev/unknown builds and
// missing server versions are ignored to avoid false prompts.
export function noteWebVersion(serverVersion: string | undefined): void {
  if (updateAvailable.value || !serverVersion) return
  if (buildMeta.id === 'dev' || !buildMeta.id) return
  if (serverVersion !== buildMeta.id) updateAvailable.value = true
}
