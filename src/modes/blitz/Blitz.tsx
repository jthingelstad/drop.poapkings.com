import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import rawCards from '../../data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { saveResult, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'

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

type Stage = 'ready' | 'countdown' | 'running' | 'summary'

function nextSample(recent: number[], seen: Set<number>): Card {
  const c = sampleUnseenCard(ALL_CARDS, seen, recent)
  recent.push(c.id)
  if (recent.length > 6) recent.shift()
  return c
}

export default function Blitz() {
  const recent = useRef<number[]>([])
  const seen = useRef<Set<number>>(new Set())
  const answers = useRef<Answer[]>([])
  const startTime = useRef(0)
  const cardStart = useRef(0)
  const recorded = useRef(false)
  const firstGuess = useRef(0)
  const firstCorrect = useRef(false)
  const timers = useRef<number[]>([])
  const finished = useRef(false)

  const stage = useSignal<Stage>('ready')
  const imagesReady = useSignal(false)
  const count = useSignal(3)
  const cleared = useSignal(0)
  const remainingMs = useSignal(BLITZ.WINDOW_MS)
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
    return () => timers.current.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (stage.value !== 'running') return
    let raf = 0
    const loop = () => {
      const left = BLITZ.WINDOW_MS - (performance.now() - startTime.current)
      remainingMs.value = Math.max(0, left)
      if (left <= 0) {
        finish()
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.value])

  function later(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms)
    timers.current.push(id)
  }

  function start() {
    stage.value = 'countdown'
    count.value = 3
    const step = () => {
      if (count.value <= 1) {
        begin()
        return
      }
      count.value -= 1
      later(step, COUNTDOWN_STEP_MS)
    }
    later(step, COUNTDOWN_STEP_MS)
  }

  function begin() {
    finished.current = false
    recent.current = []
    seen.current.clear()
    answers.current = []
    cleared.value = 0
    startTime.current = performance.now()
    cardStart.current = startTime.current
    recorded.current = false
    remainingMs.value = BLITZ.WINDOW_MS
    current.value = nextSample(recent.current, seen.current)
    cardPhase.value = 'playing'
    stage.value = 'running'
  }

  function nextCard() {
    if (stage.value !== 'running') return
    const c = nextSample(recent.current, seen.current)
    current.value = c
    cardStart.current = performance.now()
    recorded.current = false
    cardPhase.value = 'playing'
    // Prefetch the following card's art to keep the stream smooth.
    preloadImages([c], () => {})
  }

  function finish() {
    if (finished.current) return
    finished.current = true
    timers.current.forEach(clearTimeout)
    timers.current = []

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
    stage.value = 'summary'
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing') return
    const card = current.value
    if (!card) return
    const correct = picked === card.elixir

    if (!recorded.current) {
      recorded.current = true
      firstGuess.current = picked
      firstCorrect.current = correct
    }

    if (correct) {
      playCorrect()
      const ms = performance.now() - cardStart.current
      answers.current.push({ card, guess: firstGuess.current, correct: firstCorrect.current, ms })
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
    timers.current.forEach(clearTimeout)
    timers.current = []
    finished.current = false
    imagesReady.value = false
    insights.value = null
    current.value = null
    cardPhase.value = 'playing'
    cleared.value = 0
    remainingMs.value = BLITZ.WINDOW_MS
    stage.value = 'ready'
    const batch: Card[] = []
    const seed: number[] = []
    const seedSeen = new Set<number>()
    for (let i = 0; i < BLITZ.PRELOAD_BATCH; i++) batch.push(nextSample(seed, seedSeen))
    preloadImages(batch, () => (imagesReady.value = true))
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
          elixirMood={isPB.value ? 'hype' : 'neutral'}
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
          <button class="btn btn--gold surge-ready__go" onClick={start} disabled={!imagesReady.value}>
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
      <div class="main-content surge">
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
    <div class="main-content surge" style={{ alignItems: 'center', gap: 20 }}>
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
