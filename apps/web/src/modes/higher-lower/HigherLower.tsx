import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { higherLowerWindowMs } from '@elixir-drop/contracts'
import type { Insights } from '../../lib/insights'
import type { Card } from '../../types'
import { getRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { navigate } from '../../lib/router'
import { playCorrect, playWrong } from '../../lib/sound'
import CardDisplay from '../../components/CardDisplay'
import FloatingCue from '../../components/FloatingCue'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import { preloadGameFx } from '../../components/GameFxLayer'
import GameFrame from '../../components/game/GameFrame'
import Summary from '../../components/Summary'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { useGameRuntime } from '../../lib/use-game-runtime'

// A correct read earns a quick beat; a miss keeps the longer one — that's the
// learning moment.
const ADVANCE_DELAY_CORRECT = 750
const ADVANCE_DELAY_WRONG = 1400
// A 3-2-1 before each explicitly started run so the round clock never starts
// while the player is still reading or away from the controls.
const COUNTDOWN_STEP_MS = 650

export default function HigherLower() {
  const gameRun = useGameSession('higher-lower', challengePreparers['higher-lower'])
  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS, guardActiveRun: false, trackElapsed: false })
  const pairIndex = useSignal(0)
  const serverAnswers = useRef<Array<{ leftId: number; rightId: number; pickedId: number; elapsedMs: number }>>([])
  const gradedAnswers = useRef<Array<{ correct: boolean; higher: Card }>>([])
  // The card the player tapped as higher (for reveal highlighting).
  const picked = useSignal<number | null>(null)
  const revealed = useSignal(false)
  const awaitingReplay = useSignal(false)
  const streak = useSignal(0)
  const runBest = useSignal(0)
  const streakCue = useSignal(0)
  const previousBest = useSignal(getRecords().longestStreak ?? 0)
  // Shrinking response clock: fraction of the current round's window remaining.
  const remainingFrac = useSignal(1)
  const roundStart = useRef(0)
  const timeoutRef = useRef<() => void>(() => {})

  useEffect(() => {
    preloadGameFx()
  }, [])

  // Play the 3-2-1 once an explicitly requested run is loaded.
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
      void gameRun.complete({ answers: serverAnswers.current }, offerReplay, offerReplay)
      return
    }
    pairIndex.value = nextIndex
    picked.value = null
    revealed.value = false
    runtime.emitCue('round-advance', { pairIndex: nextIndex })
  }

  function offerReplay() {
    runtime.finish('over')
    awaitingReplay.value = true
  }

  async function replay() {
    track('game.replayed', 'higher-lower')
    previousBest.value = Math.max(previousBest.value, runBest.value)
    awaitingReplay.value = false
    pairIndex.value = 0
    serverAnswers.current = []
    gradedAnswers.current = []
    picked.value = null
    revealed.value = false
    streak.value = 0
    runBest.value = 0
    remainingFrac.value = 1
    await gameRun.prepare()
    // Arm the countdown only after prepare has synchronously cleared the old
    // challenge and resolved the replacement, avoiding a stale-pair start.
    runtime.reset('ready')
  }

  function choose(pickedId: number) {
    const activePair = gameRun.content?.[pairIndex.value]
    if (runtime.stage.value !== 'running' || revealed.value || !activePair) return
    const [left, right] = activePair
    // Pairs never tie, so exactly one card is the higher cost.
    const higherId = left.elixir > right.elixir ? left.id : right.id
    const correct = pickedId === higherId
    const elapsedMs = Math.round(performance.now() - roundStart.current)
    serverAnswers.current.push({
      leftId: left.id,
      rightId: right.id,
      pickedId,
      elapsedMs
    })
    gradedAnswers.current.push({ correct, higher: left.id === higherId ? left : right })

    picked.value = pickedId
    revealed.value = true
    remainingFrac.value = 0

    if (correct) {
      playCorrect()
      const s = streak.value + 1
      streak.value = s
      runBest.value = Math.max(runBest.value, s)
      if (s === 3 || (s > 3 && s % 5 === 0)) streakCue.value++
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
          // Keep the revealed result in place after completion. The next signed
          // run is prepared only after an explicit player action, so an idle
          // screen cannot farm timed-out runs, XP, or activity events.
          void gameRun.complete({ answers: serverAnswers.current }, offerReplay, offerReplay)
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

  // Desktop keyboard follows the vertical layout with ↑ / ↓. Keep ← / → as
  // aliases so existing players do not lose familiar controls.
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {})
  keyRef.current = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
    if (runtime.stage.value !== 'running' || revealed.value || gameRun.preparing.value) return
    const active = gameRun.content?.[pairIndex.value]
    if (!active) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      choose(active[0].id)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      choose(active[1].id)
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyRef.current(event)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pair = gameRun.content?.[pairIndex.value]
  if (!pair) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  if (awaitingReplay.value) {
    const total = gradedAnswers.current.length
    const correct = gradedAnswers.current.filter((answer) => answer.correct).length
    const insights: Insights = {
      total,
      correct,
      accuracyPct: total > 0 ? Math.round((correct / total) * 100) : 0,
      bands: [],
      weakest: gradedAnswers.current.filter((answer) => !answer.correct).map((answer) => answer.higher),
      hasTiming: false
    }
    const pbCallout =
      runBest.value > previousBest.value
        ? previousBest.value > 0
          ? `New personal best! +${runBest.value - previousBest.value}`
          : 'First streak logged'
        : previousBest.value > 0
          ? `Best: ${previousBest.value}`
          : undefined

    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="Higher / Lower complete"
          headline={`${runBest.value} streak`}
          pbCallout={pbCallout}
          insights={insights}
          moments={[
            { label: 'Streak', value: String(runBest.value) },
            { label: 'Prev best', value: String(previousBest.value), tone: 'purple' },
            { label: 'Accuracy', value: `${insights.accuracyPct}%`, tone: 'green' }
          ]}
          share={{ mode: 'higher-lower', score: `${runBest.value} streak` }}
          onReplay={() => void replay()}
          onHome={() => navigate('/')}
        />
      </div>
    )
  }

  const [left, right] = pair
  const higherId = left.elixir > right.elixir ? left.id : right.id

  function cardClass(cardId: number): string {
    if (!revealed.value) return 'ed-duel__card'
    if (cardId === higherId) return 'ed-duel__card ed-duel__card--correct'
    if (cardId === picked.value) return 'ed-duel__card ed-duel__card--wrong'
    return 'ed-duel__card ed-duel__card--dim'
  }

  const counting = runtime.stage.value === 'ready' || runtime.stage.value === 'countdown'
  const disabled = runtime.stage.value !== 'running' || revealed.value || gameRun.preparing.value

  return (
    <GameFrame
      modeName="Higher / Lower"
      counting={counting}
      count={runtime.count.value}
      onQuit={() => navigate('/')}
      cue={runtime.cue.value}
      fxParticles={6}
      progressText="Keep the streak"
      metric={{ value: String(streak.value), label: 'streak' }}
      progressPct={remainingFrac.value * 100}
      barTransition={false}
      barLow={remainingFrac.value <= 0.35}
    >
      <div class="ed-duel">
        <div class="ed-duel__prompt">Which costs more?</div>
        <GameMotion contentKey={counting ? 'ready' : pairIndex.value} cue={runtime.cue.value} preset="pair">
          <div class="ed-duel__cards" role="group" aria-label="Tap the higher-cost card">
            <button type="button" class={cardClass(left.id)} onClick={() => choose(left.id)} disabled={disabled}>
              <CardDisplay card={left} phase="playing" forceReveal={revealed.value} />
            </button>
            <div class="ed-duel__vs" aria-hidden="true">
              VS
            </div>
            <button type="button" class={cardClass(right.id)} onClick={() => choose(right.id)} disabled={disabled}>
              <CardDisplay card={right} phase="playing" forceReveal={revealed.value} />
            </button>
          </div>
        </GameMotion>

        {/* Shared floating streak cue — composited, never in layout flow. */}
        <div class="game-cues" aria-hidden="true">
          <div class="game-cues__slot game-cues__slot--top">
            <FloatingCue trigger={streakCue.value} className="floating-cue--streak">
              🔥 {streak.value} streak
            </FloatingCue>
          </div>
        </div>
      </div>
    </GameFrame>
  )
}
