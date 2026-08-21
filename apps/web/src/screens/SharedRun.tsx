import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getSharedRun, type SharedRun as SharedRunPayload } from '../lib/api'
import { sessionToken } from '../lib/account'
import { GAME_BY_MODE, gameDisplay, scoreLabel } from '../lib/game-metadata'
import { rankFor } from '../data/starRanks'
import { navigate } from '../lib/router'
import { playerProfilePath } from '../lib/public-player'
import { rememberRecruiter } from '../lib/referral'
import ModeIcon from '../components/ModeIcon'
import PlayerAvatar from '../components/PlayerAvatar'
import Wordmark from '../components/brand/Wordmark'
import SkeletonRows from '../components/Skeleton'
import GateCard from '../components/GateCard'
import Icon from '../components/Icon'

// What a shared link opens: the RUN, never the home page.
//
// Card, then the challenge with the score as the button, then the player behind
// it. This is the same correction the public profile needed, so the two now
// match — a link that lands on a home page asks a stranger to go and find the
// thing they were sent, which most of them will not do.
//
// Nothing here is anything the public profile does not already show: score,
// mode, name, arena, badge count.

const TOKEN_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/i

export function sharedRunToken(route: string): string | undefined {
  const token = route
    .split('?')[0]!
    .replace(/^\/r\//, '')
    .trim()
  return TOKEN_PATTERN.test(token) ? token.toUpperCase() : undefined
}

function RunChart({ series }: { series: number[] }) {
  const peak = Math.max(1, ...series)
  return (
    <div class="ed-sharedrun__chart" aria-hidden="true">
      {series.map((value, index) => (
        <span key={index} class="ed-sharedrun__bar" style={{ height: `${Math.max(4, (value / peak) * 100)}%` }} />
      ))}
    </div>
  )
}

export default function SharedRun({ token }: { token: string }) {
  const run = useSignal<SharedRunPayload | null>(null)
  const failed = useSignal(false)

  useEffect(() => {
    const controller = new AbortController()
    run.value = null
    failed.value = false
    getSharedRun(token, controller.signal, sessionToken())
      .then((result) => {
        run.value = result
        rememberRecruiter(result.token)
      })
      .catch(() => {
        if (!controller.signal.aborted) failed.value = true
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (failed.value) {
    return (
      <div class="main-content">
        <GateCard
          mark={<Icon name="triangle-alert" />}
          state="Link not found"
          primary={{ label: 'Open Elixir Drop', onAction: () => navigate('/') }}
        >
          That shared run could not be found. The link may be mistyped, or the player may have deleted their account.
        </GateCard>
      </div>
    )
  }

  const shared = run.value
  const game = shared ? GAME_BY_MODE.get(shared.mode) : undefined
  const score = shared ? scoreLabel(shared.mode, shared.score) : ''
  const arena = shared?.player ? rankFor(shared.player.xp ?? 0).current : undefined

  return (
    <div class="ed-sharedrun">
      <div class="ed-sharedrun__head">
        <Wordmark />
        <span class="ed-sharedrun__free">Free · no account needed</span>
      </div>

      {!shared ? (
        <SkeletonRows count={3} className="ed-sharedrun__skeleton" />
      ) : (
        <>
          <section class="ed-sharedrun__card">
            <div class="ed-sharedrun__by">
              {shared.player && (
                <>
                  <PlayerAvatar favoriteCardId={shared.player.favoriteCardId} size="small" />
                  <span class="ed-sharedrun__name">{shared.player.publicName}</span>
                </>
              )}
              <ModeIcon mode={shared.mode} size={24} className="ed-sharedrun__mode" />
            </div>
            <div class="ed-sharedrun__result">
              <span class="ed-sharedrun__score">{score}</span>
              <span class="ed-sharedrun__mode-label">{gameDisplay(shared.mode).name}</span>
            </div>
            {shared.series && shared.series.length > 0 && <RunChart series={shared.series} />}
            <div class="ed-sharedrun__foot">
              <span>ELIXIR DROP</span>
              <span>drop.poapkings.com</span>
            </div>
          </section>

          {game && <p class="ed-sharedrun__pitch">{game.description}</p>}

          {/* The score IS the button. A shared run is a challenge, and a
              challenge that opens a menu is not a challenge. */}
          <button
            class="ed-btn ed-btn--gold ed-btn--lg ed-sharedrun__cta tap-fx"
            onClick={() => navigate(game ? game.path : '/')}
          >
            <span class="tap-face">BEAT {score}</span>
          </button>

          {shared.player && (
            <button class="ed-sharedrun__player" onClick={() => navigate(playerProfilePath(shared.player!))}>
              <PlayerAvatar favoriteCardId={shared.player.favoriteCardId} size="medium" />
              <span class="ed-sharedrun__player-text">
                <span class="ed-sharedrun__player-name">{shared.player.publicName}</span>
                <span class="ed-sharedrun__player-meta">{arena ? arena.name : 'Elixir Drop'}</span>
              </span>
              <span class="ed-sharedrun__player-go">Profile →</span>
            </button>
          )}
        </>
      )}

      <p class="ed-sharedrun__fan">Fan content, not affiliated with Supercell.</p>
    </div>
  )
}
