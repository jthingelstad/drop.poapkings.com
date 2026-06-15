import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import rawCards from '../../data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { saveResult, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights, insightPhrase } from '../../lib/insights'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { preloadImages } from '../../lib/preload'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

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

type Stage = 'ready' | 'countdown' | 'running' | 'summary'

// A distinct sprint of N cards, biased toward weak cards by the sampler.
function pickSprint(n: number): Card[] {
  const chosen: Card[] = []
  const seen = new Set<number>()
  const recent: number[] = []
  while (chosen.length < n) {
    const c = sampleUnseenCard(ALL_CARDS, seen, recent)
    chosen.push(c)
    recent.push(c.id)
    if (recent.length > 6) recent.shift()
  }
  return chosen
}

export default function Surge() {
  const sprint = useRef<Card[]>(pickSprint(SURGE.SPRINT_LEN))
  const answers = useRef<Answer[]>([])
  const startTime = useRef(0)
  const cardStart = useRef(0)
  const penaltyMs = useRef(0)
  const firstGuess = useRef(0)
  const firstCorrect = useRef(false)
  const recorded = useRef(false)
  const timers = useRef<number[]>([])

  const stage = useSignal<Stage>('ready')
  const imagesReady = useSignal(false)
  const count = useSignal(3)
  const index = useSignal(0)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const elapsedMs = useSignal(0)
  const dropKey = useSignal(0)

  const insights = useSignal<Insights | null>(null)
  const totalMs = useSignal(0)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const elixirLine = useSignal('')

  // Preload the sprint art once on mount.
  useEffect(() => {
    preloadImages(sprint.current, () => (imagesReady.value = true))
    return () => timers.current.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Honest monotonic clock — runs only while the sprint is live.
  useEffect(() => {
    if (stage.value !== 'running') return
    let raf = 0
    const loop = () => {
      elapsedMs.value = performance.now() - startTime.current + penaltyMs.current
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
    startTime.current = performance.now()
    cardStart.current = startTime.current
    penaltyMs.current = 0
    recorded.current = false
    index.value = 0
    elapsedMs.value = 0
    cardPhase.value = 'playing'
    stage.value = 'running'
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
    cardPhase.value = 'playing'
  }

  function finish() {
    const total = performance.now() - startTime.current + penaltyMs.current
    const ins = computeInsights(answers.current)
    const best = getRecords().surgeBest
    const pb = best === undefined || total < best

    totalMs.value = total
    elapsedMs.value = total
    insights.value = ins
    prevBest.value = best
    isPB.value = pb

    if (pb) saveRecords({ surgeBest: total })
    track('surge.complete')
    if (pb) track('record.new')

    if (pb) {
      elixirLine.value = pickLine('record', { time: formatSeconds(total) })
    } else {
      elixirLine.value = pickLine('surge_done', { time: formatSeconds(total), insight: insightPhrase(ins) })
    }
    stage.value = 'summary'
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing') return
    const card = sprint.current[index.value]
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
      cardPhase.value = 'correct'
      dropKey.value += 1
      later(showNext, CORRECT_BEAT_MS)
    } else {
      playWrong()
      penaltyMs.current += SURGE.PENALTY_MS
      cardPhase.value = 'wrong'
      later(() => (cardPhase.value = 'playing'), WRONG_BEAT_MS)
    }
  }

  function replay() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    sprint.current = pickSprint(SURGE.SPRINT_LEN)
    answers.current = []
    penaltyMs.current = 0
    recorded.current = false
    imagesReady.value = false
    insights.value = null
    cardPhase.value = 'playing'
    index.value = 0
    elapsedMs.value = 0
    stage.value = 'ready'
    preloadImages(sprint.current, () => (imagesReady.value = true))
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
          <button class="btn btn--gold surge-ready__go" onClick={start} disabled={!imagesReady.value}>
            {imagesReady.value ? 'Start sprint' : 'Loading cards…'}
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
  const card = sprint.current[index.value]
  return (
    <div class="main-content game-run surge" style={{ alignItems: 'center', gap: 20 }}>
      <div class="surge-hud">
        <div class="surge-hud__timer" aria-label="elapsed time">
          {formatSeconds(elapsedMs.value)}
          <span class="surge-hud__unit">s</span>
        </div>
        <div class="surge-hud__count">
          card {index.value + 1} / {SURGE.SPRINT_LEN}
        </div>
      </div>

      <div class="progress-track" aria-hidden="true">
        <div class="progress-track__fill" style={{ width: `${(index.value / SURGE.SPRINT_LEN) * 100}%` }} />
      </div>

      <CardDisplay card={card} phase={cardPhase.value} dropAnimKey={dropKey.value} revealCost={false} />

      <PipKeypad onPick={answer} disabled={cardPhase.value !== 'playing'} />
    </div>
  )
}
