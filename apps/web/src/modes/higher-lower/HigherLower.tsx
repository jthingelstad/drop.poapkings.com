import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { higherLowerWindowMs } from '@elixir-drop/contracts'
import type { ElixirMood } from '../../types'
import { getRecords, saveRecords } from '../../lib/storage'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import ElixirHost from '../../components/ElixirHost'
import FloatingCue from '../../components/FloatingCue'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { useGameRuntime } from '../../lib/use-game-runtime'

// A correct read earns a quick beat; a miss keeps the longer one — that's the
// learning moment.
const ADVANCE_DELAY_CORRECT = 750
const ADVANCE_DELAY_WRONG = 1400

export default function HigherLower() {
  const gameRun = useGameSession('higher-lower', challengePreparers['higher-lower'])
  const runtime = useGameRuntime({ initialStage: 'running', guardActiveRun: false, trackElapsed: false })
  const pairIndex = useSignal(0)
  const serverAnswers = useRef<Array<{ leftId: number; rightId: number; pickedId: number; elapsedMs: number }>>([])
  // The card the player tapped as higher (for reveal highlighting).
  const picked = useSignal<number | null>(null)
  const revealed = useSignal(false)
  const streak = useSignal(0)
  const streakCue = useSignal(0)
  const best = useSignal(getRecords().longestStreak ?? 0)
  const elixirLine = useSignal(pickLine('idle'))
  const elixirMood = useSignal<ElixirMood>('neutral')
  // Shrinking response clock: fraction of the current round's window remaining.
  const remainingFrac = useSignal(1)
  const roundStart = useRef(0)
  const timeoutRef = useRef<() => void>(() => {})

  useEffect(() => {
    track('mode.higherlower')
    preloadGameFx()
  }, [])

  // (Re)start the round clock whenever a new pair is dealt (its left card
  // changes). Pairs never repeat a card round-to-round, so this fires each round
  // and on the first deal.
  const leftCardId = gameRun.content?.[pairIndex.value]?.[0]?.id
  useEffect(() => {
    if (leftCardId === undefined) return
    roundStart.current = performance.now()
    remainingFrac.value = 1
  }, [leftCardId, remainingFrac])

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
    elixirLine.value = ''
    elixirMood.value = 'neutral'
    runtime.emitCue('round-advance', { pairIndex: nextIndex })
  }

  async function restartAfterMiss() {
    runtime.reset('running')
    pairIndex.value = 0
    serverAnswers.current = []
    await gameRun.prepare()
    picked.value = null
    revealed.value = false
    elixirLine.value = ''
    elixirMood.value = 'neutral'
  }

  function choose(pickedId: number, timedOut = false) {
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
      if (s > best.value) {
        best.value = s
        saveRecords({ longestStreak: s })
      }
      elixirLine.value = s >= 3 ? pickLine('hl_streak', { n: s }) : pickLine('hl_right')
      elixirMood.value = s >= 3 ? 'celebrate' : 'happy'
      runtime.emitCue('answer-correct', { pairIndex: pairIndex.value })
    } else {
      playWrong()
      streak.value = 0
      elixirLine.value = timedOut ? "Time's up — read faster." : pickLine('hl_wrong')
      elixirMood.value = 'angry'
      runtime.emitCue('answer-wrong', { pairIndex: pairIndex.value })
    }

    runtime.later(
      () => {
        if (correct) {
          next()
        } else {
          // A permanently rejected or quarantined completion still deals the
          // next round — Higher/Lower has no summary screen to escape to.
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
    choose(lowerId, true)
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

  const disabled = revealed.value || gameRun.preparing.value

  return (
    <div class="main-content game-run hl" style={{ alignItems: 'center', gap: 22 }}>
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

      <div class="progress-track" aria-hidden="true">
        <div
          class={`progress-track__fill${remainingFrac.value <= 0.35 ? ' progress-track__fill--low' : ''}`}
          style={{ width: `${remainingFrac.value * 100}%`, transition: 'none' }}
        />
      </div>

      <GameMotion contentKey={pairIndex.value} cue={runtime.cue.value} preset="pair">
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

      <ElixirHost line={elixirLine.value} mood={elixirMood.value} />

      <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
        Home
      </button>

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
