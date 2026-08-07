import { useEffect } from 'preact/hooks'
import { accountStatus, player } from '../lib/account'
import { dismissPlayerTagNudge, openPlayerTagNudgeIfDue, playerTagNudgePlayerId } from '../lib/player-tag-nudge'
import { pendingRelease } from '../lib/release-notice'
import { navigate, route } from '../lib/router'
import { isGameRoute } from './shell/nav'
import DetailModal from './DetailModal'
import Icon from './Icon'

function routeAllowsNudge(path: string): boolean {
  return !isGameRoute(path) && !path.startsWith('/profile') && !path.startsWith('/login') && !path.startsWith('/auth')
}

export default function PlayerTagNudge() {
  const current = player.value
  const path = route.value
  const releasePending = pendingRelease.value !== null
  const eligible =
    accountStatus.value === 'authenticated' &&
    current !== null &&
    !current.playerTag &&
    routeAllowsNudge(path) &&
    !releasePending

  useEffect(() => {
    if (eligible && current) openPlayerTagNudgeIfDue(current.id)
    if ((!current || current.playerTag) && playerTagNudgePlayerId.peek()) dismissPlayerTagNudge()
  }, [eligible, current])

  if (!eligible || !current || playerTagNudgePlayerId.value !== current.id) return null

  const openProfileTag = () => {
    dismissPlayerTagNudge()
    navigate('/profile?edit=player-tag')
  }

  return (
    <DetailModal label="Connect Clash Royale" onClose={dismissPlayerTagNudge} className="player-tag-nudge">
      <div class="player-tag-nudge__icon">
        <Icon name="user" />
      </div>
      <div class="ed-eyebrow">Connect Clash Royale</div>
      <h2 class="player-tag-nudge__title">Add your player tag</h2>
      <p class="player-tag-nudge__copy">
        Link your public Clash Royale profile so Drop can show your player name, clan, and clan rankings.
      </p>
      <div class="player-tag-nudge__actions">
        <button class="ed-btn ed-btn--gold" onClick={openProfileTag}>
          Add player tag
        </button>
        <button class="ed-btn ed-btn--ghost" onClick={dismissPlayerTagNudge}>
          Maybe later
        </button>
      </div>
    </DetailModal>
  )
}
