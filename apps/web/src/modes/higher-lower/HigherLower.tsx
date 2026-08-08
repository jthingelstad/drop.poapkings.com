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
import LivesRow from '../../components/LivesRow'
import { preloadGameFx } from '../../components/GameFxLayer'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
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
const COUNTDOWN_STEP_MS = 700
// Three lives, like Rain. A wrong tap OR a timeout costs one and the run keeps
// going, so the score is every correct read in the session — not the longest
// unbroken streak. Matches HIGHER_LOWER_LIVES in the server scorer.
const HIGHER_LOWER_LIVES = 3

export default function HigherLower() {
  const gameRun = useGameSession('higher-lower', challengePreparers['higher-lower'])
  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS, guardActiveRun: false, trackElapsed: false })
  const pairIndex = useSignal(0)
  // A round ends EITHER with a tap (pickedId) or on the clock (timedOut). The
  // two are distinct on the wire so the server never has to infer one from the
  // other, and so a timeout is never recorded as a tap the player didn't make.
  const serverAnswers = useRef<
    Array<{ leftId: number; rightId: number; pickedId?: number; timedOut?: boolean; elapsedMs: number }>
  >([])
  const gradedAnswers = useRef<Array<{ correct: boolean; higher: Card }>>([])
  // The card the player tapped as higher (for reveal highlighting).
  const picked = useSignal<number | null>(null)
  // The round ended on the clock rather than a tap. Kept apart from `picked` so
  // the reveal can say "time's up" instead of blaming a card the player never
  // touched.
  const timedOut = useSignal(false)
  const revealed = useSignal(false)
  const awaitingReplay = useSignal(false)
  const lives = useSignal(HIGHER_LOWER_LIVES)
  const score = useSignal(0)
  const scoreCue = useSignal(0)
  // The record standing BEFORE this run — the number the summary compares
  // against. Never overwritten with the score just set.
  const previousBest = useSignal(comparableBest(getRecords().higherLowerContinuousBest))
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
  // tightens with the ROUND INDEX — every pair presented, missed ones included —
  // which is exactly how the server validates each response.
  useShrinkingWindow({
    running: stage.value === 'running',
    ticking: () => !revealed.value,
    startedAt: roundStart,
    windowMs: () => higherLowerWindowMs(pairIndex.value),
    remaining: remainingFrac,
    onExpire: () => timeoutRef.current()
  })

  // Leaving the tab is not free thinking time — it costs a life, exactly like
  // letting the clock run out.
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
    timedOut.value = false
    // Disarm the clock BEFORE unfreezing it. `revealed = false` resumes ticking
    // immediately, but roundStart is only restamped by an effect, which runs
    // after render — so the rAF loop could get a frame that measured the NEW
    // round against the PREVIOUS round's start, find it long expired, and fire a
    // timeout the player never earned. Zero means "not dealt yet" and the loop
    // already skips it, so the gap is simply not tickable.
    roundStart.current = 0
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
    // without promoting a 0-score run into a "best" worth reporting.
    if (score.value > (previousBest.value ?? 0)) previousBest.value = score.value
    awaitingReplay.value = false
    pairIndex.value = 0
    serverAnswers.current = []
    gradedAnswers.current = []
    picked.value = null
    timedOut.value = false
    // Disarm before unfreezing, same reason as next(): a replay must not be
    // measured against the finished run's last round.
    roundStart.current = 0
    revealed.value = false
    lives.value = HIGHER_LOWER_LIVES
    score.value = 0
    remainingFrac.value = 1
    await gameRun.prepare()
    // Arm the countdown only after prepare has synchronously cleared the old
    // challenge and resolved the replacement, avoiding a stale-pair start.
    runtime.reset('ready')
  }

  // One settle path for both ways a round can end. `pickedId` is null when the
  // clock ran out: a timeout is NOT a tap, and must never be recorded as one.
  function settle(pickedId: number | null) {
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
      ...(pickedId === null ? { timedOut: true } : { pickedId }),
      elapsedMs
    })
    gradedAnswers.current.push({ correct, higher: left.id === higherId ? left : right })

    picked.value = pickedId
    timedOut.value = pickedId === null
    revealed.value = true
    remainingFrac.value = 0

    // A miss reveals the answer and costs a life; the score keeps its total.
    const livesLeft = correct ? lives.value : lives.value - 1
    if (correct) {
      playCorrect()
      const total = score.value + 1
      score.value = total
      if (total === 3 || (total > 3 && total % 5 === 0)) scoreCue.value++
      runtime.emitCue('answer-correct', { pairIndex: pairIndex.value })
    } else {
      playWrong()
      lives.value = livesLeft
      runtime.emitCue('answer-wrong', { pairIndex: pairIndex.value })
    }

    runtime.later(
      () => {
        if (livesLeft > 0) {
          next()
        } else {
          // Out of lives. Keep the revealed result in place after completion:
          // the next signed run is prepared only after an explicit player
          // action, so an idle screen cannot farm timed-out runs, XP, or
          // activity events.
          void gameRun.complete({ answers: serverAnswers.current }, offerReplay, offerReplay)
        }
      },
      correct ? ADVANCE_DELAY_CORRECT : ADVANCE_DELAY_WRONG
    )
  }

  function choose(pickedId: number) {
    settle(pickedId)
  }

  // The clock ran out. This used to call choose() with the LOWER card so the
  // server would read a miss — which recorded a tap the player never made,
  // highlighted that card as their wrong answer, and left them watching the game
  // lose a life on their behalf. A timeout is its own outcome now.
  function timeout() {
    settle(null)
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
  if (!pair) return <GameRunGate modeName="Higher / Lower" session={gameRun} />

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
    const callout = pbCallout(score.value > (previousBest.value ?? 0), previousBest.value, {
      first: 'First run logged',
      improved: (previous) => `New personal best! +${score.value - previous}`,
      standing: (previous) => `Best: ${previous}`
    })

    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="Higher / Lower complete"
          headline={`${score.value} correct`}
          pbCallout={callout}
          insights={insights}
          moments={[
            { label: 'Correct', value: String(score.value) },
            { label: 'Prev best', value: String(previousBest.value ?? 0), tone: 'purple' },
            { label: 'Accuracy', value: `${insights.accuracyPct}%`, tone: 'green' }
          ]}
          share={{ mode: 'higher-lower', score: `${score.value} correct` }}
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

  if (runtime.stage.value === 'ready') return <GameStartScreen modeName="Higher / Lower" phase="loading" />

  const counting = runtime.stage.value === 'countdown'
  const disabled = runtime.stage.value !== 'running' || revealed.value || gameRun.preparing.value
  // Lives use the shared row, so Rain and Higher/Lower are literally the same
  // component rather than two copies that agree today.
  const hearts = <LivesRow lives={lives.value} max={HIGHER_LOWER_LIVES} testId="higher-lower-lives" />

  return (
    <GameFrame
      modeName="Higher / Lower"
      counting={counting}
      count={runtime.count.value}
      onQuit={() => navigate('/')}
      cue={runtime.cue.value}
      fxParticles={6}
      progressText={hearts}
      metric={{ value: String(score.value), label: 'correct' }}
      progressPct={remainingFrac.value * 100}
      barTransition={false}
      barLow={remainingFrac.value <= 0.35}
    >
      <div class="ed-duel">
        <div class="ed-duel__prompt" data-testid="higher-lower-prompt">
          {timedOut.value ? "Time's up" : 'Which costs more?'}
        </div>
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

        {/* Shared floating score cue — composited, never in layout flow. */}
        <div class="game-cues" aria-hidden="true">
          <div class="game-cues__slot game-cues__slot--top">
            <FloatingCue trigger={scoreCue.value} className="floating-cue--streak">
              🔥 {score.value} correct
            </FloatingCue>
          </div>
        </div>
      </div>
    </GameFrame>
  )
}
