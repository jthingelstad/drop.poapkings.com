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
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import LivesRow from '../../components/LivesRow'
import { preloadGameFx } from '../../components/GameFxLayer'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
import Summary from '../../components/Summary'
import GameMilestone from '../../components/GameMilestone'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { preloadImages } from '../../lib/preload'
import { observeInput, runInputEvidence, type InputObservation, type RunInputEvidence } from '../../lib/input-evidence'

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
const MILESTONE_EVERY = 10

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
  const milestone = useSignal<number | null>(null)
  // The record standing BEFORE this run — the number the summary compares
  // against. Never overwritten with the score just set.
  const previousBest = useSignal(comparableBest(getRecords().higherLowerContinuousBest))
  // Shrinking response clock: fraction of the current round's window remaining.
  const remainingFrac = useSignal(1)
  const roundStart = useRef(0)
  const runStartedAt = useRef(0)
  const inputEvents = useRef<RunInputEvidence[]>([])
  const handoffGeneration = useRef(0)
  const timeoutRef = useRef<() => void>(() => {})
  const stage = runtime.stage

  useEffect(() => {
    preloadGameFx()
    return () => {
      handoffGeneration.current += 1
    }
  }, [])

  // Play the 3-2-1 once an explicitly requested run is loaded. Unlike the other
  // modes this cannot use useAutoStart: replay() re-prepares BEFORE resetting
  // the stage, so the arming edge is the stage flip, not the content arriving —
  // hence the subscribed `stage.value` dependency. The start callback goes
  // through a ref because `runtime` is a fresh object literal every render, and
  // depending on it would re-run this effect on every single render.
  const startRun = useRef<() => void>(() => {})
  startRun.current = () =>
    runtime.start((startedAt) => {
      runStartedAt.current = startedAt
      // Arm the opening pair before the stage becomes interactive. A passive
      // effect runs after paint, which leaves a fast player one frame where the
      // board is live but the round stamp is still zero.
      roundStart.current = startedAt
      inputEvents.current = []
      remainingFrac.value = 1
    })
  useEffect(() => {
    if (gameRun.content && stage.value === 'ready') startRun.current()
  }, [gameRun.content, stage.value])

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

  function showNext(nextIndex: number) {
    pairIndex.value = nextIndex
    picked.value = null
    timedOut.value = false
    // Stamp the new pair synchronously BEFORE unfreezing it. A passive effect
    // used to do this after paint, leaving a fast tap to subtract zero from
    // page uptime and manufacture minutes of elapsed time, false timeouts, and
    // contradictory referee evidence.
    roundStart.current = performance.now()
    remainingFrac.value = 1
    revealed.value = false
    runtime.emitCue('round-advance', { pairIndex: nextIndex })
  }

  function offerReplay() {
    runtime.finish('over')
    awaitingReplay.value = true
  }

  function showMilestone(value: number): void {
    milestone.value = value
    runtime.later(() => {
      if (milestone.peek() === value) milestone.value = null
    }, 520)
  }

  async function replay() {
    track('game.replayed', 'higher-lower')
    // Carry this session's best forward so a second run compares against it,
    // without promoting a 0-score run into a "best" worth reporting.
    if (score.value > (previousBest.value ?? 0)) previousBest.value = score.value
    awaitingReplay.value = false
    pairIndex.value = 0
    serverAnswers.current = []
    inputEvents.current = []
    gradedAnswers.current = []
    picked.value = null
    timedOut.value = false
    // Disarm before unfreezing, same reason as next(): a replay must not be
    // measured against the finished run's last round.
    roundStart.current = 0
    revealed.value = false
    lives.value = HIGHER_LOWER_LIVES
    score.value = 0
    milestone.value = null
    remainingFrac.value = 1
    handoffGeneration.current += 1
    await gameRun.prepare()
    // Arm the countdown only after prepare has synchronously cleared the old
    // challenge and resolved the replacement, avoiding a stale-pair start.
    runtime.reset('ready')
  }

  // One settle path for both ways a round can end. `pickedId` is null when the
  // clock ran out: a timeout is NOT a tap, and must never be recorded as one.
  function settle(pickedId: number | null, observation?: InputObservation) {
    const activePair = gameRun.content?.[pairIndex.value]
    if (runtime.stage.value !== 'running' || revealed.value || !activePair) return
    const [left, right] = activePair
    // Pairs never tie, so exactly one card is the higher cost.
    const higherId = left.elixir > right.elixir ? left.id : right.id
    const correct = pickedId === higherId
    if (pickedId !== null && observation) {
      inputEvents.current.push(
        runInputEvidence(observation, runStartedAt.current, roundStart.current, pairIndex.value, pickedId)
      )
    }
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
      if (total % MILESTONE_EVERY === 0) showMilestone(total)
      runtime.emitCue('answer-correct', { pairIndex: pairIndex.value })
    } else {
      playWrong()
      lives.value = livesLeft
      runtime.emitCue('answer-wrong', { pairIndex: pairIndex.value })
    }

    const delay = correct ? ADVANCE_DELAY_CORRECT : ADVANCE_DELAY_WRONG
    if (livesLeft <= 0) {
      runtime.later(() => {
        // Out of lives. Keep the revealed result in place after completion: the
        // next signed run is prepared only after an explicit player action, so
        // an idle screen cannot farm timed-out runs, XP, or activity events.
        void gameRun.complete(
          { answers: serverAnswers.current, inputEvents: inputEvents.current },
          offerReplay,
          offerReplay
        )
      }, delay)
      return
    }

    const nextIndex = pairIndex.value + 1
    const nextPair = gameRun.content?.[nextIndex]
    const generation = ++handoffGeneration.current
    let beatReady = false
    let artReady = !nextPair
    const advance = () => {
      if (!beatReady || !artReady || generation !== handoffGeneration.current || stage.value !== 'running') return
      if (nextPair) showNext(nextIndex)
      else
        void gameRun.complete(
          { answers: serverAnswers.current, inputEvents: inputEvents.current },
          offerReplay,
          offerReplay
        )
    }
    // Decode during the result reveal, not after it. The player always gets the
    // full learning beat, while a cache/decode hiccup can only extend that beat
    // with the complete old pair still visible.
    if (nextPair) {
      preloadImages([...nextPair], () => {
        artReady = true
        advance()
      })
    }
    runtime.later(() => {
      beatReady = true
      advance()
    }, delay)
  }

  function choose(pickedId: number, observation: InputObservation) {
    settle(pickedId, observation)
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
      choose(active[0].id, observeInput(event))
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      choose(active[1].id, observeInput(event))
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
    >
      <div class="ed-duel">
        {/* The round clock lives here, directly under the top bar, not in it —
            the cards fill the stage, so the one shrinking thing sits above them. */}
        <div
          class={`ed-response-clock${remainingFrac.value <= 0.35 ? ' ed-response-clock--low' : ''}`}
          aria-hidden="true"
        >
          <div class="ed-response-clock__fill" style={{ width: `${Math.max(0, remainingFrac.value * 100)}%` }} />
        </div>
        <div class="ed-duel__prompt" data-testid="higher-lower-prompt">
          {timedOut.value ? "Time's up" : 'Which costs more?'}
        </div>
        <GameMotion contentKey={counting ? 'ready' : pairIndex.value} cue={runtime.cue.value} preset="pair">
          <div class="ed-duel__cards" role="group" aria-label="Tap the higher-cost card">
            <button
              type="button"
              class={cardClass(left.id)}
              onClick={(event) => choose(left.id, observeInput(event))}
              disabled={disabled}
            >
              <CardDisplay card={left} phase="playing" forceReveal={revealed.value} />
            </button>
            <div class="ed-duel__vs" aria-hidden="true">
              VS
            </div>
            <button
              type="button"
              class={cardClass(right.id)}
              onClick={(event) => choose(right.id, observeInput(event))}
              disabled={disabled}
            >
              <CardDisplay card={right} phase="playing" forceReveal={revealed.value} />
            </button>
          </div>
        </GameMotion>

        {/* Progress is the shared GameMilestone flash at every tenth — no emoji
            streak cue (Drop has no emoji in any mode). */}
        {milestone.value !== null && <GameMilestone key={milestone.value} value={milestone.value} />}
      </div>
    </GameFrame>
  )
}
