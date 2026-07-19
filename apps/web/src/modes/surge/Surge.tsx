import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Answer, Insights } from '../../lib/insights'
import { saveResult, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights, insightPhrase } from '../../lib/insights'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { useGameRuntime } from '../../lib/use-game-runtime'
import CardDisplay from '../../components/CardDisplay'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import Icon from '../../components/Icon'
import PenaltyFlash from '../../components/PenaltyFlash'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

// Surge tunables — one config object (SPEC §9).
const SURGE = {
  SPRINT_LEN: 15,
  PENALTY_MS: 2000,
  MODE: 'sprint' as 'sprint' | 'blitz',
  BLITZ_MS: 60000
}

const CORRECT_BEAT_MS = 280
const WRONG_BEAT_MS = 430
const COUNTDOWN_STEP_MS = 650

export default function Surge() {
  const gameRun = useGameSession('surge', challengePreparers.surge)
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const firstGuess = useRef(0)
  const firstCorrect = useRef(false)
  const recorded = useRef(false)
  const runStartedAt = useRef(0)
  const currentGuesses = useRef<number[]>([])
  const serverAnswers = useRef<Array<{ cardId: number; guesses: number[]; atMs: number }>>([])

  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, elapsedMs, later } = runtime
  const index = useSignal(0)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  // After a wrong tap, point at the answer relative to the latest guess.
  const hint = useSignal<'higher' | 'lower' | null>(null)
  const dropKey = useSignal(0)

  const insights = useSignal<Insights | null>(null)
  const paceDelta = useSignal<{ aheadMs: number } | null>(null)
  const paceTimer = useRef<number | undefined>(undefined)
  const totalMs = useSignal(0)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.surge')
    preloadGameFx()
  }, [])

  async function start() {
    if (!(await gameRun.ensureFreshRun())) return
    runtime.start((startedAt) => {
      cardStart.current = startedAt
      runStartedAt.current = startedAt
      recorded.current = false
      currentGuesses.current = []
      serverAnswers.current = []
      index.value = 0
      cardPhase.value = 'playing'
      hint.value = null
    })
  }

  function showNext() {
    const nextIdx = index.value + 1
    if (nextIdx >= SURGE.SPRINT_LEN) {
      finish()
      return
    }
    index.value = nextIdx
    cardStart.current = performance.now()
    recorded.current = false
    currentGuesses.current = []
    cardPhase.value = 'playing'
    hint.value = null
    runtime.emitCue('round-advance', { cardId: gameRun.content?.[nextIdx]?.id })
  }

  function finish(finalScore?: number) {
    const total = finalScore ?? runtime.currentElapsed()
    const ins = computeInsights(answers.current)
    const best = getRecords().surgeBest
    const pb = best === undefined || total < best

    totalMs.value = total
    elapsedMs.value = total
    insights.value = ins
    prevBest.value = best
    isPB.value = pb

    if (pb)
      saveRecords({
        surgeBest: total,
        // Penalty-adjusted elapsed at each card, for next run's ghost pacing.
        surgeBestPace: serverAnswers.current.map((answer, index) => {
          const misses = serverAnswers.current
            .slice(0, index + 1)
            .reduce((sum, entry) => sum + entry.guesses.length - 1, 0)
          return Math.round(answer.atMs) + misses * SURGE.PENALTY_MS
        })
      })
    track('surge.complete')
    if (pb) track('record.new')

    if (pb) {
      elixirLine.value = pickLine('record', { time: formatSeconds(total) })
    } else {
      elixirLine.value = pickLine('surge_done', { time: formatSeconds(total), insight: insightPhrase(ins) })
    }
    runtime.finish()
    void gameRun.complete({ answers: serverAnswers.current })
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing') return
    const card = gameRun.content?.[index.value]
    if (!card) return
    const correct = picked === card.elixir
    // Mirror the server's transcript cap: wrong taps beyond it still penalize
    // locally but are no longer recorded, so a mashing beginner cannot push
    // the transcript past what the server accepts.
    if (correct || currentGuesses.current.length < 59) currentGuesses.current.push(picked)

    if (!recorded.current) {
      recorded.current = true
      firstGuess.current = picked
      firstCorrect.current = correct
    }

    if (correct) {
      playCorrect()
      const ms = performance.now() - cardStart.current
      const atMs = performance.now() - runStartedAt.current
      answers.current.push({ card, guess: firstGuess.current, correct: firstCorrect.current, ms })
      serverAnswers.current.push({ cardId: card.id, guesses: [...currentGuesses.current], atMs })
      saveResult(card.id, firstCorrect.current, ms)
      // Ghost pacing: at the checkpoints, show the delta against the PB run.
      const solved = serverAnswers.current.length
      const pace = getRecords().surgeBestPace
      if ((solved === 5 || solved === 10) && pace?.[solved - 1] !== undefined) {
        const missesSoFar = serverAnswers.current.reduce((sum, answer) => sum + answer.guesses.length - 1, 0)
        paceDelta.value = { aheadMs: pace[solved - 1]! - (atMs + missesSoFar * SURGE.PENALTY_MS) }
        window.clearTimeout(paceTimer.current)
        paceTimer.current = window.setTimeout(() => (paceDelta.value = null), 2000)
      }
      cardPhase.value = 'correct'
      hint.value = null
      dropKey.value += 1
      runtime.emitCue('answer-correct', { cardId: card.id })
      if (index.value + 1 >= SURGE.SPRINT_LEN) {
        const misses = serverAnswers.current.reduce((sum, answer) => sum + answer.guesses.length - 1, 0)
        later(() => finish(Math.round(atMs) + misses * SURGE.PENALTY_MS), CORRECT_BEAT_MS)
      } else {
        later(showNext, CORRECT_BEAT_MS)
      }
    } else {
      playWrong()
      runtime.addPenalty(SURGE.PENALTY_MS)
      hint.value = picked < card.elixir ? 'higher' : 'lower'
      cardPhase.value = 'wrong'
      runtime.emitCue('answer-wrong', { cardId: card.id })
      later(() => (cardPhase.value = 'playing'), WRONG_BEAT_MS)
    }
  }

  function replay() {
    runtime.reset('ready')
    answers.current = []
    serverAnswers.current = []
    currentGuesses.current = []
    recorded.current = false
    insights.value = null
    cardPhase.value = 'playing'
    hint.value = null
    index.value = 0
    void gameRun.prepare()
  }

  if (!gameRun.content) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  if (stage.value === 'summary' && insights.value) {
    const ins = insights.value
    const pbCallout = isPB.value
      ? prevBest.value !== undefined
        ? `New best! −${formatSeconds(prevBest.value - totalMs.value)}s`
        : 'First Surge logged'
      : prevBest.value !== undefined
        ? `Best: ${formatSeconds(prevBest.value)}s`
        : undefined

    return (
      <div class="main-content">
        <Summary
          eyebrow="Surge complete"
          headline={`${SURGE.SPRINT_LEN} cards · ${formatSeconds(totalMs.value)}s`}
          pbCallout={pbCallout}
          elixirLine={elixirLine.value}
          elixirMood={isPB.value ? 'celebrate' : 'gg'}
          insights={ins}
          onReplay={replay}
          replayLabel="Run again"
          onHome={() => navigate('/')}
        >
          <ShareLine
            text={`Surge: ${SURGE.SPRINT_LEN} cards in ${formatSeconds(totalMs.value)}s — drop.poapkings.com`}
          />
          {isPB.value && <Recruit />}
        </Summary>
      </div>
    )
  }

  // ── Get ready ────────────────────────────────────────────────────────────
  if (stage.value === 'ready') {
    return (
      <div class="main-content surge">
        <div class="surge-ready">
          <div class="eyebrow">Surge · Sprint</div>
          <h1 class="h1">{SURGE.SPRINT_LEN} cards. One honest time.</h1>
          <p class="lede">
            Tap each card's elixir cost as fast as you can. A wrong tap costs{' '}
            <strong>+{(SURGE.PENALTY_MS / 1000).toFixed(0)}s</strong> and the card stays until you nail it. Lower time
            wins.
          </p>
          <button
            class="btn btn--gold surge-ready__go"
            onClick={start}
            disabled={!gameRun.assetsReady || gameRun.preparing.value}
          >
            {gameRun.assetsReady ? 'Start sprint' : 'Loading cards…'}
          </button>
          <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </div>
    )
  }

  // ── Countdown ────────────────────────────────────────────────────────────
  if (stage.value === 'countdown') {
    return (
      <div class="main-content game-run surge">
        <div class="surge-countdown" aria-live="assertive">
          {count.value}
        </div>
        <p class="lede">Get ready…</p>
      </div>
    )
  }

  // ── Running ──────────────────────────────────────────────────────────────
  const card = gameRun.content[index.value]!
  return (
    <div class="main-content game-run surge">
      <GameFxLayer cue={runtime.cue.value} particleCount={16} />
      <div class="surge-hud">
        <div class="surge-hud__timer" aria-label="elapsed time">
          {formatSeconds(elapsedMs.value)}
          <span class="surge-hud__unit">s</span>
        </div>
        <div class="surge-hud__count">
          card {index.value + 1} / {SURGE.SPRINT_LEN}
        </div>
        <PenaltyFlash pulse={runtime.penaltyPulse.value} label="+2s" />
      </div>

      <div class="surge-hint" aria-live="polite">
        {paceDelta.value && (
          <span
            class={`pace-delta ${paceDelta.value.aheadMs >= 0 ? 'pace-delta--ahead' : 'pace-delta--behind'}`}
            data-testid="pace-delta"
          >
            <Icon name={paceDelta.value.aheadMs >= 0 ? 'arrow-up' : 'arrow-down'} />
            {(Math.abs(paceDelta.value.aheadMs) / 1000).toFixed(1)}s{' '}
            {paceDelta.value.aheadMs >= 0 ? 'ahead of' : 'behind'} best
          </span>
        )}
      </div>

      <div class="progress-track" aria-hidden="true">
        <div class="progress-track__fill" style={{ width: `${(index.value / SURGE.SPRINT_LEN) * 100}%` }} />
      </div>

      <GameMotion contentKey={card.id} cue={runtime.cue.value}>
        <CardDisplay card={card} phase={cardPhase.value} dropAnimKey={dropKey.value} revealCost={false} />
      </GameMotion>

      {/* Fixed-height slot so the keypad never shifts mid-tap. */}
      <div class="surge-hint" data-testid="surge-hint" aria-live="polite">
        {hint.value === 'higher' && (
          <span class="surge-hint__cue surge-hint__cue--higher">
            <Icon name="arrow-up" /> Higher
          </span>
        )}
        {hint.value === 'lower' && (
          <span class="surge-hint__cue surge-hint__cue--lower">
            <Icon name="arrow-down" /> Lower
          </span>
        )}
      </div>

      <PipKeypad onPick={answer} disabled={cardPhase.value !== 'playing'} />
    </div>
  )
}
