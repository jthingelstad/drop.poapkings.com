import { offline } from '../lib/api-availability'
import { accountStatus } from '../lib/account'

// Name the cause, not the consequence. Offline or signed-out, the player stays on
// the page they asked for; this chip names why some data is quiet, and it
// persists while the state does. Offline takes precedence over guest — you cannot
// sign in offline anyway, so that is the cause worth naming first.
export default function CauseChip() {
  const cause = offline.value ? 'OFFLINE' : accountStatus.value === 'anonymous' ? 'GUEST' : null
  if (!cause) return null
  return (
    <span class="ed-cause" role="status">
      {cause}
    </span>
  )
}
