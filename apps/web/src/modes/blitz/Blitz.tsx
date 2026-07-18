import { useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import rawCards from '@elixir-drop/game-data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { saveResult, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import { useTimedRun } from '../../lib/use-timed-run'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import { useGameRun } from '../../lib/use-game-run'
import { challengeCards } from '../../lib/challenge-cards'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

// Blitz = a 60s count-up variant of Surge: clear as many as you can, higher wins.
const BLITZ = {
  WINDOW_MS: 60000,
  PRELOAD_BATCH: 18
}
const CORRECT_BEAT_MS = 230
const WRONG_BEAT_MS = 380
const COUNTDOWN_STEP_MS = 650

function nextSample(recent: number[], seen: Set<number>): Card {
  const c = sampleUnseenCard(ALL_CARDS, seen, recent)
  recent.push(c.id)
  if (recent.length > 6) recent.shift()
  return c
}

export default function Blitz() {
  const gameRun = useGameRun('blitz')
  const recent = useRef<number[]>([])
  const seen = useRef<Set<number>>(new Set())
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const recorded = useRef(false)
  const firstGuess = useRef(0)
  const firstCorrect = useRef(false)
  const finished = useRef(false)
  const runStartedAt = useRef(0)
  const serverCards = useRef<Card[]>([])
  const serverCardIndex = useRef(0)
  const currentGuesses = useRef<number[]>([])
  const serverAnswers = useRef<Array<{ cardId: number; guesses: number[]; atMs: number }>>([])

  const timed = useTimedRun({
    countdownStepMs: COUNTDOWN_STEP_MS,
    durationMs: BLITZ.WINDOW_MS,
    onDurationEnd: finish
  })
  const { stage, count, elapsedMs: remainingMs, later } = timed
  const imagesReady = useSignal(false)
  const cleared = useSignal(0)
  const current = useSignal<Card | null>(null)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const dropKey = useSignal(0)

  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.blitz')
    const batch: Card[] = []
    const seed: number[] = []
    const seedSeen = new Set<number>()
    for (let i = 0; i < BLITZ.PRELOAD_BATCH; i++) batch.push(nextSample(seed, seedSeen))
    preloadImages(batch, () => (imagesReady.value = true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    const challenge = gameRun.challenge.value
    if (!challenge || stage.value !== 'ready') return
    const resolved = challengeCards(challenge.cardIds)
    if (!resolved.length) return
    serverCards.current = resolved
    serverCardIndex.current = 0
    imagesReady.value = false
    preloadImages(resolved.slice(0, BLITZ.PRELOAD_BATCH), () => (imagesReady.value = true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameRun.challenge.value])

  function start() {
    timed.start((startedAt) => {
      finished.current = false
      runStartedAt.current = startedAt
      recent.current = []
      seen.current.clear()
      answers.current = []
      cleared.value = 0
      cardStart.current = startedAt
      recorded.current = false
      currentGuesses.current = []
      serverAnswers.current = []
      current.value = serverCards.current[0] ?? nextSample(recent.current, seen.current)
      serverCardIndex.current = serverCards.current.length ? 1 : 0
      cardPhase.value = 'playing'
    })
  }

  function nextCard() {
    if (stage.value !== 'running') return
    const c = serverCards.current[serverCardIndex.current] ?? nextSample(recent.current, seen.current)
    if (serverCards.current[serverCardIndex.current]) serverCardIndex.current += 1
    current.value = c
    cardStart.current = performance.now()
    recorded.current = false
    currentGuesses.current = []
    cardPhase.value = 'playing'
    // Prefetch the following card's art to keep the stream smooth.
    preloadImages([c], () => {})
  }

  function finish() {
    if (finished.current) return
    finished.current = true
    timed.clearScheduled()

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
    timed.setStage('summary')
    void gameRun.complete({ answers: serverAnswers.current })
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing') return
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
      dropKey.value += 1
      later(nextCard, CORRECT_BEAT_MS)
    } else {
      playWrong()
      cardPhase.value = 'wrong'
      later(() => (cardPhase.value = 'playing'), WRONG_BEAT_MS)
    }
  }

  function replay() {
    timed.reset('ready')
    finished.current = false
    imagesReady.value = false
    insights.value = null
    current.value = null
    serverCards.current = []
    serverCardIndex.current = 0
    serverAnswers.current = []
    currentGuesses.current = []
    cardPhase.value = 'playing'
    cleared.value = 0
    const batch: Card[] = []
    const seed: number[] = []
    const seedSeen = new Set<number>()
    for (let i = 0; i < BLITZ.PRELOAD_BATCH; i++) batch.push(nextSample(seed, seedSeen))
    preloadImages(batch, () => (imagesReady.value = true))
    void gameRun.prepare()
  }

  if (!gameRun.challenge.value) {
    return (
      <GameRunGate
        preparing={gameRun.preparing.value}
        error={gameRun.startError.value}
        onRetry={() => void gameRun.prepare()}
      />
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
            disabled={!imagesReady.value || gameRun.preparing.value}
          >
            {imagesReady.value ? 'Start Blitz' : 'Loading cards…'}
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

      {card && <CardDisplay card={card} phase={cardPhase.value} dropAnimKey={dropKey.value} revealCost={false} />}

      <PipKeypad onPick={answer} disabled={cardPhase.value !== 'playing'} />
    </div>
  )
}
