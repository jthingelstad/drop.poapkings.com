import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { higherLowerWindowMs } from '@elixir-drop/contracts'
import { getRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import CardDisplay from '../../components/CardDisplay'
import FloatingCue from '../../components/FloatingCue'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import RunCountdown from '../../components/RunCountdown'
import SignInToSave from '../../components/SignInToSave'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { useGameRuntime } from '../../lib/use-game-runtime'

// A correct read earns a quick beat; a miss keeps the longer one — that's the
// learning moment.
const ADVANCE_DELAY_CORRECT = 750
const ADVANCE_DELAY_WRONG = 1400
// A 3-2-1 before the opening pair so the round clock never starts while you are
// still reading. Only on the fresh run — a miss restarts straight in (the reveal
// beat already gives orientation), so an endless streak is never nagged.
const COUNTDOWN_STEP_MS = 650

export default function HigherLower() {
  const gameRun = useGameSession('higher-lower', challengePreparers['higher-lower'])
  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS, guardActiveRun: false, trackElapsed: false })
  const pairIndex = useSignal(0)
  const serverAnswers = useRef<Array<{ leftId: number; rightId: number; pickedId: number; elapsedMs: number }>>([])
  // The card the player tapped as higher (for reveal highlighting).
  const picked = useSignal<number | null>(null)
  const revealed = useSignal(false)
  const streak = useSignal(0)
  const streakCue = useSignal(0)
  const best = useSignal(getRecords().longestStreak ?? 0)
  // Shrinking response clock: fraction of the current round's window remaining.
  const remainingFrac = useSignal(1)
  const roundStart = useRef(0)
  const timeoutRef = useRef<() => void>(() => {})

  useEffect(() => {
    track('mode.higherlower')
    preloadGameFx()
  }, [])

  // Play the 3-2-1 once the opening pair is loaded (fresh run only — a miss
  // resets straight to 'running', so this never re-fires mid-streak).
  useEffect(() => {
    if (gameRun.content && runtime.stage.value === 'ready') {
      runtime.start(() => {
        remainingFrac.value = 1
      })
    }
  }, [gameRun.content, runtime.stage.value, remainingFrac, runtime])

  // (Re)start the round clock whenever a new pair is dealt (its left card
  // changes) — but only once the run is live, so the countdown doesn't secretly
  // burn the opening window. The stage flip to 'running' re-runs this and starts
  // the first round's clock.
  const leftCardId = gameRun.content?.[pairIndex.value]?.[0]?.id
  useEffect(() => {
    if (leftCardId === undefined || runtime.stage.value !== 'running') return
    roundStart.current = performance.now()
    remainingFrac.value = 1
  }, [leftCardId, remainingFrac, runtime.stage.value])

  // The countdown itself: drives the depleting bar and times you out. The window
  // tightens each round, so deep runs end at your true read speed.
  useEffect(() => {
    if (runtime.stage.value !== 'running') return
    let raf = 0
    const loop = () => {
      if (!revealed.value && roundStart.current > 0) {
        const elapsed = performance.now() - roundStart.current
        const frac = 1 - elapsed / higherLowerWindowMs(streak.value)
        remainingFrac.value = Math.max(0, frac)
        if (frac <= 0) {
          timeoutRef.current()
          return
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [revealed, remainingFrac, streak, runtime.stage.value])

  // Leaving the tab is not free thinking time — it ends the round.
  useEffect(() => {
    if (runtime.stage.value !== 'running') return
    const onHidden = () => {
      if (document.visibilityState === 'hidden') timeoutRef.current()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [runtime.stage.value])

  function next() {
    const nextIndex = pairIndex.value + 1
    const nextPair = gameRun.content?.[nextIndex]
    if (!nextPair) {
      void gameRun.complete(
        { answers: serverAnswers.current },
        () => void restartAfterMiss(),
        () => void restartAfterMiss()
      )
      return
    }
    pairIndex.value = nextIndex
    picked.value = null
    revealed.value = false
    runtime.emitCue('round-advance', { pairIndex: nextIndex })
  }

  async function restartAfterMiss() {
    runtime.reset('running')
    pairIndex.value = 0
    serverAnswers.current = []
    await gameRun.prepare()
    picked.value = null
    revealed.value = false
  }

  function choose(pickedId: number) {
    const activePair = gameRun.content?.[pairIndex.value]
    if (runtime.stage.value !== 'running' || revealed.value || !activePair) return
    const [left, right] = activePair
    // Pairs never tie, so exactly one card is the higher cost.
    const higherId = left.elixir > right.elixir ? left.id : right.id
    const correct = pickedId === higherId
    serverAnswers.current.push({
      leftId: left.id,
      rightId: right.id,
      pickedId,
      elapsedMs: Math.round(performance.now() - roundStart.current)
    })

    picked.value = pickedId
    revealed.value = true
    remainingFrac.value = 0

    if (correct) {
      playCorrect()
      const s = streak.value + 1
      streak.value = s
      if (s === 3 || (s > 3 && s % 5 === 0)) streakCue.value++
      // Live display only; longestStreak is persisted centrally when the server
      // accepts the completed run, so the device never keeps a rejected best.
      if (s > best.value) best.value = s
      runtime.emitCue('answer-correct', { pairIndex: pairIndex.value })
    } else {
      playWrong()
      streak.value = 0
      runtime.emitCue('answer-wrong', { pairIndex: pairIndex.value })
    }

    runtime.later(
      () => {
        if (correct) {
          next()
        } else {
          // A permanently rejected completion still deals the next round —
          // Higher/Lower has no summary screen to escape to.
          void gameRun.complete(
            { answers: serverAnswers.current },
            () => void restartAfterMiss(),
            () => void restartAfterMiss()
          )
        }
      },
      correct ? ADVANCE_DELAY_CORRECT : ADVANCE_DELAY_WRONG
    )
  }

  // The clock ran out: record the lower card so the server reads it as the miss.
  function timeout() {
    const activePair = gameRun.content?.[pairIndex.value]
    if (runtime.stage.value !== 'running' || revealed.value || !activePair) return
    const [left, right] = activePair
    const lowerId = left.elixir > right.elixir ? right.id : left.id
    choose(lowerId)
  }
  timeoutRef.current = timeout

  const pair = gameRun.content?.[pairIndex.value]
  if (!pair) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  const [left, right] = pair
  const higherId = left.elixir > right.elixir ? left.id : right.id

  function cardClass(cardId: number): string {
    if (!revealed.value) return 'hl__card'
    if (cardId === higherId) return 'hl__card hl__card--correct'
    if (cardId === picked.value) return 'hl__card hl__card--wrong'
    return 'hl__card hl__card--dim'
  }

  const counting = runtime.stage.value !== 'running'
  const disabled = counting || revealed.value || gameRun.preparing.value

  return (
    <div class="main-content game-run hl">
      <GameFxLayer cue={runtime.cue.value} particleCount={6} />
      <div class="session-bar">
        <div class="session-bar__stat">
          <span class="session-bar__val">{streak.value}</span>
          <span>streak</span>
        </div>
        <div class="session-bar__stat">
          <span class="session-bar__val">{best.value}</span>
          <span>best</span>
        </div>
      </div>

      <p class="lede hl__prompt">
        Tap the card that costs <strong>more</strong> elixir — before the clock runs out.
      </p>

      {/* Higher/Lower has no summary screen, so a signed-out player sees a
          persistent prompt to save their streak. */}
      <SignInToSave variant="line" />

      <div class="progress-track" aria-hidden="true">
        <div
          class={`progress-track__fill${remainingFrac.value <= 0.35 ? ' progress-track__fill--low' : ''}`}
          style={{ width: `${remainingFrac.value * 100}%`, transition: 'none' }}
        />
      </div>

      <div class={`run-stage${counting ? ' run-stage--counting' : ''}`}>
        <GameMotion contentKey={counting ? 'ready' : pairIndex.value} cue={runtime.cue.value} preset="pair">
          <div class="hl__pair" role="group" aria-label="Tap the higher-cost card">
            <button type="button" class={cardClass(left.id)} onClick={() => choose(left.id)} disabled={disabled}>
              <CardDisplay card={left} phase="playing" dropAnimKey={0} forceReveal={revealed.value} />
            </button>
            <div class="hl__vs" aria-hidden="true">
              vs
            </div>
            <button type="button" class={cardClass(right.id)} onClick={() => choose(right.id)} disabled={disabled}>
              <CardDisplay card={right} phase="playing" dropAnimKey={0} forceReveal={revealed.value} />
            </button>
          </div>
        </GameMotion>
        {counting && <RunCountdown count={runtime.count.value} />}
      </div>

      {/* Shared floating streak cue — composited, never in layout flow. */}
      <div class="game-cues" aria-hidden="true">
        <div class="game-cues__slot game-cues__slot--top">
          <FloatingCue trigger={streakCue.value} className="floating-cue--streak">
            🔥 {streak.value} streak
          </FloatingCue>
        </div>
      </div>
    </div>
  )
}
