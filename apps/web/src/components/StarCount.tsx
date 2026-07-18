import { useCallback, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { createPortal } from 'preact/compat'
import { rankFor } from '../data/starRanks'
import TrophyModal from './TrophyModal'
import { getStats } from '../lib/api'
import { TROPHY_ROAD_UPDATED_EVENT } from '../lib/trophy-road'

export default function StarCount() {
  const modalOpen = useSignal(false)
  const trophyRoadGames = useSignal(0)
  const closeModal = useCallback(() => {
    modalOpen.value = false
  }, [modalOpen])

  useEffect(() => {
    let cancelled = false
    let activeRequest: AbortController | undefined
    const refresh = () => {
      activeRequest?.abort()
      activeRequest = new AbortController()
      void getStats(activeRequest.signal)
        .then((stats) => {
          if (cancelled) return
          trophyRoadGames.value = stats.trophyRoadGames
        })
        .catch(() => {})
    }
    refresh()
    const refreshTimer = window.setInterval(refresh, 60_000)
    window.addEventListener(TROPHY_ROAD_UPDATED_EVENT, refresh)

    return () => {
      cancelled = true
      activeRequest?.abort()
      window.clearInterval(refreshTimer)
      window.removeEventListener(TROPHY_ROAD_UPDATED_EVENT, refresh)
    }
  }, [trophyRoadGames])

  const rank = rankFor(trophyRoadGames.value).current
  const formattedGames = trophyRoadGames.value.toLocaleString()

  return (
    <>
      <button
        class="starcount"
        onClick={(event) => {
          event.currentTarget.focus()
          modalOpen.value = true
        }}
        title={`Trophy Road — ${rank.name} · ${formattedGames} Drop games`}
        aria-label={`Trophy Road, ${rank.name}, ${formattedGames} Drop games`}
      >
        <img src="/assets/emoji/elixir_trophy.png" alt="" class="starcount__icon" aria-hidden="true" />
        <span class="starcount__n">{formattedGames}</span>
      </button>
      {modalOpen.value &&
        createPortal(<TrophyModal trophyRoadGames={trophyRoadGames.value} onClose={closeModal} />, document.body)}
    </>
  )
}
