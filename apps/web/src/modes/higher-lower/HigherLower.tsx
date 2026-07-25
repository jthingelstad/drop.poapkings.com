import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { higherLowerWindowMs } from '@elixir-drop/contracts'
import type { Insights } from '../../lib/insights'
import type { Card } from '../../types'
import { getRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { navigate } from '../../lib/router'
import { playCorrect, playWrong } from '../../lib/sound'
import { comparableBest, pbCallout } from '../../lib/pb-callout'
import { useGameKeys } from '../../lib/use-game-keys'
import { useEndRunOnHide, useShrinkingWindow } from '../../lib/use-round-clock'
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
  // The record standing BEFORE this run — the number the summary compares
  // against. Never overwritten with the streak just set.
  const previousBest = useSignal(comparableBest(getRecords().longestStreak))
  // Shrinking response clock: fraction of the current round's window remaining.
  const remainingFrac = useSignal(1)
  const roundStart = useRef(0)
  const timeoutRef = useRef<() => void>(() => {})
  const stage = runtime.stage

  useEffect(() => {
    preloadGameFx()
  }, [])

  // Play the 3-2-1 once an explicitly requested run is loaded. Unlike the other
  // modes this cannot use useAutoStart: replay() re-prepares BEFORE resetting
  // the stage, so the arming edge is the stage flip, not the content arriving —
  // hence the subscribed `stage.value` dependency. The start callback goes
  // through a ref because `runtime` is a fresh object literal every render, and
  // depending on it would re-run this effect on every single render.
  const startRun = useRef<() => void>(() => {})
  startRun.current = () =>
    runtime.start(() => {
      remainingFrac.value = 1
    })
  useEffect(() => {
    if (gameRun.content && stage.value === 'ready') startRun.current()
  }, [gameRun.content, stage.value])

  // (Re)start the round clock whenever a new pair is dealt (its left card
  // changes) — but only once the run is live, so the countdown doesn't secretly
  // burn the opening window. The stage flip to 'running' re-runs this and starts
  // the first round's clock.
  const leftCardId = gameRun.content?.[pairIndex.value]?.[0]?.id
  useEffect(() => {
    if (leftCardId === undefined || stage.value !== 'running') return
    roundStart.current = performance.now()
    remainingFrac.value = 1
  }, [leftCardId, remainingFrac, stage.value])

  // The countdown itself: drives the depleting bar and times you out. The window
  // tightens each round, so deep runs end at your true read speed.
  useShrinkingWindow({
    running: stage.value === 'running',
    ticking: () => !revealed.value,
    startedAt: roundStart,
    windowMs: () => higherLowerWindowMs(streak.value),
    remaining: remainingFrac,
    onExpire: () => timeoutRef.current()
  })

  // Leaving the tab is not free thinking time — it ends the round.
  useEndRunOnHide(stage.value === 'running', () => timeoutRef.current())

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
    // Carry this session's best forward so a second run compares against it,
    // without promoting a 0-streak run into a "best" worth reporting.
    if (runBest.value > (previousBest.value ?? 0)) previousBest.value = runBest.value
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
  useGameKeys((event) => {
    if (stage.value !== 'running' || revealed.value || gameRun.preparing.value) return
    const active = gameRun.content?.[pairIndex.value]
    if (!active) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      choose(active[0].id)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      choose(active[1].id)
    }
  })

  const pair = gameRun.content?.[pairIndex.value]
  if (!pair) return <GameRunGate session={gameRun} />

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
    const callout = pbCallout(runBest.value > (previousBest.value ?? 0), previousBest.value, {
      first: 'First streak logged',
      improved: (previous) => `New personal best! +${runBest.value - previous}`,
      standing: (previous) => `Best: ${previous}`
    })

    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="Higher / Lower complete"
          headline={`${runBest.value} streak`}
          pbCallout={callout}
          insights={insights}
          moments={[
            { label: 'Streak', value: String(runBest.value) },
            { label: 'Prev best', value: String(previousBest.value ?? 0), tone: 'purple' },
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
