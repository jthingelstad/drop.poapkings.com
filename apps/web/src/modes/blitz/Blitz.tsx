import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import { saveResult, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import { useGameRuntime } from '../../lib/use-game-runtime'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import Icon from '../../components/Icon'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

// Blitz = a 60s count-up variant of Surge: clear as many as you can, higher wins.
const BLITZ = {
  WINDOW_MS: 60000
}
const CORRECT_BEAT_MS = 230
// The only cost of a miss is this lockout, so it escalates on repeated
// misses on the same card — informed retries stay cheap, roulette does not.
const WRONG_BEAT_STEPS_MS = [380, 600, 900]
const COUNTDOWN_STEP_MS = 650

export default function Blitz() {
  const gameRun = useGameSession('blitz', challengePreparers.blitz)
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const recorded = useRef(false)
  const firstGuess = useRef(0)
  const firstCorrect = useRef(false)
  const finished = useRef(false)
  const runStartedAt = useRef(0)
  const serverCardIndex = useRef(0)
  const currentGuesses = useRef<number[]>([])
  const serverAnswers = useRef<Array<{ cardId: number; guesses: number[]; atMs: number }>>([])

  const runtime = useGameRuntime({
    countdownStepMs: COUNTDOWN_STEP_MS,
    durationMs: BLITZ.WINDOW_MS,
    onDurationEnd: finish
  })
  const { stage, count, elapsedMs: remainingMs, later } = runtime
  const cleared = useSignal(0)
  const current = useSignal<Card | null>(null)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const hint = useSignal<'higher' | 'lower' | null>(null)
  const dropKey = useSignal(0)

  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.blitz')
    preloadGameFx()
  }, [])

  async function start() {
    if (!(await gameRun.ensureFreshRun())) return
    runtime.start((startedAt) => {
      finished.current = false
      runStartedAt.current = startedAt
      answers.current = []
      cleared.value = 0
      cardStart.current = startedAt
      recorded.current = false
      currentGuesses.current = []
      serverAnswers.current = []
      current.value = gameRun.content?.[0] ?? null
      serverCardIndex.current = current.value ? 1 : 0
      cardPhase.value = 'playing'
      hint.value = null
    })
  }

  function nextCard() {
    if (stage.value !== 'running') return
    const c = gameRun.content?.[serverCardIndex.current]
    if (!c) {
      finish()
      return
    }
    serverCardIndex.current += 1
    current.value = c
    cardStart.current = performance.now()
    recorded.current = false
    currentGuesses.current = []
    cardPhase.value = 'playing'
    hint.value = null
    runtime.emitCue('round-advance', { cardId: c.id })
    // Prefetch the following card's art to keep the stream smooth.
    preloadImages([c], () => {})
  }

  function finish() {
    if (finished.current) return
    finished.current = true
    runtime.clearScheduled()

    const ins = computeInsights(answers.current)
    const best = getRecords().blitzBest
    const pb = best === undefined || cleared.value > best

    insights.value = ins
    prevBest.value = best
    isPB.value = pb
    remainingMs.value = 0

    if (pb) {
      saveRecords({ blitzBest: cleared.value })
      track('record.new')
    }
    elixirLine.value = pb
      ? `${cleared.value} cleared. New Blitz best.`
      : pickLine('surge_done', { time: '60.0', insight: `${cleared.value} cleared` })
    runtime.finish()
    void gameRun.complete({ answers: serverAnswers.current })
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing') return
    // The rAF-driven buzzer can lag (backgrounded tab, iOS scroll); check the
    // real clock so taps after the window end the run instead of recording.
    if (runtime.currentElapsed() >= BLITZ.WINDOW_MS) {
      finish()
      return
    }
    const card = current.value
    if (!card) return
    const correct = picked === card.elixir
    currentGuesses.current.push(picked)

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
      cleared.value += 1
      cardPhase.value = 'correct'
      hint.value = null
      dropKey.value += 1
      runtime.emitCue('answer-correct', { cardId: card.id })
      later(nextCard, CORRECT_BEAT_MS)
    } else {
      playWrong()
      hint.value = picked < card.elixir ? 'higher' : 'lower'
      const missesOnCard = currentGuesses.current.length - 1
      const lockout = WRONG_BEAT_STEPS_MS[Math.min(missesOnCard, WRONG_BEAT_STEPS_MS.length - 1)] ?? 380
      cardPhase.value = 'wrong'
      runtime.emitCue('answer-wrong', { cardId: card.id })
      later(() => (cardPhase.value = 'playing'), lockout)
    }
  }

  function replay() {
    runtime.reset('ready')
    finished.current = false
    insights.value = null
    current.value = null
    serverCardIndex.current = 0
    serverAnswers.current = []
    currentGuesses.current = []
    cardPhase.value = 'playing'
    cleared.value = 0
    void gameRun.prepare()
  }

  if (!gameRun.content) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  if (stage.value === 'summary' && insights.value) {
    const pbCallout = isPB.value
      ? prevBest.value !== undefined
        ? `New best! +${cleared.value - prevBest.value}`
        : 'First Blitz logged'
      : prevBest.value !== undefined
        ? `Best: ${prevBest.value}`
        : undefined
    return (
      <div class="main-content">
        <Summary
          eyebrow="Blitz complete · 60s"
          headline={`${cleared.value} cleared`}
          pbCallout={pbCallout}
          elixirLine={elixirLine.value}
          elixirMood={isPB.value ? 'celebrate' : 'gg'}
          insights={insights.value}
          onReplay={replay}
          replayLabel="Blitz again"
          onHome={() => navigate('/')}
        >
          <ShareLine text={`Blitz: ${cleared.value} cards in 60s — drop.poapkings.com`} />
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
          <div class="eyebrow">Blitz · 60 seconds</div>
          <h1 class="h1">Clear as many as you can.</h1>
          <p class="lede">
            One minute on the clock. Tap each card's cost — a miss just keeps the card up, so it's all about flow.
            Higher count wins.
          </p>
          <button
            class="btn btn--gold surge-ready__go"
            onClick={start}
            disabled={!gameRun.assetsReady || gameRun.preparing.value}
          >
            {gameRun.assetsReady ? 'Start Blitz' : 'Loading cards…'}
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
  const card = current.value
  const seconds = Math.ceil(remainingMs.value / 1000)
  return (
    <div class="main-content game-run surge">
      <GameFxLayer cue={runtime.cue.value} particleCount={10} />
      <div class="surge-hud">
        <div class={`surge-hud__timer${seconds <= 10 ? ' surge-hud__timer--low' : ''}`} aria-label="time remaining">
          {seconds}
          <span class="surge-hud__unit">s</span>
        </div>
        <div class="surge-hud__count">{cleared.value} cleared</div>
      </div>

      <div class="progress-track" aria-hidden="true">
        <div class="progress-track__fill" style={{ width: `${(remainingMs.value / BLITZ.WINDOW_MS) * 100}%` }} />
      </div>

      {card && (
        <GameMotion contentKey={card.id} cue={runtime.cue.value}>
          <CardDisplay card={card} phase={cardPhase.value} dropAnimKey={dropKey.value} revealCost={false} />
        </GameMotion>
      )}

      <div class="surge-hint" data-testid="blitz-hint" aria-live="polite">
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
