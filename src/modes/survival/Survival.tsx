import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import rawCards from '../../data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { saveResult, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
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

// Survival = sudden death. Each card has a short clock; a miss OR a timeout ends
// the run. Score is how many you clear in a row.
const SURVIVAL = {
  CARD_MS: 5000,
  PRELOAD_BATCH: 14
}
const DEATH_BEAT_MS = 1100

type Stage = 'ready' | 'running' | 'over'

function nextSample(recent: number[], seen: Set<number>): Card {
  const c = sampleUnseenCard(ALL_CARDS, seen, recent)
  recent.push(c.id)
  if (recent.length > 6) recent.shift()
  return c
}

export default function Survival() {
  const recent = useRef<number[]>([])
  const seen = useRef<Set<number>>(new Set())
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const timers = useRef<number[]>([])
  const dead = useRef(false)

  const stage = useSignal<Stage>('ready')
  const imagesReady = useSignal(false)
  const streak = useSignal(0)
  const best = useSignal(getRecords().survivalBest ?? 0)
  const remainingFrac = useSignal(1)
  const current = useSignal<Card | null>(null)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const dropKey = useSignal(0)

  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.survival')
    const batch: Card[] = []
    const seed: number[] = []
    const seedSeen = new Set<number>()
    for (let i = 0; i < SURVIVAL.PRELOAD_BATCH; i++) batch.push(nextSample(seed, seedSeen))
    preloadImages(batch, () => (imagesReady.value = true))
    return () => timers.current.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Per-card clock — drives the depleting bar and times you out.
  useEffect(() => {
    if (stage.value !== 'running') return
    let raf = 0
    const loop = () => {
      if (cardPhase.value === 'playing') {
        const elapsed = performance.now() - cardStart.current
        const frac = 1 - elapsed / SURVIVAL.CARD_MS
        remainingFrac.value = Math.max(0, frac)
        if (frac <= 0) {
          die(current.value, undefined)
          return
        }
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

  function begin() {
    dead.current = false
    recent.current = []
    seen.current.clear()
    answers.current = []
    streak.value = 0
    current.value = nextSample(recent.current, seen.current)
    cardStart.current = performance.now()
    remainingFrac.value = 1
    cardPhase.value = 'playing'
    stage.value = 'running'
  }

  function nextCard() {
    if (stage.value !== 'running' || dead.current) return
    const c = nextSample(recent.current, seen.current)
    current.value = c
    cardStart.current = performance.now()
    remainingFrac.value = 1
    cardPhase.value = 'playing'
    preloadImages([c], () => {})
  }

  // death by a wrong guess (picked set) or a timeout (picked undefined)
  function die(card: Card | null, picked: number | undefined) {
    if (dead.current) return
    dead.current = true
    playWrong()
    if (card) {
      answers.current.push({ card, guess: picked ?? card.elixir, correct: false })
      saveResult(card.id, false)
    }
    cardPhase.value = 'wrong'
    remainingFrac.value = 0
    later(finish, DEATH_BEAT_MS)
  }

  function finish() {
    const ins = computeInsights(answers.current)
    const prev = getRecords().survivalBest
    const pb = streak.value > (prev ?? 0)

    insights.value = ins
    isPB.value = pb
    if (pb) {
      saveRecords({ survivalBest: streak.value })
      best.value = streak.value
      track('record.new')
    }
    elixirLine.value = pb
      ? `${streak.value} in a row — new best. That's nerve.`
      : `${streak.value} in a row. The clan goes deeper. Run it back.`
    stage.value = 'over'
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing' || dead.current) return
    const card = current.value
    if (!card) return

    if (picked === card.elixir) {
      playCorrect()
      const ms = performance.now() - cardStart.current
      answers.current.push({ card, guess: picked, correct: true, ms })
      saveResult(card.id, true, ms)
      streak.value += 1
      cardPhase.value = 'correct'
      dropKey.value += 1
      later(nextCard, 230)
    } else {
      die(card, picked)
    }
  }

  function replay() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    dead.current = false
    imagesReady.value = false
    insights.value = null
    current.value = null
    cardPhase.value = 'playing'
    streak.value = 0
    remainingFrac.value = 1
    stage.value = 'ready'
    const batch: Card[] = []
    const seed: number[] = []
    const seedSeen = new Set<number>()
    for (let i = 0; i < SURVIVAL.PRELOAD_BATCH; i++) batch.push(nextSample(seed, seedSeen))
    preloadImages(batch, () => (imagesReady.value = true))
  }

  // ── Game over ──────────────────────────────────────────────────────────────
  if (stage.value === 'over' && insights.value) {
    const pbCallout = isPB.value ? 'New personal best!' : best.value > 0 ? `Best: ${best.value}` : undefined
    return (
      <div class="main-content">
        <Summary
          eyebrow="Survival · sudden death"
          headline={`${streak.value} in a row`}
          pbCallout={pbCallout}
          elixirLine={elixirLine.value}
          elixirMood={isPB.value ? 'hype' : 'unimpressed'}
          insights={insights.value}
          onReplay={replay}
          replayLabel="Run it back"
          onHome={() => navigate('/')}
        >
          <ShareLine text={`Survival: ${streak.value} in a row — drop.poapkings.com`} />
          {isPB.value && streak.value >= 10 && <Recruit />}
        </Summary>
      </div>
    )
  }

  // ── Get ready ────────────────────────────────────────────────────────────
  if (stage.value === 'ready') {
    return (
      <div class="main-content surge">
        <div class="surge-ready">
          <div class="eyebrow">Survival · sudden death</div>
          <h1 class="h1">One miss ends it.</h1>
          <p class="lede">
            Name each cost before the bar runs out. A wrong tap or a timeout — and the run's over. How deep can you go?
          </p>
          <button class="btn btn--gold surge-ready__go" onClick={begin} disabled={!imagesReady.value}>
            {imagesReady.value ? 'Start run' : 'Loading cards…'}
          </button>
          <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </div>
    )
  }

  // ── Running ──────────────────────────────────────────────────────────────
  const card = current.value
  const low = remainingFrac.value <= 0.35
  return (
    <div class="main-content game-run surge" style={{ alignItems: 'center', gap: 20 }}>
      <div class="surge-hud">
        <div class="surge-hud__timer">{streak.value}</div>
        <div class="surge-hud__count">streak · best {best.value}</div>
      </div>

      <div class="progress-track" aria-hidden="true">
        <div
          class={`progress-track__fill${low ? ' progress-track__fill--low' : ''}`}
          style={{ width: `${remainingFrac.value * 100}%`, transition: 'none' }}
        />
      </div>

      {card && (
        <CardDisplay
          card={card}
          phase={cardPhase.value}
          dropAnimKey={dropKey.value}
          revealCost={cardPhase.value === 'wrong'}
        />
      )}

      <PipKeypad onPick={answer} disabled={cardPhase.value !== 'playing'} />
    </div>
  )
}
